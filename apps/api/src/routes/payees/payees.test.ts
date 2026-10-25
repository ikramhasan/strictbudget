import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Payee = { id: string; name: string; hidden: boolean; useCount: number };
type Txn = {
  id: string;
  payeeId: string | null;
  payeeName: string | null;
  categoryId: string | null;
  subtransactions: { id: string; payeeName: string | null }[];
};
type Snapshot = { payees: unknown[]; uses: unknown[] };

const TODAY = "2026-10-01";

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;

async function setup() {
  const owner = await signUp(app);
  const budget = await createBudget(app, owner.cookie);
  const base = `/v1/budgets/${budget.id}`;
  const account = await json<{ id: string }>(
    await send("POST", `${base}/accounts`, owner.cookie, {
      name: "Checking",
      type: "checking",
      balance: "0",
      date: TODAY,
    }),
  );
  const savings = await json<{ id: string }>(
    await send("POST", `${base}/accounts`, owner.cookie, {
      name: "Savings",
      type: "savings",
      balance: "0",
      date: TODAY,
    }),
  );
  const spend = async (payeeName: string | null, extra: Record<string, unknown> = {}) =>
    json<Txn>(
      await send("POST", `${base}/transactions`, owner.cookie, {
        accountId: account.id,
        date: TODAY,
        amount: "-500",
        payeeName,
        categoryId: null,
        ...extra,
      }),
    );
  const payees = async () =>
    (await json<{ payees: Payee[] }>(await send("GET", `${base}/payees`, owner.cookie))).payees;
  const byName = async (name: string) => {
    const found = (await payees()).find((p) => p.name === name);
    if (!found) throw new Error(`no payee ${name}`);
    return found;
  };
  const txns = async () =>
    (await json<{ transactions: Txn[] }>(await send("GET", `${base}/transactions`, owner.cookie)))
      .transactions;
  return { owner, base, account, savings, spend, payees, byName, txns };
}

describe("payees", () => {
  it("lists people's payees with use counts, leaving out transfer and built-in ones", async () => {
    const { base, owner, savings, spend, payees, account } = await setup();
    await spend("Grocer");
    await spend("Grocer");
    await spend(null, { transferAccountId: savings.id, payeeName: undefined });
    await send("POST", `${base}/scheduled-transactions`, owner.cookie, {
      accountId: account.id,
      date: "2026-12-01",
      today: TODAY,
      frequency: "monthly",
      amount: "-100",
      payeeName: "Gym",
      categoryId: null,
    });
    const list = await payees();
    expect(list.map((p) => [p.name, p.useCount, p.hidden])).toEqual([
      ["Grocer", 2, false],
      ["Gym", 1, false],
    ]);
  });

  it("adds the transfer and built-in payees when asked for all of them", async () => {
    const { base, owner, savings, spend } = await setup();
    await spend("Grocer");
    await spend(null, { transferAccountId: savings.id, payeeName: undefined });
    const all = await json<{ payees: Payee[] }>(
      await send("GET", `${base}/payees?include=all`, owner.cookie),
    );
    const names = all.payees.map((p) => p.name);
    expect(names).toEqual(
      expect.arrayContaining(["Grocer", "Transfer : Checking", "Transfer : Savings"]),
    );
    expect(names).toContain("Starting Balance");
  });

  it("lists everything using some payees, newest first, scheduled included", async () => {
    const { base, owner, spend, byName, account } = await setup();
    await spend("Gym", { date: "2026-09-01", memo: "x-old" });
    await spend("Gym", { date: "2026-09-15", amount: "-700" });
    await spend("Other", {
      subtransactions: [
        { amount: "-200", payeeName: "Gym", categoryId: null, memo: "x-line" },
        { amount: "-300", payeeName: null, categoryId: null },
      ],
    });
    await send("POST", `${base}/scheduled-transactions`, owner.cookie, {
      accountId: account.id,
      date: "2026-12-01",
      today: TODAY,
      frequency: "monthly",
      amount: "-100",
      payeeName: "Gym",
      categoryId: null,
    });
    const gym = await byName("Gym");
    const res = await json<{
      transactions: {
        kind: string;
        date: string;
        amount: string;
        memo: string;
        accountName: string;
        categoryName: string | null;
      }[];
    }>(await send("GET", `${base}/payees/transactions?payeeIds=${gym.id}`, owner.cookie));
    expect(res.transactions.map((t) => [t.kind, t.date, t.amount, t.memo])).toEqual([
      ["scheduled", "2026-12-01", "-100", ""],
      ["transaction", TODAY, "-200", "x-line"],
      ["transaction", "2026-09-15", "-700", ""],
      ["transaction", "2026-09-01", "-500", "x-old"],
    ]);
    expect(res.transactions[0]).toMatchObject({ accountName: "Checking", categoryName: null });
  });

  it("renames, refusing an empty name or one another payee has", async () => {
    const { base, owner, spend, byName, txns } = await setup();
    await spend("Grocer");
    await spend("Bakery");
    const grocer = await byName("Grocer");
    const path = `${base}/payees/${grocer.id}`;

    const empty = await send("PATCH", path, owner.cookie, { name: "  " });
    expect(empty.status).toBe(400);
    const taken = await send("PATCH", path, owner.cookie, { name: "bakery" });
    expect(taken.status).toBe(409);
    expect((await json<{ error: { code: string } }>(taken)).error.code).toBe("PAYEE_NAME_TAKEN");

    // Changing only the case of its own name is fine.
    const renamed = await json<Payee>(await send("PATCH", path, owner.cookie, { name: "GROCER" }));
    expect(renamed.name).toBe("GROCER");
    const names = (await txns()).map((t) => t.payeeName).filter((n) => n !== "Starting Balance");
    expect(names.sort()).toEqual(["Bakery", "GROCER"]);
  });

  it("hides payees; typing a hidden payee's name still uses it and keeps it hidden", async () => {
    const { base, owner, spend, byName } = await setup();
    await spend("Trip Cafe");
    await spend("Hotel");
    const cafe = await byName("Trip Cafe");
    const hotel = await byName("Hotel");
    const hid = await send("POST", `${base}/payees/hide`, owner.cookie, {
      payeeIds: [cafe.id, hotel.id],
      hidden: true,
    });
    expect(hid.status).toBe(204);
    expect((await byName("Hotel")).hidden).toBe(true);

    const again = await spend("trip cafe");
    expect(again.payeeId).toBe(cafe.id);
    expect(await byName("Trip Cafe")).toMatchObject({ hidden: true, useCount: 2 });

    const shown = await json<Payee>(
      await send("PATCH", `${base}/payees/${hotel.id}`, owner.cookie, { hidden: false }),
    );
    expect(shown.hidden).toBe(false);
  });

  it("combines payees into the first one's id under a new name, and undoes it", async () => {
    const { base, owner, spend, byName, txns, payees } = await setup();
    const a = await spend("Alpha");
    const b = await spend("Beta");
    const split = await spend(null, {
      payeeName: "Other",
      subtransactions: [
        { amount: "-200", payeeName: "Beta", categoryId: null },
        { amount: "-300", payeeName: null, categoryId: null },
      ],
    });
    const beta = await byName("Beta");
    const alpha = await byName("Alpha");

    const combined = await json<{ payee: Payee; snapshot: Snapshot }>(
      await send("POST", `${base}/payees/combine`, owner.cookie, {
        payeeIds: [beta.id, alpha.id],
        name: "Combo",
      }),
    );
    expect(combined.payee).toMatchObject({ id: beta.id, name: "Combo", useCount: 3 });
    expect((await payees()).map((p) => p.name)).toEqual(["Combo", "Other"]);
    const after = await txns();
    expect(after.find((t) => t.id === a.id)?.payeeId).toBe(beta.id);
    expect(after.find((t) => t.id === b.id)?.payeeId).toBe(beta.id);
    expect(after.find((t) => t.id === split.id)?.subtransactions[0]?.payeeName).toBe("Combo");

    const restored = await send("POST", `${base}/payees/restore`, owner.cookie, combined.snapshot);
    expect(restored.status).toBe(204);
    expect((await payees()).map((p) => [p.name, p.useCount])).toEqual([
      ["Alpha", 1],
      ["Beta", 2],
      ["Other", 1],
    ]);
    const undone = await txns();
    expect(undone.find((t) => t.id === a.id)?.payeeId).toBe(alpha.id);
    expect(undone.find((t) => t.id === b.id)?.payeeId).toBe(beta.id);
  });

  it("combines into a payee that already has the name, selected or not", async () => {
    const { base, owner, spend, byName, payees } = await setup();
    await spend("Alpha");
    await spend("Beta");
    await spend("Delta");
    const [alpha, beta, delta] = [
      await byName("Alpha"),
      await byName("Beta"),
      await byName("Delta"),
    ];
    const combined = await json<{ payee: Payee }>(
      await send("POST", `${base}/payees/combine`, owner.cookie, {
        payeeIds: [alpha.id, beta.id],
        name: "Delta",
      }),
    );
    expect(combined.payee).toMatchObject({ id: delta.id, name: "Delta", useCount: 3 });
    expect((await payees()).map((p) => p.name)).toEqual(["Delta"]);
  });

  it("deletes payees, moving their transactions to another payee or none, and undoes it", async () => {
    const { base, owner, spend, byName, txns, payees, account } = await setup();
    const g = await spend("Gamma");
    await spend("Delta");
    await spend("Unused");
    const { scheduledTransaction: scheduled } = await json<{
      scheduledTransaction: { id: string };
    }>(
      await send("POST", `${base}/scheduled-transactions`, owner.cookie, {
        accountId: account.id,
        date: "2026-12-01",
        today: TODAY,
        frequency: "monthly",
        amount: "-100",
        payeeName: "Gamma",
        categoryId: null,
      }),
    );
    const gamma = await byName("Gamma");
    const delta = await byName("Delta");

    const self = await send("POST", `${base}/payees/delete`, owner.cookie, {
      payeeIds: [gamma.id],
      replacementPayeeId: gamma.id,
    });
    expect(self.status).toBe(409);

    const deleted = await json<{ snapshot: Snapshot }>(
      await send("POST", `${base}/payees/delete`, owner.cookie, {
        payeeIds: [gamma.id],
        replacementPayeeId: delta.id,
      }),
    );
    expect((await txns()).find((t) => t.id === g.id)?.payeeId).toBe(delta.id);
    expect(await byName("Delta")).toMatchObject({ useCount: 3 });

    await send("POST", `${base}/payees/restore`, owner.cookie, deleted.snapshot);
    expect((await txns()).find((t) => t.id === g.id)?.payeeId).toBe(gamma.id);
    expect(await byName("Gamma")).toMatchObject({ id: gamma.id, useCount: 2 });

    await send("POST", `${base}/payees/delete`, owner.cookie, {
      payeeIds: [gamma.id],
      replacementPayeeId: null,
    });
    expect((await txns()).find((t) => t.id === g.id)?.payeeId).toBeNull();
    const list = await json<{ scheduledTransactions: { id: string; payeeId: string | null }[] }>(
      await send("GET", `${base}/scheduled-transactions?today=${TODAY}`, owner.cookie),
    );
    expect(list.scheduledTransactions.find((s) => s.id === scheduled.id)?.payeeId).toBeNull();
    expect((await payees()).map((p) => p.name)).toEqual(["Delta", "Unused"]);
  });

  it("refuses to change transfer payees, and payees of another budget are 404", async () => {
    const { base, owner, spend, savings, txns } = await setup();
    await spend(null, { transferAccountId: savings.id, payeeName: undefined });
    const transferPayeeId = (await txns())[0]?.payeeId as string;
    const res = await send("PATCH", `${base}/payees/${transferPayeeId}`, owner.cookie, {
      name: "Nope",
    });
    expect(res.status).toBe(409);
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe("PAYEE_LOCKED");

    const other = await setup();
    await other.spend("Theirs");
    const theirs = await other.byName("Theirs");
    expect(
      (await send("PATCH", `${base}/payees/${theirs.id}`, owner.cookie, { name: "Mine" })).status,
    ).toBe(404);
    expect(
      (
        await send("POST", `${base}/payees/delete`, owner.cookie, {
          payeeIds: [theirs.id],
          replacementPayeeId: null,
        })
      ).status,
    ).toBe(404);
    // Someone else's budget is 404 outright.
    expect((await send("GET", `${other.base}/payees`, owner.cookie)).status).toBe(404);
  });
});
