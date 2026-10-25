import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Rule = { id: string; payeeId: string; operator: "contains" | "is"; text: string };
type RuleList = { rules: Rule[]; transferPayees: { payeeId: string; accountId: string }[] };
type Snapshot = Record<string, unknown>;

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
      balance: "10000",
      date: TODAY,
    }),
  );
  const payeeId = async (payeeName: string) => {
    const txn = await json<{ payeeId: string }>(
      await send("POST", `${base}/transactions`, owner.cookie, {
        accountId: account.id,
        date: TODAY,
        amount: "-500",
        payeeName,
        categoryId: null,
      }),
    );
    return txn.payeeId;
  };
  const addRule = async (payee: string, operator: "contains" | "is", text: string) => {
    const res = await send("POST", `${base}/payees/${payee}/rules`, owner.cookie, {
      operator,
      text,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return json<Rule>(res);
  };
  const list = async () => json<RuleList>(await send("GET", `${base}/payees/rules`, owner.cookie));
  const rulesOf = async (payee: string) =>
    (await list()).rules.filter((r) => r.payeeId === payee).map((r) => `${r.operator}:${r.text}`);
  return { owner, budget, base, account, payeeId, addRule, list, rulesOf };
}

describe("payee renaming rules", () => {
  it("adds, lists, edits and removes a payee's rules, in the order added", async () => {
    const { owner, base, payeeId, addRule, rulesOf } = await setup();
    const coffee = await payeeId("Coffee");
    const first = await addRule(coffee, "contains", "  Starbucks  ");
    // The same rule twice is allowed, and the text is kept as typed.
    await addRule(coffee, "is", "starbucks");
    await addRule(coffee, "is", "starbucks");
    expect(await rulesOf(coffee)).toEqual([
      "contains:  Starbucks  ",
      "is:starbucks",
      "is:starbucks",
    ]);

    const edited = await send("PATCH", `${base}/payees/rules/${first.id}`, owner.cookie, {
      operator: "is",
      text: "SBUX",
    });
    expect(edited.status).toBe(200);
    expect(await json<Rule>(edited)).toMatchObject({ operator: "is", text: "SBUX" });
    expect((await rulesOf(coffee))[0]).toBe("is:SBUX");

    expect((await send("DELETE", `${base}/payees/rules/${first.id}`, owner.cookie)).status).toBe(
      204,
    );
    expect(await rulesOf(coffee)).toEqual(["is:starbucks", "is:starbucks"]);
  });

  it("puts a rule back in its place when given a position (undoing a removal)", async () => {
    const { owner, base, payeeId, addRule, rulesOf } = await setup();
    const coffee = await payeeId("Coffee");
    const first = await addRule(coffee, "contains", "A");
    await addRule(coffee, "contains", "B");
    await send("DELETE", `${base}/payees/rules/${first.id}`, owner.cookie);
    const res = await send("POST", `${base}/payees/${coffee}/rules`, owner.cookie, {
      operator: "contains",
      text: "A",
      position: 0,
    });
    expect(res.status).toBe(201);
    await addRule(coffee, "is", "C");
    expect(await rulesOf(coffee)).toEqual(["contains:A", "contains:B", "is:C"]);
  });

  it("reads the position as the index in the list, after earlier removals left gaps", async () => {
    const { owner, base, payeeId, addRule, rulesOf } = await setup();
    const coffee = await payeeId("Coffee");
    const a = await addRule(coffee, "contains", "A");
    await addRule(coffee, "contains", "B");
    const c = await addRule(coffee, "contains", "C");
    await send("DELETE", `${base}/payees/rules/${a.id}`, owner.cookie);
    await send("DELETE", `${base}/payees/rules/${c.id}`, owner.cookie);
    // Undoing C's removal: it was second in the list (B, C) when removed.
    const res = await send("POST", `${base}/payees/${coffee}/rules`, owner.cookie, {
      operator: "contains",
      text: "C",
      position: 1,
    });
    expect(res.status).toBe(201);
    expect(await rulesOf(coffee)).toEqual(["contains:B", "contains:C"]);
  });

  it("refuses blank text and unknown conditions", async () => {
    const { owner, base, payeeId } = await setup();
    const coffee = await payeeId("Coffee");
    for (const body of [
      { operator: "contains", text: "" },
      { operator: "contains", text: "   " },
      { operator: "starts_with", text: "Star" },
    ]) {
      expect(
        (await send("POST", `${base}/payees/${coffee}/rules`, owner.cookie, body)).status,
      ).toBe(400);
    }
  });

  it("gives transfer payees rules, but not built-in payees", async () => {
    const { owner, base, account, addRule, list } = await setup();
    const { transferPayees } = await list();
    const transfer = transferPayees.find((t) => t.accountId === account.id);
    if (!transfer) throw new Error("no transfer payee");
    await addRule(transfer.payeeId, "contains", "PAYMENT THANK YOU");
    expect((await list()).rules.map((r) => r.payeeId)).toEqual([transfer.payeeId]);

    const txns = await json<{ transactions: { payeeId: string | null; payeeName: string }[] }>(
      await send("GET", `${base}/transactions`, owner.cookie),
    );
    const starting = txns.transactions.find((t) => t.payeeName === "Starting Balance");
    if (!starting?.payeeId) throw new Error("no Starting Balance payee");
    const res = await send("POST", `${base}/payees/${starting.payeeId}/rules`, owner.cookie, {
      operator: "is",
      text: "x",
    });
    expect(res.status).toBe(409);
  });

  it("keeps other budgets' payees and rules out", async () => {
    const { owner, base, payeeId, addRule } = await setup();
    const other = await createBudget(app, owner.cookie, { name: "Other" });
    const otherBase = `/v1/budgets/${other.id}`;
    const rule = await addRule(await payeeId("Coffee"), "is", "x");
    const stranger = await signUp(app);
    expect((await send("GET", `${base}/payees/rules`, stranger.cookie)).status).toBe(404);
    expect(
      (
        await send("POST", `${otherBase}/payees/${rule.payeeId}/rules`, owner.cookie, {
          operator: "is",
          text: "y",
        })
      ).status,
    ).toBe(404);
    expect(
      (await send("PATCH", `${otherBase}/payees/rules/${rule.id}`, owner.cookie, { text: "z" }))
        .status,
    ).toBe(404);
    expect(
      (await send("DELETE", `${otherBase}/payees/rules/${rule.id}`, owner.cookie)).status,
    ).toBe(404);
    expect(
      (await json<RuleList>(await send("GET", `${otherBase}/payees/rules`, owner.cookie))).rules,
    ).toEqual([]);
  });

  it("combining moves the others' rules after the target's, and undo puts them back", async () => {
    const { owner, base, payeeId, addRule, rulesOf } = await setup();
    const coffee = await payeeId("Coffee");
    const tea = await payeeId("Tea");
    await addRule(coffee, "contains", "Starbucks");
    await addRule(tea, "is", "TeaHouse");
    await addRule(coffee, "is", "SBUX");

    const res = await send("POST", `${base}/payees/combine`, owner.cookie, {
      payeeIds: [tea, coffee],
      name: "Tea",
    });
    expect(res.status).toBe(200);
    const { snapshot } = await json<{ snapshot: Snapshot }>(res);
    expect(await rulesOf(tea)).toEqual(["is:TeaHouse", "contains:Starbucks", "is:SBUX"]);
    expect(await rulesOf(coffee)).toEqual([]);

    expect((await send("POST", `${base}/payees/restore`, owner.cookie, snapshot)).status).toBe(204);
    expect(await rulesOf(tea)).toEqual(["is:TeaHouse"]);
    expect(await rulesOf(coffee)).toEqual(["contains:Starbucks", "is:SBUX"]);
  });

  it("deleting a payee deletes its rules, and undo brings them back", async () => {
    const { owner, base, payeeId, addRule, rulesOf, list } = await setup();
    const coffee = await payeeId("Coffee");
    const rule = await addRule(coffee, "contains", "Starbucks");

    const res = await send("POST", `${base}/payees/delete`, owner.cookie, {
      payeeIds: [coffee],
      replacementPayeeId: null,
    });
    expect(res.status).toBe(200);
    const { snapshot } = await json<{ snapshot: Snapshot }>(res);
    expect((await list()).rules).toEqual([]);

    expect((await send("POST", `${base}/payees/restore`, owner.cookie, snapshot)).status).toBe(204);
    expect(await rulesOf(coffee)).toEqual(["contains:Starbucks"]);
    expect((await list()).rules[0]?.id).toBe(rule.id);
  });

  it("refuses a snapshot whose rules point outside it", async () => {
    const { owner, base, payeeId, addRule } = await setup();
    const coffee = await payeeId("Coffee");
    const tea = await payeeId("Tea");
    const rule = await addRule(tea, "is", "TeaHouse");
    const res = await send("POST", `${base}/payees/restore`, owner.cookie, {
      payees: [{ id: coffee, name: "Coffee", hidden: false }],
      uses: [],
      rules: [{ ...rule, payeeId: tea, position: 0, createdAt: new Date().toISOString() }],
    });
    expect(res.status).toBe(400);
  });

  it("a fresh start copies the rules of people's and transfer payees", async () => {
    const { owner, budget, account, payeeId, addRule, list } = await setup();
    const coffee = await payeeId("Coffee");
    await addRule(coffee, "contains", "Starbucks");
    await addRule(coffee, "is", "SBUX");
    const transfer = (await list()).transferPayees.find((t) => t.accountId === account.id);
    if (!transfer) throw new Error("no transfer payee");
    await addRule(transfer.payeeId, "contains", "PAYMENT");

    const res = await send("POST", `/v1/budgets/${budget.id}/fresh-start`, owner.cookie, {
      date: TODAY,
      name: "Fresh",
    });
    expect(res.status).toBe(201);
    const fresh = await json<{ id: string }>(res);
    const freshBase = `/v1/budgets/${fresh.id}`;
    const copied = await json<RuleList>(
      await send("GET", `${freshBase}/payees/rules`, owner.cookie),
    );
    const payees = await json<{ payees: { id: string; name: string }[] }>(
      await send("GET", `${freshBase}/payees`, owner.cookie),
    );
    const newCoffee = payees.payees.find((p) => p.name === "Coffee")?.id;
    const newTransfer = copied.transferPayees[0]?.payeeId;
    expect(newCoffee).toBeDefined();
    expect(copied.transferPayees).toHaveLength(1);
    const show = (payee: string | undefined) =>
      copied.rules.filter((r) => r.payeeId === payee).map((r) => `${r.operator}:${r.text}`);
    expect(show(newCoffee)).toEqual(["contains:Starbucks", "is:SBUX"]);
    expect(show(newTransfer)).toEqual(["contains:PAYMENT"]);
    // The old budget keeps its own.
    expect((await list()).rules).toHaveLength(3);
  });
});
