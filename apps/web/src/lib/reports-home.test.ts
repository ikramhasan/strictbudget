import { describe, expect, it } from "vitest";
import { describeObservation } from "@/components/reports/home-parts";
import {
  averageSpent,
  categorySpending,
  incomeByMonth,
  monthsWithData,
  savingsRate,
  spentByMonth,
} from "./reports-home";

const sum = (fields: Record<string, string>) => ({
  outflow: "0",
  inflow: "0",
  count: 1,
  net: "0",
  ...fields,
});

describe("Reports home figures", () => {
  it("turns category nets into spending and income by month", () => {
    expect(
      spentByMonth([
        sum({ month: "2026-10", net: "-5000" }),
        sum({ month: "2026-10", net: "200" }),
      ]),
    ).toEqual(new Map([["2026-10", 4800n]]));
    expect(incomeByMonth([sum({ month: "2026-09", net: "320000" })])).toEqual(
      new Map([["2026-09", 320000n]]),
    );
  });

  it("averages spending from the first month with any", () => {
    const spent = new Map([
      ["2026-08", 30000n],
      ["2026-09", 10000n],
      ["2026-10", 99999n],
    ] as const);
    expect(averageSpent(spent, "2026-10")).toEqual({ months: [30000n, 10000n], average: 20000n });
    expect(averageSpent(new Map(), "2026-10")).toEqual({ months: [], average: 0n });
  });

  it("works out the savings rate for display only", () => {
    expect(savingsRate(400000n, 100000n)).toBe(75);
    expect(savingsRate(0n, 100n)).toBeNull();
    expect(savingsRate(100n, 150n)).toBe(-50);
  });

  it("lists a category's previous months from its first spending", () => {
    const rows = [
      sum({ month: "2026-06", categoryId: "g", net: "-100" }),
      sum({ month: "2026-08", categoryId: "g", net: "-300" }),
      sum({ month: "2026-10", categoryId: "g", net: "-900" }),
      sum({ month: "2026-10", categoryId: "n", net: "-50" }),
    ];
    expect(categorySpending(rows, "2026-10", new Map([["g", "Groceries"]]))).toEqual([
      { categoryId: "g", name: "Groceries", spent: 900n, previous: [100n, 0n, 300n, 0n] },
      { categoryId: "n", name: "", spent: 50n, previous: [] },
    ]);
  });

  it("words observations plainly and links their evidence", () => {
    const format = (m: bigint) => `$${m}`;
    expect(
      describeObservation(
        {
          rule: "income_lower",
          month: "2026-09",
          income: 80n,
          previousMonth: "2026-08",
          previousIncome: 100n,
        },
        "2026-10",
        format,
      ),
    ).toEqual({
      text: "Income in September 2026 was $80, $20 less than in August 2026.",
      target: {
        to: "/budgets/$budgetId/reports/income-expense",
        search: { from: "2026-08", to: "2026-09" },
      },
    });
    expect(
      describeObservation(
        {
          rule: "category_above_average",
          categoryId: "g",
          name: "Groceries",
          spent: 125n,
          average: 100n,
          percentAbove: 25,
        },
        "2026-10",
        format,
      ).target.search,
    ).toEqual({ from: "2026-04", to: "2026-10", categories: "g" });
  });
});

describe("monthsWithData", () => {
  const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"] as const;
  it("starts at the first month with data", () => {
    expect(monthsWithData(months, (m) => m >= "2026-03")).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
  });
  it("keeps the last three months when data starts later or never", () => {
    expect(monthsWithData(months, (m) => m === "2026-06")).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
    expect(monthsWithData(months, () => false)).toEqual(["2026-04", "2026-05", "2026-06"]);
  });
});
