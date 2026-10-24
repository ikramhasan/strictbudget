import { describe, expect, it } from "vitest";
import {
  chartMonths,
  formatDuration,
  loanPlan,
  paidOffPercent,
  remainingPercent,
  trackAt,
} from "./loan-planner";
import type { LoanActivity } from "./loans";

describe("formatDuration", () => {
  it.each([
    [0, "0 months"],
    [1, "1 month"],
    [10, "10 months"],
    [12, "1 year"],
    [24, "2 years"],
    [13, "1 yr, 1 mo"],
    [21, "1 yr, 9 mos"],
    [58, "4 yrs, 10 mos"],
    [1650, "137 yrs, 6 mos"],
  ])("%s → %s", (months, text) => expect(formatDuration(months)).toBe(text));
});

describe("percentages", () => {
  it("rounds the share remaining to one decimal and the share paid to a whole percent", () => {
    expect(remainingPercent(974_500n, 1_000_000n)).toBe("97.5"); // 97.45
    expect(remainingPercent(1_000_000n, 1_000_000n)).toBe("100.0");
    expect(remainingPercent(0n, 1_000_000n)).toBe("0.0");
    expect(paidOffPercent(974_500n, 1_000_000n)).toBe("3"); // 2.55
    expect(paidOffPercent(980_000n, 1_000_000n)).toBe("2");
  });
});

const month = (
  m: string,
  start: string,
  end: string,
  payments = "0",
  interest = "0",
  opening?: string,
): LoanActivity["months"][number] => ({
  month: m,
  startBalance: start,
  endBalance: end,
  payments,
  interest: { total: interest, applied: interest, status: "estimated", editedAt: null },
  escrow: { total: "0", applied: "0", status: "estimated", editedAt: null },
  transactions: opening
    ? [
        {
          id: "s",
          date: `${m}-01`,
          amount: opening,
          memo: "",
          kind: "starting_balance",
          payeeKind: "starting_balance",
          fromAccountId: null,
          otherSideId: null,
        },
      ]
    : [],
});

// $10,000.00 at 6%, $200.00 minimum, $250.00 paid in October.
const g7: LoanActivity = {
  months: [month("2026-10", "0", "-980000", "25000", "5000", "-1000000")],
  upcoming: [],
  terms: [{ month: "2026-10", interestRate: "6.000", minimumPayment: "20000", escrowAmount: null }],
  banners: { simulatorDismissed: false, paidOffDismissed: false },
  originalHistory: null,
};

describe("loanPlan", () => {
  it("projects the minimum without a target", () => {
    const plan = loanPlan({
      activity: g7,
      currency: "USD",
      current: "2026-10",
      targetAmount: null,
    });
    expect(plan.progress).toMatchObject({
      owed: 980_000n,
      started: 1_000_000n,
      paidThisMonth: true,
    });
    expect(plan.byMinimum).toEqual({ months: 57, interest: 146_958n });
    expect(plan.payoffMonth).toBe("2031-07");
    expect(plan.tracks.original).toBeNull();
    expect(plan.tracks.minimum).toBeNull();
    expect(plan.tracks.past).toEqual({ from: "2026-10", balances: [1_000_000n, 980_000n] });
    expect(plan.tracks.current?.from).toBe("2026-11");
    expect(plan.tracks.current?.balances.slice(0, 2)).toEqual([980_000n, 964_900n]);
  });

  it("projects the target and adds the original and minimum lines with one", () => {
    const plan = loanPlan({
      activity: g7,
      currency: "USD",
      current: "2026-10",
      targetAmount: 30_000n,
    });
    // "Your monthly target of $300.00 saves you $543.08 … 1 yr, 9 mos sooner."
    expect(plan.byTarget).toEqual({ months: 36, interest: 92_650n });
    expect(plan.payoffMonth).toBe("2029-10");
    expect(plan.tracks.original?.from).toBe("2026-10");
    expect(plan.tracks.minimum?.balances[1]).toBe(964_900n);
    expect(plan.tracks.current?.balances[1]).toBe(954_900n);
    const months = chartMonths([plan.tracks.past, plan.tracks.current, plan.tracks.minimum]);
    expect(months[0]).toBe("2026-10");
    expect(months.at(-1)).toBe("2031-08");
    expect(trackAt(plan.tracks.current, "2026-10")).toBeUndefined();
    expect(trackAt(plan.tracks.current, "2026-11")).toBe(980_000n);
  });

  it("has no payoff date when paid off or when the payment can't beat the interest", () => {
    const paid: LoanActivity = {
      months: [month("2026-10", "0", "0", "1000000", "0", "-1000000")],
      upcoming: [],
      terms: g7.terms,
      banners: g7.banners,
      originalHistory: null,
    };
    expect(
      loanPlan({ activity: paid, currency: "USD", current: "2026-10", targetAmount: null }),
    ).toMatchObject({ payoffMonth: null, progress: { paidOff: true } });
    const low = loanPlan({
      activity: g7,
      currency: "USD",
      current: "2026-10",
      targetAmount: 4_000n,
    });
    expect(low.byTarget).toBeNull();
    expect(low.payoffMonth).toBeNull();
    expect(low.tracks.current).toBeNull();
  });
});
