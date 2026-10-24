import { describe, expect, it } from "vitest";
import { type Budget, lastUsedLabel, pickBudgetRedirect } from "./budgets";

const budget = (id: string, archivedAt: string | null = null) => ({ id, archivedAt }) as Budget;

describe("pickBudgetRedirect", () => {
  it("prefers the last-used budget", () => {
    expect(pickBudgetRedirect({ budgets: [budget("a"), budget("b")], lastUsedBudgetId: "b" })).toBe(
      "b",
    );
  });

  it("falls back to the first budget", () => {
    expect(
      pickBudgetRedirect({ budgets: [budget("a"), budget("b")], lastUsedBudgetId: null }),
    ).toBe("a");
  });

  it("returns null when there are no budgets", () => {
    expect(pickBudgetRedirect({ budgets: [], lastUsedBudgetId: null })).toBeNull();
  });

  it("skips archived budgets when falling back", () => {
    expect(
      pickBudgetRedirect({
        budgets: [budget("old", "2026-10-01T00:00:00.000Z"), budget("new")],
        lastUsedBudgetId: null,
      }),
    ).toBe("new");
  });
});

describe("lastUsedLabel", () => {
  const now = new Date("2026-10-15T08:20:00Z");
  it.each([
    ["2026-10-15T08:19:50Z", "Last used a few seconds ago"],
    ["2026-10-15T08:11:00Z", "Last used 9 minutes ago"],
    ["2026-10-14T06:00:00Z", "Last used a day ago"],
    ["2026-10-13T06:00:00Z", "Last used 2 days ago"],
  ])("%s", (at, label) => {
    expect(lastUsedLabel(at, now)).toBe(label);
  });
});
