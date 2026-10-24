import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { invalidateMonths } from "./months";

describe("invalidateMonths", () => {
  it("marks months, spending pace and credit card health stale, leaving other reports alone", async () => {
    const client = new QueryClient();
    const keys = [
      ["get", "/v1/budgets/{budgetId}/months/{month}", { params: { path: { budgetId: "b" } } }],
      [
        "get",
        "/v1/budgets/{budgetId}/reports/spending-pace",
        { params: { path: { budgetId: "b" } } },
      ],
      [
        "get",
        "/v1/budgets/{budgetId}/reports/credit-card-health",
        { params: { path: { budgetId: "b" } } },
      ],
      [
        "get",
        "/v1/budgets/{budgetId}/reports/age-of-money",
        { params: { path: { budgetId: "b" } } },
      ],
    ];
    for (const key of keys) client.setQueryData(key, {});
    await invalidateMonths(client);
    expect(keys.map((key) => client.getQueryState(key)?.isInvalidated)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});
