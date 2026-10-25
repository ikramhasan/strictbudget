import { averageOf, toDelimited, trendMonths } from "@strictbudget/engine";
import { describe, expect, it } from "vitest";
import type { CategoryList } from "./categories";
import type { ReportSum, ReportTransaction } from "./reports";
import {
  calendarLevels,
  calendarWeeks,
  catalogOf,
  cellsOf,
  chartedMonths,
  exportMoney,
  OTHER_KEY,
  seriesKeys,
  summaryExportRows,
  transactionExportRows,
  trendsSearchSchema,
  withOther,
} from "./spending-trends";

const category = (id: string, groupId: string, name: string) =>
  ({ id, groupId, name, hidden: false }) as CategoryList["groups"][number]["categories"][number];
const list = {
  readyToAssignCategoryId: "rta",
  uncategorizedCategoryId: "uncat",
  groups: [
    {
      id: "bills",
      name: "Bills",
      hidden: false,
      kind: null,
      categories: [category("rent", "bills", "Rent"), category("phone", "bills", "Phone")],
    },
    {
      id: "needs",
      name: "Needs",
      hidden: false,
      kind: null,
      categories: [category("food", "needs", "Groceries"), category("gas", "needs", "Gas")],
    },
  ],
} as CategoryList;
const catalog = catalogOf(list);

const row = (month: string, categoryId: string, net: string): ReportSum => ({
  month,
  categoryId,
  outflow: "0",
  inflow: "0",
  net,
  count: 1,
});
const rows = [
  row("2026-08", "food", "-300"),
  row("2026-09", "uncat", "-290000"),
  row("2026-09", "phone", "35300"),
  row("2026-09", "rent", "-500"),
  row("2026-10", "rent", "-100000"),
  row("2026-10", "food", "-20000"),
  row("2026-10", "gas", "-1000"),
];
const months = ["2026-07", "2026-08", "2026-09", "2026-10"];
const settings = {
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
} as const;

describe("spending trends search", () => {
  it("keeps the report filters and drops modes it can't read", () => {
    expect(trendsSearchSchema.parse({ mode: "pie", by: "group", group: "bills" })).toEqual({
      by: "group",
      group: "bills",
    });
  });
});

describe("trend series", () => {
  it("groups categories into their groups, Uncategorized on its own", () => {
    const byGroup = trendMonths(cellsOf(rows, catalog, "group"), months);
    expect(byGroup[2]?.nets).toEqual(
      new Map([
        ["uncat", -290000n],
        ["bills", 34800n],
      ]),
    );
    expect(seriesKeys(byGroup, catalog, "group")).toEqual(["uncat", "bills", "needs"]);
  });

  it("orders categories as the plan does", () => {
    const byCategory = trendMonths(cellsOf(rows, catalog, "category"), months);
    expect(seriesKeys(byCategory, catalog, "category")).toEqual([
      "uncat",
      "rent",
      "phone",
      "food",
      "gas",
    ]);
  });

  it("keeps the top spenders and sums the rest into Other", () => {
    const byCategory = trendMonths(cellsOf(rows, catalog, "category"), months);
    const { keys, months: folded } = withOther(byCategory, 2);
    expect(keys).toEqual(["uncat", "rent", OTHER_KEY]);
    // Phone's refund nets against Groceries in Other.
    expect(folded[2]?.nets.get(OTHER_KEY)).toBe(35300n);
    expect(folded[3]?.nets.get(OTHER_KEY)).toBe(-21000n);
    // Totals don't change.
    expect(folded.map((m) => m.total)).toEqual(byCategory.map((m) => m.total));
  });

  it("charts only months with transactions", () => {
    const byCategory = trendMonths(cellsOf(rows, catalog, "category"), months);
    expect(chartedMonths(byCategory).map((m) => m.month)).toEqual([
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
  });
});

describe("spending trends export", () => {
  it("writes a row per category with month columns, average and total", () => {
    const csv = toDelimited(
      summaryExportRows({
        rows,
        catalog,
        range: { from: "2026-08", to: "2026-10" },
        average: averageOf,
        currency: "USD",
        numberFormat: "comma_dot",
      }),
      ",",
    );
    expect(csv.slice(1).split("\n")).toEqual([
      '"Category Group","Category","Aug 2026","Sep 2026","Oct 2026","Average","Total"',
      '"","Uncategorized",0.00,-2900.00,0.00,-966.67,-2900.00',
      '"Bills","Rent",0.00,-5.00,-1000.00,-335.00,-1005.00',
      '"Bills","Phone",0.00,353.00,0.00,117.67,353.00',
      '"Needs","Groceries",-3.00,0.00,-200.00,-67.67,-203.00',
      '"Needs","Gas",0.00,0.00,-10.00,-3.33,-10.00',
    ]);
  });

  it("writes amounts with the symbol and no grouping", () => {
    expect(exportMoney(-123456n, "USD", settings)).toBe("$1234.56");
    expect(
      exportMoney(123456789n, "EUR", {
        ...settings,
        numberFormat: "dot_comma",
        currencySymbolPosition: "after",
      }),
    ).toBe("1234567,89\u00a0€");
  });

  it("writes the transactions export", () => {
    const line = (over: Partial<ReportTransaction>): ReportTransaction => ({
      id: "t",
      transactionId: "t",
      accountId: "a",
      accountName: "Checking",
      date: "2026-10-02",
      payeeId: null,
      payeeName: "Market",
      categoryId: "food",
      groupName: "Needs",
      categoryName: "Groceries",
      memo: 'big "one", ok',
      flag: "red",
      cleared: "cleared",
      amount: "-123456",
      nativeAmount: "-123456",
      currency: "USD",
      ...over,
    });
    const csv = toDelimited(
      transactionExportRows({
        transactions: [
          line({}),
          line({
            categoryId: "uncat",
            groupName: "Internal",
            categoryName: "Uncategorized",
            payeeName: "Transfer : House",
            memo: "",
            flag: null,
            cleared: "uncleared",
            amount: "250",
          }),
        ],
        uncategorizedId: "uncat",
        currency: "USD",
        settings,
        formatDate: (iso) => `${iso.slice(5, 7)}/${iso.slice(8)}/${iso.slice(0, 4)}`,
      }),
      ",",
    );
    expect(csv.slice(1).split("\n")).toEqual([
      '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"',
      '"Checking","Red","10/02/2026","Market","Needs: Groceries","Needs","Groceries","big ""one"", ok",$1234.56,$0.00,"Cleared"',
      '"Checking","","10/02/2026","Transfer : House","","","","",$0.00,$2.50,"Uncleared"',
    ]);
  });
});

describe("calendar heatmap", () => {
  it("lays the range's days out in weeks, Sunday first", () => {
    const days = new Map([["2026-02-03", { total: 500n, count: 2 }]]);
    const { weeks, months: starts } = calendarWeeks(
      { from: "2026-02", to: "2026-03" },
      days,
      "2026-03-10",
    );
    // Feb 1 2026 is a Sunday; Mar 31 a Tuesday.
    expect(weeks[0]?.[0]?.date).toBe("2026-02-01");
    expect(weeks[0]?.[2]).toEqual({ date: "2026-02-03", total: 500n, count: 2, future: false });
    expect(weeks).toHaveLength(9);
    expect(weeks.at(-1)?.map((d) => d?.date ?? null)).toEqual([
      "2026-03-29",
      "2026-03-30",
      "2026-03-31",
      null,
      null,
      null,
      null,
    ]);
    expect(weeks.at(-1)?.[0]?.future).toBe(true);
    expect(starts).toEqual([
      { month: "2026-02", week: 0 },
      { month: "2026-03", week: 4 },
    ]);
  });

  it("leaves the first week's days before the range empty", () => {
    const { weeks } = calendarWeeks({ from: "2026-10", to: "2026-10" }, new Map(), "2026-10-17");
    // Oct 1 2026 is a Thursday.
    expect(weeks[0]?.slice(0, 4).map((d) => d?.date ?? null)).toEqual([null, null, null, null]);
    expect(weeks[0]?.[4]?.date).toBe("2026-10-01");
  });

  it("shades spending days by quartile", () => {
    const day = (total: bigint) => ({ date: "", total, count: 1, future: false });
    const days = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n].map(day);
    const level = calendarLevels(days);
    expect(days.map(level)).toEqual([1, 1, 1, 2, 2, 3, 3, 4]);
    expect(level(day(0n))).toBe(0);
    expect(level(day(-5n))).toBe(0);
  });
});
