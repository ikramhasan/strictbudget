import { describe, expect, it } from "vitest";
import type { CategoryList } from "./categories";
import type { ReportSum, ReportTransaction } from "./reports";
import {
  type BreakdownRow,
  breakdownOf,
  breakdownRows,
  breakdownStats,
  comparedSpending,
  daysIn,
  exportNames,
  rowChange,
  shares,
  summaryExportRows,
  transactionsExportRows,
} from "./spending-breakdown";

const category = (id: string, groupId: string, name: string) =>
  ({ id, groupId, name, hidden: false }) as CategoryList["groups"][number]["categories"][number];

const categories: CategoryList = {
  readyToAssignCategoryId: "rta",
  uncategorizedCategoryId: "unc",
  savingsSuggestionDismissed: false,
  groups: [
    {
      id: "g-test",
      name: "Test",
      hidden: false,
      kind: null,
      categories: [category("o13", "g-test", "O13"), category("t8d", "g-test", "T8 D")],
    },
    {
      id: "g-wants",
      name: "Wants",
      hidden: false,
      kind: null,
      categories: [
        category("r4", "g-wants", "R4"),
        category("t2", "g-wants", "T2"),
        category("o11", "g-wants", "O11"),
      ],
    },
  ],
};

const sum = (categoryId: string, net: number, count = 1, month?: string): ReportSum => ({
  categoryId,
  ...(month && { month }),
  outflow: String(Math.min(net, 0)),
  inflow: String(Math.max(net, 0)),
  net: String(net),
  count,
});

const names = { categories, payees: [], accounts: [], flags: [] };

const october = [
  sum("unc", -283200, 21),
  sum("o13", -13000, 1),
  sum("o11", -3000, 1),
  sum("t8d", 2000, 3),
  sum("t2", 200, 1),
  sum("r4", 0, 2),
];

describe("spending breakdown rows", () => {
  it("lists categories most spent first and positive ones smallest first", () => {
    const b = breakdownOf(breakdownRows(october, "category", names));
    expect(b.spending.map((r) => r.name)).toEqual(["Uncategorized", "O13", "O11", "R4"]);
    expect(b.positive.map((r) => r.name)).toEqual(["T2", "T8 D"]);
    expect(b.grossOutflows).toBe(299200n);
    expect(b.positiveInflows).toBe(2200n);
    expect(b.total).toBe(297000n);
  });

  it("breaks ties by name", () => {
    const rows = breakdownRows([sum("o13", -3000), sum("o11", -3000)], "category", names);
    expect(breakdownOf(rows).spending.map((r) => r.name)).toEqual(["O11", "O13"]);
  });

  it("nets categories into their groups, Uncategorized as its own", () => {
    const b = breakdownOf(breakdownRows(october, "group", names));
    expect(b.spending.map((r) => [r.name, r.net])).toEqual([
      ["Uncategorized", -283200n],
      ["Test", -11000n],
      ["Wants", -2800n],
    ]);
    expect(b.positive).toEqual([]);
    expect(b.total).toBe(297000n);
  });

  it("opens one group with its categories", () => {
    const b = breakdownOf(breakdownRows(october, "group", names, "g-test"));
    expect(b.spending.map((r) => r.name)).toEqual(["O13"]);
    expect(b.positive.map((r) => r.name)).toEqual(["T8 D"]);
    expect(b.total).toBe(11000n);
  });

  it("names payees, accounts and flags", () => {
    const rows = breakdownRows(
      [
        { payeeId: "p1", outflow: "-500", inflow: "0", net: "-500", count: 1 },
        { payeeId: null, outflow: "-100", inflow: "0", net: "-100", count: 1 },
      ],
      "payee",
      { ...names, payees: [{ id: "p1", name: "Shop" }] },
    );
    expect(rows.map((r) => r.name)).toEqual(["Shop", "No payee"]);
    const flags = breakdownRows(
      [
        { flag: "red", outflow: "-1", inflow: "0", net: "-1", count: 1 },
        { flag: "blue", outflow: "-1", inflow: "0", net: "-1", count: 1 },
        { flag: null, outflow: "-1", inflow: "0", net: "-1", count: 1 },
      ],
      "flag",
      { ...names, flags: [{ color: "red", name: "Reimburse" }] },
    );
    expect(flags.map((r) => r.name)).toEqual(["Reimburse", "Blue", "No flag"]);
  });
});

describe("spending breakdown stats", () => {
  it("matches the October 2026 header ($3,601.00, $116.16 a day)", () => {
    const rows: BreakdownRow[] = [
      { key: "unc", name: "Uncategorized", color: "", net: -283200n, count: 21 },
      { key: "rest", name: "Rest", color: "", net: -82100n, count: 60 },
      { key: "pos", name: "Pos", color: "", net: 5200n, count: 3 },
    ];
    const stats = breakdownStats(breakdownOf(rows), { from: "2026-10", to: "2026-10" });
    expect(stats.total).toBe(360100n);
    expect(stats.averageMonthly).toBe(360100n);
    expect(stats.averageDaily).toBe(11616n);
    expect(stats.mostFrequent?.name).toBe("Rest");
  });

  it("averages over whole months", () => {
    expect(daysIn({ from: "2026-01", to: "2026-03" })).toBe(31 + 28 + 31);
    const rows: BreakdownRow[] = [{ key: "a", name: "A", color: "", net: -100000n, count: 1 }];
    const stats = breakdownStats(breakdownOf(rows), { from: "2026-08", to: "2026-10" });
    expect(stats.averageMonthly).toBe(33333n);
    expect(stats.averageDaily).toBe(1087n);
  });

  it("labels shares of gross outflows and of income", () => {
    const b = breakdownOf(breakdownRows(october, "category", names));
    const unc = b.spending[0] as BreakdownRow;
    expect(shares(unc, b, 400000n)).toEqual({ ofTotal: "95%", ofIncome: "71%" });
    expect(shares(b.spending[3] as BreakdownRow, b, undefined)).toEqual({
      ofTotal: "",
      ofIncome: "",
    });
  });

  it("compares with a period or an average month", () => {
    const before: BreakdownRow[] = [{ key: "a", name: "A", color: "", net: -30000n, count: 3 }];
    const range = { from: "2026-10", to: "2026-10" };
    const period = comparedSpending(
      before,
      { from: "2026-09", to: "2026-09", average: false },
      range,
    );
    const now: BreakdownRow = { key: "a", name: "A", color: "", net: -45000n, count: 1 };
    expect(rowChange(now, period)).toEqual({ before: 30000n, amount: 15000n, percent: 50 });
    const average = comparedSpending(
      before,
      { from: "2026-07", to: "2026-09", average: true },
      range,
    );
    expect(average.get("a")).toBe(10000n);
    expect(rowChange({ ...now, key: "b" }, average).before).toBe(0n);
  });
});

describe("spending breakdown export", () => {
  it("writes the summary in plan order with plain signed amounts", () => {
    const rows = summaryExportRows(
      [
        sum("o13", -13000, 1, "2026-09"),
        sum("o13", -2000, 1, "2026-10"),
        sum("unc", -500, 1, "2026-10"),
        sum("t2", 200, 1, "2026-10"),
      ],
      categories,
      { from: "2026-09", to: "2026-10" },
      "comma_dot",
      "USD",
    );
    expect(rows).toEqual([
      ["Category Group", "Category", "Sep 2026", "Oct 2026", "Average", "Total"],
      ["", "Uncategorized", { raw: "0.00" }, { raw: "-5.00" }, { raw: "-2.50" }, { raw: "-5.00" }],
      ["Test", "O13", { raw: "-130.00" }, { raw: "-20.00" }, { raw: "-75.00" }, { raw: "-150.00" }],
      ["Wants", "T2", { raw: "0.00" }, { raw: "2.00" }, { raw: "1.00" }, { raw: "2.00" }],
    ]);
  });

  it("writes the transactions in the export columns", () => {
    const line = (over: Partial<ReportTransaction>): ReportTransaction => ({
      id: "t",
      transactionId: "t",
      accountId: "a",
      accountName: "Checking",
      date: "2026-10-05",
      payeeId: "p",
      payeeName: "OShop",
      categoryId: "o13",
      groupName: "Test",
      categoryName: "O13",
      memo: "x-spend",
      flag: null,
      cleared: "uncleared",
      amount: "-13000",
      nativeAmount: "-13000",
      currency: "USD",
      ...over,
    });
    const rows = transactionsExportRows(
      [
        line({ flag: "red", cleared: "cleared" }),
        line({
          categoryId: "unc",
          groupName: "Internal",
          categoryName: "Uncategorized",
          amount: "300",
          cleared: "reconciled",
        }),
      ],
      "unc",
      (d) => d.split("-").reverse().join("/"),
      (a) => `$${a}`,
    );
    expect(rows[0]).toEqual([
      "Account",
      "Flag",
      "Date",
      "Payee",
      "Category Group/Category",
      "Category Group",
      "Category",
      "Memo",
      "Outflow",
      "Inflow",
      "Cleared",
    ]);
    expect(rows[1]).toEqual([
      "Checking",
      "Red",
      "05/10/2026",
      "OShop",
      "Test: O13",
      "Test",
      "O13",
      "x-spend",
      { raw: "$13000" },
      { raw: "$0" },
      "Cleared",
    ]);
    expect(rows[2]?.slice(4, 7)).toEqual(["", "", ""]);
    expect(rows[2]?.slice(8)).toEqual([{ raw: "$0" }, { raw: "$300" }, "Reconciled"]);
  });

  it("names the files with strictbudget's prefix", () => {
    expect(exportNames("2026-10-17")).toEqual({
      summary: "strictbudget-spending-breakdown-2026-10-17.csv",
      transactions: "strictbudget-spending-breakdown-2026-10-17-transactions.csv",
      zip: "strictbudget-spending-breakdown-2026-10-17.zip",
    });
  });
});
