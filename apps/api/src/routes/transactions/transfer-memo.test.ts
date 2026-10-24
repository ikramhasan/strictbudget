import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Line = { id: string; memo: string; transferTransactionId: string | null };
type Txn = {
  id: string;
  memo: string;
  transferTransactionId: string | null;
  subtransactions: Line[];
};

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
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie);
  const base = `/v1/budgets/${budget.id}`;
  const addAccount = async (name: string, type: string) =>
    (
      await json<{ id: string }>(
        await send("POST", `${base}/accounts`, cookie, { name, type, balance: "0", date: TODAY }),
      )
    ).id;
  const checking = await addAccount("Checking", "checking");
  const savings = await addAccount("Savings", "savings");
  const post = async (input: Record<string, unknown>) => {
    const res = await send("POST", `${base}/transactions`, cookie, {
      date: TODAY,
      categoryId: null,
      accountId: checking,
      ...input,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return json<Txn>(res);
  };
  const patch = async (id: string, body: Record<string, unknown>) => {
    const res = await send("PATCH", `${base}/transactions/${id}`, cookie, body);
    expect(res.status, await res.clone().text()).toBe(200);
  };
  const bulkMemo = async (ids: string[], memo: string) => {
    const res = await send("POST", `${base}/transactions/bulk`, cookie, {
      selection: { ids },
      action: { type: "memo", memo },
    });
    expect(res.status, await res.clone().text()).toBe(200);
  };
  const find = async (id: string) =>
    (
      await json<{ transactions: Txn[] }>(await send("GET", `${base}/transactions`, cookie))
    ).transactions.find((t) => t.id === id);
  const memo = async (id: string) => (await find(id))?.memo;
  return { checking, savings, post, patch, bulkMemo, find, memo };
}

describe("a transfer's memo", () => {
  it("is shared by single edits on either side", async () => {
    const { savings, post, patch, memo } = await setup();
    const out = await post({ amount: "-5000", transferAccountId: savings, memo: "first" });
    const otherId = out.transferTransactionId ?? "";
    expect(await memo(otherId)).toBe("first");

    await patch(out.id, { memo: "from checking" });
    expect(await memo(otherId)).toBe("from checking");
    await patch(otherId, { memo: "from savings" });
    expect(await memo(out.id)).toBe("from savings");
  });

  it("is per side for the bulk Memo action, and a save that leaves it alone keeps it so", async () => {
    const { savings, post, patch, bulkMemo, memo } = await setup();
    const out = await post({ amount: "-5000", transferAccountId: savings, memo: "both" });
    const otherId = out.transferTransactionId ?? "";

    await bulkMemo([otherId], "savings only");
    expect(await memo(otherId)).toBe("savings only");
    expect(await memo(out.id)).toBe("both");

    // Saving the checking row with its memo unchanged doesn't copy it over.
    await patch(out.id, { memo: "both", amount: "-6000" });
    expect(await memo(otherId)).toBe("savings only");
  });

  it("is shared between a split's transfer line and its other side, both ways", async () => {
    const { savings, post, patch, find, memo } = await setup();
    const split = await post({
      amount: "-7000",
      payeeName: "Shop",
      subtransactions: [
        { amount: "-3000", transferAccountId: savings, memo: "line" },
        { amount: "-4000", memo: "other line" },
      ],
    });
    const [line, rest] = split.subtransactions;
    const otherId = line?.transferTransactionId ?? "";
    expect(await memo(otherId)).toBe("line");

    await patch(otherId, { memo: "from savings" });
    expect((await find(split.id))?.subtransactions.map((l) => l.memo)).toEqual([
      "from savings",
      "other line",
    ]);

    await patch(split.id, {
      subtransactions: [
        { id: line?.id, amount: "-3000", transferAccountId: savings, memo: "from the split" },
        { id: rest?.id, amount: "-4000", memo: "other line" },
      ],
    });
    expect(await memo(otherId)).toBe("from the split");
  });
});
