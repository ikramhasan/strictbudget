import { describe, expect, it } from "vitest";
import type { CategoryList } from "./categories";
import {
  OTHER_COLOR,
  type ReportSum,
  type ReportTransaction,
  UNCATEGORIZED_COLOR,
} from "./reports";
import {
  type BreakdownRow,
  breakdownOf,
  breakdownRows,
  breakdownStats,
  comparedSpending,
  daysIn,
  drawOrder,
  exportNames,
  rowChange,
  shares,
  summaryExportRows,
  transactionsExportRows,
} from "./spending-breakdown";
import { catalogOf, seriesColors, seriesInfo } from "./spending-trends";

const category = (id: string, groupId: string, name: string) =>
  ({ id, groupId, name, hidden: false }) as CategoryList["groups"][number]["categories"][number];

const categories: CategoryList = {
  readyToAssignCategoryId: "rta",
  uncategorizedCategoryId: "unc",
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
  it("names the biggest rows with the palette, never repeating a colour, Uncategorized grey", () => {
    // Ten categories in one group: eight colours, then the smallest share Other's colour.
    const many: CategoryList = {
      ...categories,
      groups: [
        {
          id: "g",
          name: "G",
          hidden: false,
          kind: null,
          categories: Array.from({ length: 10 }, (_, i) => category(`c${i}`, "g", `C${i}`)),
        },
      ],
    };
    const rows = breakdownRows(
      [sum("unc", -100), ...Array.from({ length: 10 }, (_, i) => sum(`c${i}`, -1000 * (i + 1)))],
      "category",
      { ...names, categories: many },
    );
    const b = breakdownOf(rows);
    const colors = b.spending.map((r) => r.color);
    expect(new Set(colors.slice(0, 8)).size).toBe(8);
    // Each takes its place in the plan's colour: C2 the third, C9 the second (C1 isn't named).
    const color = (key: string) => b.spending.find((r) => r.key === key)?.color;
    expect(color("c2")).toBe("var(--report-3)");
    expect(color("c9")).toBe("var(--report-2)");
    expect(color("c8")).toBe("var(--report-1)");
    expect(b.spending.find((r) => r.key === "unc")?.color).toBe(UNCATEGORIZED_COLOR);
    // Past the palette, the smallest rows share Other's colour (the donut's "Other" slice).
    expect(colors.filter((c) => c === OTHER_COLOR)).toHaveLength(2);
    expect(b.spending.at(-2)?.color).toBe(OTHER_COLOR);
  });

  it("colours each category and group by its place in the plan, whatever it spent", () => {
    const sums = [sum("o13", -5000), sum("r4", -4000), sum("t8d", -3000), sum("t2", -2000)];
    const byCategory = breakdownOf(breakdownRows(sums, "category", names));
    expect(Object.fromEntries(byCategory.spending.map((r) => [r.key, r.color]))).toEqual({
      o13: "var(--report-1)",
      t8d: "var(--report-2)",
      r4: "var(--report-3)",
      t2: "var(--report-4)",
    });
    expect(drawOrder(byCategory.spending).map((r) => r.key)).toEqual(["o13", "t8d", "r4", "t2"]);
    // Spending ranked the other way round, each keeps its colour.
    const flipped = [sum("o13", -2000), sum("r4", -3000), sum("t8d", -4000), sum("t2", -5000)];
    const again = breakdownOf(breakdownRows(flipped, "category", names));
    expect(Object.fromEntries(again.spending.map((r) => [r.key, r.color]))).toEqual(
      Object.fromEntries(byCategory.spending.map((r) => [r.key, r.color])),
    );
    // Spending Trends gives each the same colour.
    const catalog = catalogOf(categories);
    const trends = seriesColors(["t2", "r4", "o13", "t8d"], (k) =>
      seriesInfo(catalog, "category", k),
    );
    for (const r of byCategory.spending) expect(trends.get(r.key)).toBe(r.color);
    const byGroup = breakdownOf(breakdownRows(sums, "group", names));
    expect(Object.fromEntries(byGroup.spending.map((r) => [r.key, r.color]))).toEqual({
      "g-test": "var(--report-1)",
      "g-wants": "var(--report-2)",
    });
  });

  it("colours payees by who they are, not by rank", () => {
    const payees = [
      { id: "p1", name: "P1" },
      { id: "p2", name: "P2" },
    ];
    const rows = breakdownRows(
      [
        { ...sum("x", -100), categoryId: null, payeeId: "p1" },
        { ...sum("x", -900), categoryId: null, payeeId: "p2" },
      ],
      "payee",
      { ...names, payees },
    );
    const colors = new Map(breakdownOf(rows).spending.map((r) => [r.key, r.color]));
    expect(colors.get("p1")).not.toBe(colors.get("p2"));
    const swapped = breakdownRows(
      [
        { ...sum("x", -900), categoryId: null, payeeId: "p1" },
        { ...sum("x", -100), categoryId: null, payeeId: "p2" },
      ],
      "payee",
      { ...names, payees },
    );
    expect(new Map(breakdownOf(swapped).spending.map((r) => [r.key, r.color]))).toEqual(colors);
  });

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
