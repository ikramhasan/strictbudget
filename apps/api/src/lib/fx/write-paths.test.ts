import { sql } from "@strictbudget/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";
import type { FakeFxProvider } from "./fake";

// The write paths that convert again look their rates up before they lock
// anything, as the main ones do. Each test empties the rate cache, holds the
// provider, starts the write and, while it waits on the provider, edits a row the write locks:
// that edit must go through.
const { app, db, close, fxProviders } = createTestApp();
const fx = fxProviders[0] as FakeFxProvider;
beforeEach(async () => {
  await resetDatabase(db);
  fx.reset().seed("2026-10-01", "EUR", { USD: "1.25" }).seed("2026-10-01", "USD", { EUR: "0.8" });
});
afterAll(close);

const TODAY = "2026-10-16";

type Txn = { id: string; accountId: string; subtransactions: { id: string; amount: string }[] };

async function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;

async function setup() {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie);
  const base = `/v1/budgets/${budget.id}`;
  const ok = async (res: Response, status = 200) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return res;
  };
  const addAccount = async (name: string, currency: string) =>
    json<{ id: string }>(
      await ok(
        await send("POST", `${base}/accounts`, cookie, {
          name,
          type: "checking",
          currency,
          balance: "0",
          date: "2026-10-01",
        }),
        201,
      ),
    );
  const create = async (input: Record<string, unknown>) =>
    json<Txn>(
      await ok(
        await send("POST", `${base}/transactions?today=${TODAY}`, cookie, {
          payeeName: "Shop",
          categoryId: null,
          memo: "",
          ...input,
        }),
        201,
      ),
    );
  const memo = (id: string, text: string) =>
    send("PATCH", `${base}/transactions/${id}?today=${TODAY}`, cookie, { memo: text });
  const checking = await addAccount("Dollars", "USD");
  const euros = await addAccount("Euros", "EUR");
  return { cookie, base, ok, addAccount, create, memo, checking, euros };
}

/** Resolves to "waiting" if `promise` hasn't settled within `ms`. */
const within = <T>(promise: Promise<T>, ms = 2000) =>
  Promise.race([promise, new Promise<"waiting">((r) => setTimeout(() => r("waiting"), ms))]);

/** Waits until the provider has been asked at least once since `calls` calls were counted. */
async function asked(calls: number) {
  for (let i = 0; i < 200 && fx.calls.length <= calls; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  expect(fx.calls.length).toBeGreaterThan(calls);
}

/**
 * Runs `write` with a rate it must fetch and a provider that won't answer, and checks that
 * `edit` (a request needing a lock the write takes) completes meanwhile.
 */
async function whileFetching(write: () => Promise<Response>, edit: () => Promise<Response>) {
  await db.execute(sql`delete from fx_rate`);
  const before = fx.calls.length;
  const release = fx.hold();
  const writing = write();
  try {
    await asked(before);
    const edited = await within(edit());
    expect(edited).not.toBe("waiting");
    expect((edited as Response).status).toBe(200);
  } finally {
    release();
  }
  const res = await writing;
  expect(res.status, await res.clone().text()).toBeLessThan(300);
}

describe("exchange rates before a write locks anything", () => {
  it("looks up a Working Balance adjustment's rate before the account edit locks the account", async () => {
    const { cookie, base, euros } = await setup();
    await whileFetching(
      () =>
        send("PATCH", `${base}/accounts/${euros.id}?today=${TODAY}`, cookie, {
          name: "Euro cash",
          workingBalance: "5000",
          date: "2026-10-02",
        }),
      () => send("PATCH", `${base}/accounts/${euros.id}?today=${TODAY}`, cookie, { note: "hello" }),
    );
  });

  it("looks up a reconcile adjustment's rate before it locks the account", async () => {
    const { cookie, base, euros } = await setup();
    await whileFetching(
      () =>
        send("POST", `${base}/accounts/${euros.id}/reconcile`, cookie, {
          balance: "5000",
          date: "2026-10-03",
        }),
      () => send("PATCH", `${base}/accounts/${euros.id}?today=${TODAY}`, cookie, { note: "hello" }),
    );
  });

  it("looks up a duplicate's rate before it locks the selected rows", async () => {
    const { cookie, base, euros, create, memo } = await setup();
    const original = await create({ accountId: euros.id, date: "2026-10-04", amount: "-1000" });
    await whileFetching(
      () =>
        send("POST", `${base}/transactions/bulk`, cookie, {
          selection: { ids: [original.id] },
          action: { type: "duplicate" },
        }),
      () => memo(original.id, "edited"),
    );
  });

  it("looks up the rate of a past schedule's first entry before it locks the transaction it replaces", async () => {
    const { cookie, base, euros, create, memo } = await setup();
    const original = await create({ accountId: euros.id, date: "2026-10-05", amount: "-1000" });
    await whileFetching(
      () =>
        send("POST", `${base}/scheduled-transactions`, cookie, {
          today: TODAY,
          accountId: euros.id,
          frequency: "never",
          date: "2026-10-05",
          amount: "-1000",
          payeeName: "Shop",
          categoryId: null,
          memo: "",
          flag: null,
          fromTransactionId: original.id,
        }),
      () => memo(original.id, "edited"),
    );
  });

  describe("entering a scheduled transaction", () => {
    async function scheduled() {
      const ctx = await setup();
      const res = await send("POST", `${ctx.base}/scheduled-transactions`, ctx.cookie, {
        today: TODAY,
        accountId: ctx.euros.id,
        frequency: "monthly",
        date: "2026-11-05",
        amount: "-1000",
        payeeName: "Rent",
        categoryId: null,
        memo: "",
        flag: null,
      });
      const { scheduledTransaction } = await json<{ scheduledTransaction: { id: string } }>(
        await ctx.ok(res, 201),
      );
      const edit = () =>
        send("PATCH", `${ctx.base}/scheduled-transactions/${scheduledTransaction.id}`, ctx.cookie, {
          today: TODAY,
          memo: "edited",
        });
      return { ...ctx, id: scheduledTransaction.id, edit };
    }

    it("looks up Enter Now's rate before it locks the schedule", async () => {
      const { cookie, base, id, edit } = await scheduled();
      await whileFetching(
        () =>
          send("POST", `${base}/scheduled-transactions/${id}/enter`, cookie, {
            today: "2026-10-07",
          }),
        edit,
      );
    });

    it("looks up a bulk Enter Now's rates before it locks the schedules", async () => {
      const { cookie, base, id, edit } = await scheduled();
      await whileFetching(
        () =>
          send("POST", `${base}/scheduled-transactions/bulk`, cookie, {
            ids: [id],
            today: "2026-10-08",
            action: { type: "enterNow" },
          }),
        edit,
      );
    });
  });

  it("looks up the rates of a split's current transfer lines when only its date changes", async () => {
    const { cookie, base, checking, euros, create, memo } = await setup();
    const groceries = (
      await json<{ groups: { kind: string | null; categories: { id: string }[] }[] }>(
        await send("GET", `${base}/categories`, cookie),
      )
    ).groups
      .filter((g) => !g.kind)
      .flatMap((g) => g.categories)[0];
    const split = await create({
      accountId: checking.id,
      date: "2026-10-05",
      amount: "-15000",
      payeeName: null,
      subtransactions: [
        { amount: "-10000", transferAccountId: euros.id },
        { amount: "-5000", categoryId: groceries?.id },
      ],
    });
    await whileFetching(
      () =>
        send("PATCH", `${base}/transactions/${split.id}?today=${TODAY}`, cookie, {
          date: "2026-10-09",
        }),
      () => memo(split.id, "edited"),
    );
  });

  it("doesn't ask a provider for a loan payment, which is always in the budget's currency", async () => {
    const { cookie, base, checking, ok } = await setup();
    const loan = json<{ id: string }>(
      await ok(
        await send("POST", `${base}/accounts`, cookie, {
          name: "Car",
          type: "auto_loan",
          balance: "-100000",
          date: "2026-10-01",
          interestRate: "5",
          minimumPayment: "10000",
        }),
        201,
      ),
    );
    const { id } = await loan;
    await db.execute(sql`delete from fx_rate`);
    const before = fx.calls.length;
    await ok(
      await send("POST", `${base}/accounts/${id}/loan/payments?today=${TODAY}`, cookie, {
        fromAccountId: checking.id,
        amount: "10000",
        date: "2026-10-06",
        memo: "",
      }),
      201,
    );
    expect(fx.calls.length).toBe(before);
  });
});
