import { describe, expect, it } from "vitest";
import {
  buildIncomeExpense,
  heatOf,
  type IncomeExpenseInput,
  incomeExpenseExport,
  incomeExpenseExportRows,
} from "./income-expense";

const input: IncomeExpenseInput = {
  months: ["2026-08", "2026-09", "2026-10"],
  income: [
    { month: "2026-10", payeeId: "shop", net: "-700" },
    { month: "2026-10", payeeId: "x65", net: "5000" },
    { month: "2026-10", payeeId: "citi", net: "1200" },
    { month: "2026-10", payeeId: null, net: "100" },
  ],
  payees: [
    { id: "shop", name: "Card Shop" },
    { id: "x65", name: "x-c12-65 Payee" },
    { id: "citi", name: "citi Statement Credit" },
  ],
  expenses: [
    { month: "2026-09", categoryId: "uncat", net: "-290000" },
    { month: "2026-10", categoryId: "uncat", net: "-283200" },
    { month: "2026-09", categoryId: "p1", net: "8000" },
    { month: "2026-10", categoryId: "p1", net: "-5000" },
    { month: "2026-08", categoryId: "groceries", net: "-300" },
    { month: "2026-10", categoryId: "groceries", net: "-700" },
    { month: "2026-10", categoryId: "r4", net: "0" },
  ],
  groups: [
    { id: "bills", name: "Bills", categories: [{ id: "rent", name: "Rent" }] },
    {
      id: "test",
      name: "Test",
      categories: [
        { id: "p2", name: "P2" },
        { id: "p1", name: "P1" },
      ],
    },
    {
      id: "needs",
      name: "Needs",
      categories: [
        { id: "r4", name: "R4" },
        { id: "groceries", name: "Groceries" },
      ],
    },
  ],
  uncategorizedCategoryId: "uncat",
};

describe("buildIncomeExpense", () => {
  const table = buildIncomeExpense(input);

  it("lists income by payee, alphabetical ignoring case, negatives kept", () => {
    expect(table.income.map((r) => [r.name, r.values.total])).toEqual([
      ["[No Payee]", 100n],
      ["Card Shop", -700n],
      ["citi Statement Credit", 1200n],
      ["x-c12-65 Payee", 5000n],
    ]);
    expect(table.totalIncome).toEqual({ months: [0n, 0n, 5600n], average: 1867n, total: 5600n });
  });

  it("puts Uncategorized first, then groups and categories with activity in plan order", () => {
    expect(table.uncategorized?.values).toEqual({
      months: [0n, -290000n, -283200n],
      average: -191067n,
      total: -573200n,
    });
    expect(table.groups.map((g) => [g.name, g.categories.map((c) => c.name)])).toEqual([
      ["Test", ["P1"]],
      // A category netting zero with activity is listed.
      ["Needs", ["R4", "Groceries"]],
    ]);
    expect(table.groups[0]?.total).toEqual({
      months: [0n, 8000n, -5000n],
      average: 1000n,
      total: 3000n,
    });
  });

  it("totals expenses and nets them against income", () => {
    expect(table.totalExpenses.months).toEqual([-300n, -282000n, -288900n]);
    expect(table.netIncome).toEqual({
      months: [-300n, -282000n, -283300n],
      average: -188533n,
      total: -565600n,
    });
  });

  it("gives the savings rate where there's income", () => {
    const rich = buildIncomeExpense({
      ...input,
      income: [{ month: "2026-10", payeeId: "x65", net: "300000" }],
    });
    // (300000 − 288900) / 300000 = 3.7%
    expect(rich.savingsRate.months).toEqual([null, null, 3.7]);
    expect(rich.savingsRate.total).toBeCloseTo(((300000 - 571200) / 300000) * 100, 2);
  });

  it("is empty but totalled with no activity", () => {
    const empty = buildIncomeExpense({ ...input, income: [], expenses: [] });
    expect(empty.income).toEqual([]);
    expect(empty.uncategorized).toBeNull();
    expect(empty.groups).toEqual([]);
    expect(empty.netIncome).toEqual({ months: [0n, 0n, 0n], average: 0n, total: 0n });
    expect(empty.savingsRate.total).toBeNull();
  });
});

describe("export", () => {
  const table = buildIncomeExpense(input);

  it("writes the export rows: group rows carry the total, no Total <Group> rows", () => {
    const rows = incomeExpenseExportRows(table, 2, "comma_dot");
    expect(rows.map((r) => r[0])).toEqual([
      "Category",
      "All Income Sources",
      "[No Payee]",
      "Card Shop",
      "citi Statement Credit",
      "x-c12-65 Payee",
      "Total Income",
      "Uncategorized Transactions",
      "Test",
      "P1",
      "Needs",
      "R4",
      "Groceries",
      "Total Expenses",
      "Net Income",
    ]);
    expect(rows[0]).toEqual(["Category", "Aug 2026", "Sep 2026", "Oct 2026", "Average", "Total"]);
  });

  it("writes a CSV without a byte-order mark", () => {
    const text = incomeExpenseExport(table, 2, "comma_dot", ",");
    const lines = text.split("\n");
    expect(lines[0]).toBe('"Category","Aug 2026","Sep 2026","Oct 2026","Average","Total"');
    expect(lines[7]).toBe('"Uncategorized Transactions",0.00,-2900.00,-2832.00,-1910.67,-5732.00');
    expect(lines.at(-1)).toBe('"Net Income",-3.00,-2820.00,-2833.00,-1885.33,-5656.00');
    expect(text.endsWith("\n")).toBe(false);
  });
});

describe("heatOf", () => {
  it("measures a month against the row's average", () => {
    expect(heatOf(-200n, -100n)).toBe(1);
    expect(heatOf(-150n, -100n)).toBe(0.5);
    expect(heatOf(-50n, -100n)).toBe(-0.5);
    expect(heatOf(500n, -100n)).toBe(-1);
    expect(heatOf(-100n, 0n)).toBeNull();
  });
});
