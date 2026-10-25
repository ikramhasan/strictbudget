import { describe, expect, it } from "vitest";
import { isBudgetQuery } from "./live-updates";

describe("live updates", () => {
  it("refetches the budget's own queries and the budget list, not other budgets'", () => {
    const month = [
      "get",
      "/v1/budgets/{budgetId}/months/{month}",
      { params: { path: { budgetId: "b1", month: "2026-10" } } },
    ];
    const register = ["register", "b1", { accountId: "a" }];
    const other = [
      "get",
      "/v1/budgets/{budgetId}/months/{month}",
      { params: { path: { budgetId: "b2" } } },
    ];
    const list = ["get", "/v1/budgets"];
    const me = ["get", "/v1/me"];
    const check = (queryKey: unknown[]) => isBudgetQuery({ queryKey }, "b1");
    expect([month, register, other, list, me].map(check)).toEqual([true, true, false, true, false]);
  });
});
