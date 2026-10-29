import { describe, expect, it } from "vitest";
import type { CategoryList } from "./categories";
import type { MoneyOption } from "./months";
import { savingsLast, savingsSuggestions, savingsWarning } from "./savings";

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

describe("savingsSuggestions", () => {
  type Category = CategoryList["groups"][number]["categories"][number];
  const category = (id: string, name: string, extra: Partial<Category> = {}): Category => ({
    id,
    groupId: "g",
    name,
    note: "",
    hidden: false,
    linkedAccountId: null,
    hasTransactions: false,
    transactionCount: 0,
    hasAssignedMoney: false,
    savings: false,
    target: null,
    ...extra,
  });
  const balance = {
    cadence: "custom" as const,
    behavior: "balance" as const,
    amount: "100000",
    currency: "USD" as const,
    dueDay: null,
    dueDate: null,
    repeatEvery: null,
    repeatUnit: null,
    startMonth: "2026-10",
    startDay: null,
    snoozedMonth: null,
    goal: null,
    goalAmount: null,
  };
  const list: CategoryList = {
    readyToAssignCategoryId: "rta",
    uncategorizedCategoryId: "uncat",
    savingsSuggestionDismissed: false,
    groups: [
      {
        id: "cards",
        name: "Credit Card Payments",
        hidden: false,
        kind: "credit_card_payments",
        categories: [category("visa", "Visa Savings Card", { linkedAccountId: "a" })],
      },
      {
        id: "needs",
        name: "Needs",
        hidden: false,
        kind: null,
        categories: [
          category("ef", "😌 Emergency fund"),
          category("car", "Car repairs", { target: balance }),
          category("food", "Groceries"),
          category("radio", "📻 Emergency Radio"),
          category("done", "Rainy day", { savings: true }),
          category("gone", "Old savings", { hidden: true }),
        ],
      },
      {
        id: "goals",
        name: "Short-Term Savings",
        hidden: false,
        kind: null,
        categories: [category("bike", "New bike")],
      },
      {
        id: "hidden",
        name: "Savings",
        hidden: true,
        kind: null,
        categories: [category("old", "Old fund")],
      },
    ],
  };

  it("finds visible spending categories named like savings or with a balance target", () => {
    expect(savingsSuggestions(list).map((c) => c.name)).toEqual([
      "😌 Emergency fund",
      "Car repairs",
      "New bike",
    ]);
  });
});
