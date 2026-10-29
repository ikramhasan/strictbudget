import { describe, expect, it } from "vitest";
import type { MoneyOption } from "./months";
import { savingsLast, savingsWarning } from "./savings";

const format = (a: string) => `$${(Number(a) / 100).toFixed(2)}`;
const option = (
  name: string,
  available: string,
  savings?: MoneyOption["savings"],
  group = "Needs",
): MoneyOption => ({ id: name, name, group, available, ...(savings && { savings }) });

describe("savingsLast", () => {
  it("offers spending money first and savings together at the end", () => {
    const options = [
      option("Emergency fund", "900000", { goal: null }),
      option("Groceries", "15000"),
      option("Vacation", "40000", { goal: null }, "Wants"),
      option("Dining out", "12000", undefined, "Wants"),
    ];
    expect(savingsLast(options).map((o) => [o.name, o.group])).toEqual([
      ["Groceries", "Needs"],
      ["Dining out", "Wants"],
      ["Emergency fund", "Savings"],
      ["Vacation", "Savings"],
    ]);
  });
});

describe("savingsWarning", () => {
  it("says what a safety fund falls short by", () => {
    const fund = option("Emergency fund", "1000000", {
      goal: { kind: "safety_fund", needed: 1_000_000n, funded: 1_000_000n },
    });
    expect(savingsWarning(fund, 20000n, format)).toBe(
      "Emergency fund will be $200.00 below its $10000.00, and its goal will ask for it back.",
    );
    // Above the balance to keep, it only says money leaves savings.
    const over = { ...fund, available: "1050000" };
    expect(savingsWarning(over, 20000n, format)).toBe(
      "This takes $200.00 out of the money you've set aside in Emergency fund.",
    );
  });

  it("says where a save-up goal's progress drops to", () => {
    const vacation = option("Vacation", "40000", {
      goal: { kind: "save_up", needed: 150_000n, funded: 140_000n },
    });
    expect(savingsWarning(vacation, 10000n, format)).toBe(
      "Vacation's progress drops to $1300.00 of $1500.00.",
    );
  });

  it("says nothing for spending money or nothing taken", () => {
    expect(savingsWarning(option("Groceries", "15000"), 1000n, format)).toBeNull();
    expect(savingsWarning(option("Rainy day", "15000", { goal: null }), 0n, format)).toBeNull();
    expect(savingsWarning(undefined, 1000n, format)).toBeNull();
  });
});
