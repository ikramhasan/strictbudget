import { describe, expect, it } from "vitest";
import {
  addMonths,
  autoAssignAmounts,
  budgetMonthRange,
  categoryMonth,
  categoryOverspending,
  isOverdraft,
  monthBounds,
  monthEndBalances,
  monthOf,
  readyToAssign,
  readyToAssignBreakdown,
  splitOverspending,
} from "./months";

describe("month helpers", () => {
  it("moves across years", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-10", -22)).toBe("2024-12");
    expect(addMonths("2026-10", 0)).toBe("2026-10");
  });

  it("knows month bounds, leap years included", () => {
    expect(monthBounds("2024-02")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(monthBounds("2026-02").end).toBe("2026-02-28");
    expect(monthBounds("2026-12").end).toBe("2026-12-31");
    expect(monthOf("2026-10-02")).toBe("2026-10");
  });
});

describe("budgetMonthRange", () => {
  it("runs from the month before the oldest transaction to the month after the current one", () => {
    expect(
      budgetMonthRange({
        current: "2026-10",
        earliestTransaction: "2026-08",
        latestAssigned: null,
      }),
    ).toEqual({ first: "2026-07", last: "2026-11" });
  });

  it("opens the month after the latest month with money assigned", () => {
    expect(
      budgetMonthRange({
        current: "2026-10",
        earliestTransaction: "2026-10",
        latestAssigned: "2026-11",
      }),
    ).toEqual({ first: "2026-09", last: "2026-12" });
  });

  it("starts the month before the current one without transactions", () => {
    expect(
      budgetMonthRange({ current: "2026-10", earliestTransaction: null, latestAssigned: null }),
    ).toEqual({ first: "2026-09", last: "2026-11" });
  });
});

describe("categoryMonth", () => {
  const m = (month: string, assigned: bigint, activity: bigint) => ({ month, assigned, activity });

  it("is all zero without history", () => {
    expect(categoryMonth([], "2026-10")).toEqual({
      carried: 0n,
      assigned: 0n,
      activity: 0n,
      cashActivity: 0n,
      creditActivity: 0n,
      fundedSpending: 0n,
      payments: 0n,
      cashOverspent: 0n,
      creditOverspent: 0n,
      available: 0n,
    });
  });

  it("rolls what's left into the following months", () => {
    const history = [m("2026-08", 10000n, -2500n), m("2026-10", 500n, -1000n)];
    expect(categoryMonth(history, "2026-09")).toEqual({
      carried: 7500n,
      assigned: 0n,
      activity: 0n,
      cashActivity: 0n,
      creditActivity: 0n,
      fundedSpending: 0n,
      payments: 0n,
      cashOverspent: 0n,
      creditOverspent: 0n,
      available: 7500n,
    });
    expect(categoryMonth(history, "2026-10")).toEqual({
      carried: 7500n,
      assigned: 500n,
      activity: -1000n,
      cashActivity: -1000n,
      creditActivity: 0n,
      fundedSpending: 0n,
      payments: 0n,
      cashOverspent: 0n,
      creditOverspent: 0n,
      available: 7000n,
    });
    expect(categoryMonth(history, "2026-12").available).toBe(7000n);
  });

  it("starts the month after overspending at zero", () => {
    const history = [m("2026-10", 0n, -2500n)];
    expect(categoryMonth(history, "2026-10").available).toBe(-2500n);
    expect(categoryMonth(history, "2026-11")).toEqual({
      carried: 0n,
      assigned: 0n,
      activity: 0n,
      cashActivity: 0n,
      creditActivity: 0n,
      fundedSpending: 0n,
      payments: 0n,
      cashOverspent: 0n,
      creditOverspent: 0n,
      available: 0n,
    });
    const later = [...history, m("2026-12", 1000n, -200n)];
    expect(categoryMonth(later, "2026-12")).toEqual({
      carried: 0n,
      assigned: 1000n,
      activity: -200n,
      cashActivity: -200n,
      creditActivity: 0n,
      fundedSpending: 0n,
      payments: 0n,
      cashOverspent: 0n,
      creditOverspent: 0n,
      available: 800n,
    });
  });

  it("adds up several entries for the same month, in any order", () => {
    const history = [m("2026-10", 0n, -300n), m("2026-09", 1000n, 0n), m("2026-10", 200n, -100n)];
    expect(categoryMonth(history, "2026-10")).toEqual({
      carried: 1000n,
      assigned: 200n,
      activity: -400n,
      cashActivity: -400n,
      creditActivity: 0n,
      fundedSpending: 0n,
      payments: 0n,
      cashOverspent: 0n,
      creditOverspent: 0n,
      available: 800n,
    });
  });

  it("ignores later months", () => {
    expect(categoryMonth([m("2026-11", 5000n, 0n)], "2026-10").available).toBe(0n);
  });

  describe("cash and credit activity", () => {
    const e = (month: string, activity: bigint, creditActivity: bigint) => ({
      month,
      assigned: 0n,
      activity,
      creditActivity,
    });

    it.each([
      ["cash only", [e("2026-10", -400n, 0n)], -400n, -400n, 0n],
      ["card only", [e("2026-10", -500n, -500n)], -500n, 0n, -500n],
      // Cash −$4 and +$10, one card −$5, +$2 and a −$7 split line, another −$3: Cash Spending
      // $6.00, Credit Spending −$13.00.
      [
        "mixed accounts, returns, splits and two cards",
        [
          e("2026-10", -400n, 0n),
          e("2026-10", 1000n, 0n),
          e("2026-10", -1000n, -1000n),
          e("2026-10", -300n, -300n),
        ],
        -700n,
        600n,
        -1300n,
      ],
      // A split line returned on a card is positive Credit Spending.
      ["a card return", [e("2026-10", -500n, 0n), e("2026-10", 100n, 100n)], -400n, -500n, 100n],
    ])("%s", (_, entries, activity, cash, credit) => {
      expect(categoryMonth(entries, "2026-10")).toMatchObject({
        activity,
        cashActivity: cash,
        creditActivity: credit,
      });
    });

    it("counts only the month's own activity", () => {
      const entries = [e("2026-09", -200n, -200n), { ...e("2026-10", 0n, 0n), assigned: 1000n }];
      expect(categoryMonth(entries, "2026-10")).toMatchObject({
        activity: 0n,
        cashActivity: 0n,
        creditActivity: 0n,
      });
      expect(categoryMonth(entries, "2026-11")).toMatchObject({
        cashActivity: 0n,
        creditActivity: 0n,
      });
    });
  });
});

describe("readyToAssignBreakdown", () => {
  const a = (month: string, amount: bigint) => ({ month, amount });

  // $1 in August, $3 assigned in September, $15 in and $12 assigned in October, $3 assigned in
  // November.
  const plan = {
    income: [a("2026-08", 100n), a("2026-10", 1500n)],
    debt: [],
    assigned: [a("2026-09", 300n), a("2026-10", 1200n), a("2026-11", 300n)],
    overspent: [],
  };

  it("lists October's lines, Assigned in Future only down to zero", () => {
    expect(readyToAssignBreakdown({ ...plan, month: "2026-10" })).toEqual({
      leftOver: -200n,
      inflows: 1500n,
      debtInflows: 0n,
      cashOverspending: 0n,
      assigned: -1200n,
      assignedInFuture: -100n,
      total: 0n,
    });
  });

  it("starts November from October's total before November's assigning", () => {
    expect(readyToAssignBreakdown({ ...plan, month: "2026-11" })).toMatchObject({
      leftOver: 100n,
      assigned: -300n,
      assignedInFuture: 0n,
      total: -200n,
    });
  });

  it("splits card inflows out and takes last month's cash overspending", () => {
    const b = readyToAssignBreakdown({
      month: "2026-10",
      income: [a("2026-09", -50806n), a("2026-10", 1208500n + 8900n)],
      debt: [a("2026-10", 8900n)],
      assigned: [a("2026-10", 257037n)],
      overspent: [a("2026-09", -270000n)],
    });
    expect(b).toEqual({
      leftOver: -50806n,
      inflows: 1208500n,
      debtInflows: 8900n,
      cashOverspending: -270000n,
      assigned: -257037n,
      assignedInFuture: 0n,
      total: 639557n,
    });
  });
});

describe("readyToAssign", () => {
  const a = (month: string, amount: bigint) => ({ month, amount });

  // $12,100 of income in October, $3 overspent in August, $32 in October.
  const income = [a("2026-10", 1210000n)];
  const overspent = [a("2026-08", -300n), a("2026-10", -3200n)];

  it("subtracts assigned money and earlier months' overspending", () => {
    const assigned = [a("2026-10", 5000n)];
    expect(readyToAssign({ month: "2026-10", income, assigned, overspent })).toEqual({
      readyToAssign: 1204700n,
      assignedInFuture: 0n,
    });
    // November also loses October's overspending.
    expect(readyToAssign({ month: "2026-11", income, assigned, overspent }).readyToAssign).toBe(
      1201500n,
    );
  });

  it("takes money assigned in later months from what's left", () => {
    const assigned = [a("2026-10", 5000n), a("2026-11", 2000n)];
    expect(readyToAssign({ month: "2026-10", income, assigned, overspent })).toEqual({
      readyToAssign: 1202700n,
      assignedInFuture: 2000n,
    });
    expect(readyToAssign({ month: "2026-11", income, assigned, overspent }).readyToAssign).toBe(
      1199500n,
    );
  });

  it("never lets later months push a month below zero", () => {
    const assigned = [a("2026-10", 5000n), a("2026-11", 1300000n)];
    expect(readyToAssign({ month: "2026-10", income, assigned, overspent }).readyToAssign).toBe(0n);
    expect(readyToAssign({ month: "2026-11", income, assigned, overspent }).readyToAssign).toBe(
      -98500n,
    );
    // September has no income: only August's overspending counts.
    expect(readyToAssign({ month: "2026-09", income, assigned, overspent })).toEqual({
      readyToAssign: -300n,
      assignedInFuture: 1305000n,
    });
  });
});

describe("overspending: cash or credit", () => {
  const e = (assigned: bigint, activity: bigint, creditActivity: bigint) => ({
    month: "2026-10",
    assigned,
    activity,
    creditActivity,
  });

  it.each([
    ["cash only (Utilities −$25)", e(0n, -2500n, 0n), -2500n, 0n],
    ["card only (Rent $10: $6 cash, $8 card)", e(1000n, -1400n, -800n), 0n, -400n],
    ["unfunded card spending (R1 −$6)", e(0n, -600n, -600n), 0n, -600n],
    ["mixed, nothing assigned (R2)", e(0n, -500n, -200n), -300n, -200n],
    ["mixed, $2 assigned (R2)", e(200n, -500n, -200n), -100n, -200n],
    ["mixed, $4 assigned (R2)", e(400n, -500n, -200n), 0n, -100n],
    ["not overspent", e(1000n, -500n, -500n), 0n, 0n],
    // A card return in an overspent cash category: −$5 cash, +$1 card.
    ["a card return can't make cash overspending credit", e(0n, -400n, 100n), -400n, 0n],
  ])("%s", (_, entry, cash, credit) => {
    expect(categoryMonth([entry], "2026-10")).toMatchObject({
      cashOverspent: cash,
      creditOverspent: credit,
    });
  });

  it("splits a negative Available into its cash and credit parts", () => {
    expect(splitOverspending(-500n, -300n)).toEqual({
      cashOverspent: -300n,
      creditOverspent: -200n,
    });
    expect(splitOverspending(-500n, -900n)).toEqual({ cashOverspent: -500n, creditOverspent: 0n });
    expect(splitOverspending(-500n, 200n)).toEqual({ cashOverspent: 0n, creditOverspent: -500n });
    expect(splitOverspending(100n, -300n)).toEqual({ cashOverspent: 0n, creditOverspent: 0n });
  });

  it("makes a payment category a return took below zero cash overspending", () => {
    const returned = { month: "2026-10", assigned: 0n, activity: -400n, fundedSpending: -400n };
    expect(categoryMonth([returned], "2026-10")).toMatchObject({
      available: -400n,
      cashOverspent: -400n,
      creditOverspent: 0n,
    });
  });
});

describe("categoryOverspending", () => {
  it("leaves credit overspending out (it's new card debt)", () => {
    expect(
      categoryOverspending([
        { month: "2026-09", assigned: 0n, activity: -500n, creditActivity: -500n },
        { month: "2026-10", assigned: 0n, activity: -500n, creditActivity: -200n },
      ]),
    ).toEqual([{ month: "2026-10", amount: -300n }]);
  });

  it("lists the months a category ended below zero", () => {
    const history = [
      { month: "2026-08", assigned: 0n, activity: -300n },
      { month: "2026-09", assigned: 1000n, activity: -200n },
      { month: "2026-10", assigned: 0n, activity: -1000n },
    ];
    expect(categoryOverspending(history)).toEqual([
      { month: "2026-08", amount: -300n },
      { month: "2026-10", amount: -200n },
    ]);
  });
});

describe("autoAssignAmounts", () => {
  const m = (month: string, assigned: bigint, activity: bigint) => ({ month, assigned, activity });

  it("uses last month's assigned and spending", () => {
    const history = [m("2026-09", 3000n, -1200n), m("2026-10", 1000n, 0n)];
    expect(autoAssignAmounts(history, "2026-10")).toMatchObject({
      assignedLastMonth: 3000n,
      spentLastMonth: 1200n,
      resetAssigned: 0n,
    });
    expect(autoAssignAmounts([m("2026-09", 0n, 500n)], "2026-10").spentLastMonth).toBe(0n);
  });

  it("averages from the first month with money assigned or spent", () => {
    // $30.00 assigned in September after $3.00 spent in August averages $15.00 / $1.50.
    const history = [m("2026-08", 0n, -300n), m("2026-09", 3000n, 0n), m("2026-10", 1000n, 0n)];
    expect(autoAssignAmounts(history, "2026-10")).toMatchObject({
      averageAssigned: 1500n,
      averageSpent: 150n,
    });
    expect(autoAssignAmounts([], "2026-10")).toMatchObject({
      averageAssigned: 0n,
      averageSpent: 0n,
    });
  });

  // Money assigned in August only.
  it("rounds averages half away from zero", () => {
    const avg = (amount: bigint, month: string) =>
      autoAssignAmounts([m("2026-08", amount, 0n)], month).averageAssigned;
    expect([
      avg(5n, "2026-10"),
      avg(7n, "2026-10"),
      avg(1n, "2026-10"),
      avg(-5n, "2026-10"),
    ]).toEqual([3n, 4n, 1n, -3n]);
    expect([avg(5n, "2026-11"), avg(7n, "2026-11"), avg(1n, "2026-11")]).toEqual([2n, 2n, 0n]);
    expect(autoAssignAmounts([m("2026-08", 0n, -5n)], "2026-10").averageSpent).toBe(3n);
  });

  it("looks back at most 12 months", () => {
    const history = [m("2025-01", 99900n, 0n), m("2025-10", 100n, 0n), m("2025-11", 0n, -1n)];
    // October 2025 to September 2026: 12 months, 100 / 12 rounds to 8.
    expect(autoAssignAmounts(history, "2026-10")).toMatchObject({
      averageAssigned: 8n,
      averageSpent: 0n,
    });
  });

  it("resets Available to zero, covering overspending too", () => {
    const history = [m("2026-09", 2000n, 0n), m("2026-10", 500n, -100n)];
    // Available is 2,400 with 500 assigned this month: Assigned goes to -1,900.
    expect(autoAssignAmounts(history, "2026-10").resetAvailable).toBe(-1900n);
    expect(autoAssignAmounts([m("2026-10", 500n, -900n)], "2026-10").resetAvailable).toBe(900n);
  });
});

describe("isOverdraft", () => {
  const cat = (available: bigint, creditOverspent = 0n) => ({ available, creditOverspent });

  // $1,000 of income, $800 assigned in October, a September overspend of $999 (Ready to Assign
  // −$799.00).
  it("is money assigned beyond what there is while categories could cover it", () => {
    expect(isOverdraft(-799_00n, [cat(800_00n)])).toBe(false);
  });

  it("is an overdraft once even their cash wouldn't (exactly zero isn't)", () => {
    expect(isOverdraft(-800_00n, [cat(800_00n)])).toBe(false);
    expect(isOverdraft(-800_01n, [cat(800_00n)])).toBe(true);
  });

  it("counts cash overspending against it, but not credit overspending", () => {
    expect(isOverdraft(-799_00n, [cat(800_00n), cat(-5_00n)])).toBe(true);
    expect(isOverdraft(-799_00n, [cat(800_00n), cat(-5_00n, -5_00n)])).toBe(false);
    expect(isOverdraft(-799_00n, [cat(800_00n), cat(-5_00n, -3_00n)])).toBe(true);
  });

  it("never applies to a Ready to Assign that isn't negative", () => {
    expect(isOverdraft(0n, [cat(-5_00n)])).toBe(false);
    expect(isOverdraft(1n, [])).toBe(false);
  });
});

describe("monthEndBalances", () => {
  it("lists each month's ending balance, newest first", () => {
    expect(
      monthEndBalances([
        { date: "2026-08-01", amount: -500000n },
        { date: "2026-09-15", amount: 20000n },
        { date: "2026-10-02", amount: -3000n },
        { date: "2026-10-14", amount: 483000n },
      ]),
    ).toEqual([
      { month: "2026-10", endBalance: 0n },
      { month: "2026-09", endBalance: -480000n },
      { month: "2026-08", endBalance: -500000n },
    ]);
  });

  it("carries a balance through months without transactions, across a year", () => {
    expect(
      monthEndBalances([
        { date: "2027-01-03", amount: 5n },
        { date: "2026-11-30", amount: -10n },
      ]),
    ).toEqual([
      { month: "2027-01", endBalance: -5n },
      { month: "2026-12", endBalance: -10n },
      { month: "2026-11", endBalance: -10n },
    ]);
  });

  it("is empty without transactions", () => {
    expect(monthEndBalances([])).toEqual([]);
  });
});
