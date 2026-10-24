import { afterAll, beforeEach, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

it("deletes a budget whose transactions include a split", async () => {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie);
  const base = `/v1/budgets/${budget.id}`;
  const acct = (await (
    await send("POST", `${base}/accounts`, cookie, {
      name: "C",
      type: "checking",
      balance: "1000",
      date: "2026-10-01",
    })
  ).json()) as { id: string };
  const { groups } = (await (await send("GET", `${base}/categories`, cookie)).json()) as {
    groups: { kind: string | null; categories: { id: string }[] }[];
  };
  const [a, b] = groups.filter((g) => !g.kind).flatMap((g) => g.categories);
  const r = await send("POST", `${base}/transactions`, cookie, {
    accountId: acct.id,
    date: "2026-10-02",
    amount: "-300",
    categoryId: null,
    subtransactions: [
      { amount: "-100", categoryId: a?.id },
      { amount: "-200", categoryId: b?.id },
    ],
  });
  expect(r.status).toBe(201);
  const del = await send("DELETE", base, cookie);
  expect(del.status, await del.text()).toBe(204);
});
