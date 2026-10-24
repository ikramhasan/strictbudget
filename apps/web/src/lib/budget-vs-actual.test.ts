import { toDelimited } from "@strictbudget/engine";
import { describe, expect, it } from "vitest";
import {
  type BudgetVsActualReport,
  budgetVsActual,
  exportRows,
  planStatus,
} from "./budget-vs-actual";
import type { CategoryList } from "./categories";

const list = {
  uncategorizedCategoryId: "unc",
  readyToAssignCategoryId: "rta",
  groups: [
    {
      id: "bills",
      name: "Bills",
      categories: [
        { id: "rent", name: "Rent" },
        { id: "phone", name: "Phone" },
      ],
    },
    { id: "needs", name: "Needs", categories: [{ id: "food", name: "Groceries" }] },
  ],
} as unknown as CategoryList;

const month = (
  m: string,
  assigned: string,
  activity: string,
  extra: Partial<BudgetVsActualReport["categories"][number]["months"][number]> = {},
) => ({
  month: m,
  assigned,
  activity,
  available: "0",
  cashOverspent: "0",
  creditOverspent: "0",
  targetAmount: null,
  ...extra,
});

const report: BudgetVsActualReport = {
  currency: "USD",
  firstMonth: "2026-08",
  months: ["2026-08", "2026-09", "2026-10"],
  categories: [
    {
      categoryId: "unc",
      groupId: "internal",
      uncategorized: true,
      hidden: false,
      months: [
        month("2026-08", "0", "0"),
        month("2026-09", "0", "0"),
        month("2026-10", "0", "-500"),
      ],
    },
    {
      categoryId: "rent",
      groupId: "bills",
      uncategorized: false,
      hidden: false,
      months: [
        month("2026-08", "100000", "-100000"),
        month("2026-09", "100000", "-100000"),
        month("2026-10", "100000", "-100000", { targetAmount: "100000" }),
      ],
    },
    {
      categoryId: "phone",
      groupId: "bills",
      uncategorized: false,
      hidden: true,
      months: [
        month("2026-08", "5000", "-7000", { cashOverspent: "-2000" }),
        month("2026-09", "5000", "-4000"),
        month("2026-10", "0", "0"),
      ],
    },
    {
      categoryId: "food",
      groupId: "needs",
      uncategorized: false,
      hidden: false,
      months: [
        month("2026-08", "40000", "-30000"),
        month("2026-09", "40000", "-45000", { creditOverspent: "-5000" }),
        month("2026-10", "40000", "-50000", { targetAmount: "40000" }),
      ],
    },
  ],
};

describe("planStatus", () => {
  it("is exact: equal is on plan", () => {
    expect(planStatus(100n, 99n)).toBe("under");
    expect(planStatus(100n, 100n)).toBe("on");
    expect(planStatus(100n, 101n)).toBe("over");
    // A refund-heavy month spends less than nothing.
    expect(planStatus(0n, -5n)).toBe("under");
  });
});

describe("budgetVsActual", () => {
  it("sums the range, groups with totals, most over plan first, Uncategorized first", () => {
    const result = budgetVsActual(report, list, { from: "2026-09", to: "2026-10" });
    expect(result.groups.map((g) => [g.name, g.assigned, g.spent, g.status])).toEqual([
      ["Uncategorized", 0n, 500n, "over"],
      ["Needs", 80000n, 95000n, "over"],
      ["Bills", 205000n, 204000n, "under"],
    ]);
    const bills = result.groups[2]?.rows ?? [];
    expect(bills.map((r) => [r.name, r.status, r.hidden])).toEqual([
      ["Rent", "on", false],
      ["Phone", "under", true],
    ]);
    expect(result.assigned).toBe(285000n);
    expect(result.spent).toBe(299500n);
  });

  it("sums target amounts over the range and counts months over plan", () => {
    const result = budgetVsActual(report, list, { from: "2026-08", to: "2026-10" });
    const food = result.groups.flatMap((g) => g.rows).find((r) => r.categoryId === "food");
    expect(food?.target).toBe(40000n);
    expect([food?.overMonths, food?.historyMonths]).toEqual([2, 3]);
    expect(food?.cells.map((c) => [c.variance, c.overspent])).toEqual([
      [-10000n, null],
      [5000n, "credit"],
      [10000n, null],
    ]);
    const phone = result.groups.flatMap((g) => g.rows).find((r) => r.categoryId === "phone");
    expect(phone?.target).toBeNull();
    expect(phone?.cells[0]?.overspent).toBe("cash");
  });

  it("doesn't count months before the plan began toward the over-plan count", () => {
    const young = { ...report, firstMonth: "2026-09" };
    const result = budgetVsActual(young, list, { from: "2026-08", to: "2026-10" });
    const food = result.groups.flatMap((g) => g.rows).find((r) => r.categoryId === "food");
    expect([food?.overMonths, food?.historyMonths]).toEqual([2, 2]);
  });

  it("leaves out categories with nothing in the range, and keeps the category filter", () => {
    const october = budgetVsActual(report, list, { from: "2026-10", to: "2026-10" });
    expect(october.groups.flatMap((g) => g.rows.map((r) => r.name))).toEqual([
      "Uncategorized",
      "Groceries",
      "Rent",
    ]);
    const filtered = budgetVsActual(report, list, { from: "2026-10", to: "2026-10" }, ["rent"]);
    expect(filtered.groups.map((g) => g.name)).toEqual(["Bills"]);
  });
});

describe("exportRows", () => {
  it("writes categories, group totals and the total with bare numbers", () => {
    const result = budgetVsActual(report, list, { from: "2026-10", to: "2026-10" });
    const text = toDelimited(exportRows(result, "comma_dot", 2), ",");
    expect(text.split("\n")).toEqual([
      '﻿"Category Group","Category","Assigned","Spent","Difference","% of Plan","Target","Months Over Plan (last 12)"',
      '"","Uncategorized",0.00,5.00,-5.00,,,"1 of 3"',
      '"Total Uncategorized","",0.00,5.00,-5.00,,,""',
      '"Needs","Groceries",400.00,500.00,-100.00,125.0,400.00,"2 of 3"',
      '"Total Needs","",400.00,500.00,-100.00,125.0,,""',
      '"Bills","Rent",1000.00,1000.00,0.00,100.0,1000.00,"0 of 3"',
      '"Total Bills","",1000.00,1000.00,0.00,100.0,,""',
      '"Total","",1400.00,1505.00,-105.00,107.5,,""',
    ]);
  });
});
