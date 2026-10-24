import { describe, expect, it } from "vitest";
import { categoryNotNeeded } from "./category-cell";

describe("categoryNotNeeded", () => {
  const row = (
    accountType: Parameters<typeof categoryNotNeeded>[0]["accountType"],
    transferAccountType: Parameters<typeof categoryNotNeeded>[0]["transferAccountType"] = null,
    payeeName: string | null = "Shop",
  ) => categoryNotNeeded({ accountType, transferAccountType, payeeName });

  it("holds for tracking accounts, whatever the row", () => {
    expect(row("asset", null, "Starting Balance")).toBe(true);
    expect(row("asset")).toBe(true);
    expect(row("asset", "savings")).toBe(true);
  });

  it("holds for transfers within the budget", () => {
    expect(row("credit_card", "credit_card")).toBe(true);
    expect(row("savings", "checking")).toBe(true);
    expect(row("checking", "credit_card")).toBe(true);
  });

  it("holds for a card's Starting Balance, not a cash account's", () => {
    expect(row("credit_card", null, "Starting Balance")).toBe(true);
    expect(row("savings", null, "Starting Balance")).toBe(false);
  });

  it("doesn't hold for ordinary budget rows or the budget side of a tracking transfer", () => {
    expect(row("checking")).toBe(false);
    expect(row("credit_card")).toBe(false);
    expect(row("savings", "asset")).toBe(false);
  });
});
