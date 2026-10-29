import { describe, expect, it } from "vitest";
import {
  type CategoryHistory,
  type CategoryHistoryMonth,
  exportName,
  exportRows,
  inspectorRange,
  moveCounterpart,
  overspentBy,
  overspentKind,
} from "./category-history";

const month = (patch: Partial<CategoryHistoryMonth>): CategoryHistoryMonth => ({
  month: "2026-10",
  assigned: "0",
  activity: "0",
  available: "0",
  cashOverspent: "0",
  creditOverspent: "0",
  targetAmount: null,
  targetMet: null,
  moves: [],
  ...patch,
});

const move = (amount: string, other: string | null, deleted: string | null = null) => ({
  id: amount,
  categoryId: "food",
  otherCategoryId: other,
  otherDeletedCategory: deleted,
  amount,
  movedAt: "2026-10-01T00:00:00.000Z",
  userName: null,
});

describe("overspentKind", () => {
  it("is cash first, then credit, and none without overspending", () => {
    expect(overspentKind(month({ cashOverspent: "-1", creditOverspent: "-5" }))).toBe("cash");
    expect(overspentKind(month({ creditOverspent: "-5" }))).toBe("credit");
    expect(overspentKind(month({ available: "-0" }))).toBeNull();
  });

  it("flags a group month with an overspent category though its total is positive", () => {
    const m = month({ available: "5000", creditOverspent: "-2000", cashOverspent: "-500" });
    expect(overspentKind(m)).toBe("cash");
    expect(overspentBy(m)).toBe(-2500n);
  });
});

describe("moveCounterpart", () => {
  it("names the other category, or the deleted one", () => {
    const names = new Map([["fun", "Fun"]]);
    expect(moveCounterpart(move("500", "fun"), names)).toBe("Fun");
    expect(moveCounterpart(move("500", null, "Gym"), names)).toBe("deleted category Gym");
  });
});

describe("inspectorRange", () => {
  it("is the 12 months ending with the inspected one", () => {
    expect(inspectorRange("2026-03")).toEqual({ from: "2025-04", to: "2026-03" });
  });
});

describe("exportRows", () => {
  it("writes each month's plan numbers, target and net moves as plain amounts", () => {
    const history = {
      months: [
        month({ month: "2026-09", assigned: "5000", activity: "-20000", available: "-5000" }),
        month({
          month: "2026-10",
          assigned: "45000",
          activity: "-1250",
          available: "38750",
          targetAmount: "45000",
          targetMet: true,
          moves: [move("5000", "fun"), move("-1000", "fun")],
        }),
      ],
    } as CategoryHistory;
    expect(exportRows(history, "comma_dot", "USD")).toEqual([
      ["Month", "Assigned", "Activity", "Available", "Target", "Target Met", "Moved"],
      [
        "September 2026",
        { raw: "50.00" },
        { raw: "-200.00" },
        { raw: "-50.00" },
        { raw: "" },
        "",
        { raw: "0.00" },
      ],
      [
        "October 2026",
        { raw: "450.00" },
        { raw: "-12.50" },
        { raw: "387.50" },
        { raw: "450.00" },
        "Yes",
        { raw: "40.00" },
      ],
    ]);
  });

  it("names the file after the category, without its emoji", () => {
    expect(exportName("🛒 Groceries & Food", "2026-10-30", ",")).toBe(
      "strictbudget-category-history-groceries-food-2026-10-30.csv",
    );
    expect(exportName("🛒", "2026-10-30", "\t")).toBe(
      "strictbudget-category-history-category-2026-10-30.tsv",
    );
  });
});
