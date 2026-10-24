import { describe, expect, it } from "vitest";
import {
  effectivePayment,
  type LoanHistoryMonth,
  loanProgress,
  minimumToPayDown,
  paidOffSavings,
  paymentForMonths,
  payoffProjection,
  payoffSchedule,
  plannedPayoff,
} from "./loan-planner";

const project = (owed: bigint, rate: string | null, payment: bigint) =>
  payoffProjection({ owed, rate, payment, exponent: 2 });

describe("payoffProjection", () => {
  it.each([
    // $10,000.00 at 6%: the minimum, the simulator's payments, and a payment a cent above interest
    [1_000_000n, 20_000n, 58, 153_603n], // Aug 2031, "4 yrs, 10 mos", $1,536.03
    [1_000_000n, 30_000n, 37, 96_662n], // Nov 2029, $966.62
    [1_000_000n, 25_000n, 45, 118_505n], // Jul 2030, $1,185.05
    [1_000_000n, 100_000n, 11, 28_428n], // Sep 2027, $284.28 (284.284 rounds down)
    [1_000_000n, 17_500n, 68, 180_595n], // Jun 2032, $1,805.95
    [1_000_000n, 5_001n, 1708, 7_540_377n], // Feb 2169, $75,403.77
    [985_000n, 20_000n, 57, 148_603n], // after October's $200.00: Jul 2031, $1,486.03
    [980_000n, 20_000n, 57, 146_958n],
    [980_000n, 30_000n, 36, 92_650n], // the $300.00 target saves $543.08, 21 months
    [974_500n, 15_000n, 79, 206_831n], // the $150.00 target: 23 months and $616.69 more
    [974_500n, 20_000n, 56, 145_162n],
  ])("%s paying %s → %s months, %s interest", (owed, payment, months, interest) =>
    expect(project(owed, "6", payment)).toEqual({ months, interest }),
  );

  it("takes owed ÷ payment months at 0%", () => {
    expect(project(969_500n, "0", 30_000n)).toEqual({ months: 33, interest: 0n }); // Jul 2029
    expect(project(969_500n, "0", 20_000n)).toEqual({ months: 49, interest: 0n });
    expect(project(969_500n, "0", 15_000n)).toEqual({ months: 65, interest: 0n }); // Mar 2032
  });

  it("never pays off at or below the month's interest", () => {
    expect(project(1_000_000n, "6", 5_000n)).toBeNull(); // "$50.00 is less than your estimated…"
    expect(project(974_500n, "6", 4_873n)).toBeNull(); // interest $48.73
    expect(project(974_500n, "6", 4_874n)).not.toBeNull(); // "at least $48.74"
    expect(minimumToPayDown(1_000_000n, "6", 2)).toBe(5_001n); // "increase your debt by $50.01"
    expect(minimumToPayDown(974_500n, "6", 2)).toBe(4_874n);
  });

  it("needs a rate, and has nothing left when nothing is owed", () => {
    expect(project(1_000_000n, null, 20_000n)).toBeNull();
    expect(project(0n, "6", 20_000n)).toEqual({ months: 0, interest: 0n });
  });

  it("projects a mortgage's payment without escrow (16 yrs, 6 mos)", () => {
    expect(effectivePayment(90_000n, 15_000n)).toBe(75_000n);
    expect(effectivePayment(90_000n, null)).toBe(90_000n);
    expect(effectivePayment(null, 15_000n)).toBeNull();
    expect(project(10_000_000n, "5.125", 75_000n)?.months).toBe(198);
  });
});

describe("paymentForMonths", () => {
  it("rounds the annuity payment up (Dec 2027 → $741.37)", () => {
    expect(paymentForMonths({ owed: 1_000_000n, rate: "6", months: 14 })).toBe(74_137n);
    // Exactly $10,050.00 for one payment, not $10,050.01 from float noise.
    expect(paymentForMonths({ owed: 1_000_000n, rate: "6", months: 1 })).toBe(1_005_000n);
  });

  it("divides evenly at 0% and refuses this month", () => {
    expect(paymentForMonths({ owed: 1_000_000n, rate: "0", months: 3 })).toBe(333_334n);
    expect(paymentForMonths({ owed: 1_000_000n, rate: "6", months: 0 })).toBeNull();
    expect(paymentForMonths({ owed: 1_000_000n, rate: null, months: 3 })).toBeNull();
  });

  it("gives a payment that pays off in that many months", () => {
    for (const months of [1, 2, 14, 58, 360]) {
      const payment = paymentForMonths({ owed: 1_000_000n, rate: "6", months }) ?? 0n;
      expect(project(1_000_000n, "6", payment)?.months).toBe(months);
    }
  });
});

describe("payoffSchedule", () => {
  // The Current Track for $10,000.00 at 6% paying $200.00, from December 1 (in cents).
  const expected = [
    985000, 969925, 954775, 939549, 924247, 908868, 893412, 877879, 862268, 846579, 830812, 814966,
    799041, 783036, 766951, 750786, 734540, 718213, 701804, 685313, 668740, 652084, 635344, 618521,
    601614, 584622, 567545, 550383, 533135, 515801, 498380, 480872, 463276, 445592, 427820, 409959,
    392009, 373969, 355839, 337618, 319306, 300903, 282408, 263820, 245139, 226365, 207497, 188535,
    169478, 150325, 131077, 111732, 92291, 72753, 53117, 33383, 13550, 0,
  ].map(BigInt);

  it("matches the expected chart to the cent (interest rounded twice)", () => {
    expect(payoffSchedule({ owed: 1_000_000n, rate: "6", payment: 20_000n, exponent: 2 })).toEqual(
      expected,
    );
  });

  it("is empty when nothing is owed and null when it never pays off", () => {
    expect(payoffSchedule({ owed: 0n, rate: "6", payment: 20_000n, exponent: 2 })).toEqual([]);
    expect(
      payoffSchedule({ owed: 1_000_000n, rate: "6", payment: 5_000n, exponent: 2 }),
    ).toBeNull();
  });
});

describe("plannedPayoff", () => {
  const base = { rate: "6", payment: 20_000n, exponent: 2, month: "2026-10" };

  it("starts payments next month", () => {
    expect(plannedPayoff({ ...base, owed: 1_000_000n })).toEqual({
      months: 58,
      interest: 153_603n,
      payoffMonth: "2031-08",
      owedAfterThisMonth: 1_000_000n,
    });
  });

  it("pays this month's payment and interest with an extra before any payment", () => {
    // $1,000.00 extra in October → Jan 2031, interest $1,227.59.
    expect(plannedPayoff({ ...base, owed: 1_000_000n, extra: 100_000n })).toEqual({
      months: 51,
      interest: 122_759n,
      payoffMonth: "2031-01",
      owedAfterThisMonth: 885_000n,
    });
  });

  it("only takes the extra off after a payment this month", () => {
    // $9,850.00 after October's $200.00, $1,000.00 extra → Jan 2031, $1,177.59.
    expect(
      plannedPayoff({ ...base, owed: 985_000n, extra: 100_000n, paidThisMonth: true }),
    ).toEqual({
      months: 51,
      interest: 117_759n,
      payoffMonth: "2031-01",
      owedAfterThisMonth: 885_000n,
    });
  });

  it("is paid off this month by an extra that covers it", () => {
    expect(plannedPayoff({ ...base, owed: 50_000n, extra: 60_000n, paidThisMonth: true })).toEqual({
      months: 0,
      interest: 0n,
      payoffMonth: "2026-10",
      owedAfterThisMonth: 0n,
    });
  });
});

describe("loanProgress and paidOffSavings", () => {
  // $100.00 at 12% from July 1 with a $20.00 minimum; $101.00 paid in `paidIn`.
  const history = (paidIn: string): LoanHistoryMonth[] =>
    ["2026-07", "2026-08", "2026-09", "2026-10"].map((month, index) => {
      const before = month <= paidIn ? -10_000n : 0n;
      const paid = month === paidIn;
      return {
        month,
        startBalance: index === 0 ? 0n : month <= paidIn ? -10_000n : 0n,
        opening: index === 0 ? -10_000n : 0n,
        payments: paid ? 10_100n : 0n,
        interest: paid ? 100n : 0n,
        endBalance: paid || month > paidIn ? 0n : before,
      };
    });
  const termsFor = () => ({ interestRate: "12", minimumPayment: 2_000n, escrowAmount: null });

  it("paid in August: 3 months, saved $2.10, 4 months earlier", () => {
    const progress = loanProgress({
      history: history("2026-08"),
      termsFor,
      month: "2026-10",
      exponent: 2,
    });
    expect(progress).toMatchObject({
      owed: 0n,
      started: 10_000n,
      paidOff: true,
      monthsSinceStart: 3,
    });
    expect(progress.original).toMatchObject({ from: "2026-07", month: "2026-08" });
    // Drawn from July, flat until August's payment.
    expect(progress.original?.balances).toEqual([
      10_000n,
      10_000n,
      8_100n,
      6_181n,
      4_243n,
      2_285n,
      308n,
      0n,
    ]);
    expect(paidOffSavings(progress, "2026-10")).toEqual({ interest: 210n, months: 4 });
  });

  it("paid in September: 5 months earlier", () => {
    const progress = loanProgress({
      history: history("2026-09"),
      termsFor,
      month: "2026-10",
      exponent: 2,
    });
    expect(progress.monthsSinceStart).toBe(3);
    expect(paidOffSavings(progress, "2026-10")).toEqual({ interest: 210n, months: 5 });
  });

  it("has no original schedule before any payment, and no savings while owed", () => {
    const progress = loanProgress({
      history: [
        {
          month: "2026-10",
          startBalance: 0n,
          opening: -1_000_000n,
          payments: 0n,
          interest: 0n,
          endBalance: -1_000_000n,
        },
      ],
      termsFor,
      month: "2026-10",
      exponent: 2,
    });
    expect(progress).toMatchObject({
      owed: 1_000_000n,
      started: 1_000_000n,
      paidOff: false,
      paidThisMonth: false,
      original: null,
    });
    expect(paidOffSavings(progress, "2026-10")).toBeNull();
  });

  it("is paid off in 0 months with no history", () => {
    const progress = loanProgress({ history: [], termsFor, month: "2026-10", exponent: 2 });
    expect(progress).toMatchObject({
      owed: 0n,
      paidOff: true,
      monthsSinceStart: 0,
      original: null,
    });
  });
});

describe("loanProgress originalFrom", () => {
  it("draws from a picked month, paying from the later of it and the first payment", () => {
    const history: LoanHistoryMonth[] = [
      {
        month: "2026-08",
        startBalance: 0n,
        opening: -10_000n,
        payments: 0n,
        interest: 0n,
        endBalance: -10_000n,
      },
      {
        month: "2026-09",
        startBalance: -10_000n,
        opening: 0n,
        payments: 0n,
        interest: 0n,
        endBalance: -10_000n,
      },
      {
        month: "2026-10",
        startBalance: -10_000n,
        opening: 0n,
        payments: 2_000n,
        interest: 100n,
        endBalance: -8_100n,
      },
    ];
    const termsFor = () => ({ interestRate: "12", minimumPayment: 2_000n, escrowAmount: null });
    const base = { history, termsFor, month: "2026-10", exponent: 2 };
    expect(loanProgress(base).original).toMatchObject({ from: "2026-08", month: "2026-10" });
    expect(loanProgress({ ...base, originalFrom: "2026-09" }).original).toMatchObject({
      from: "2026-09",
      month: "2026-10",
      owed: 10_000n,
    });
    expect(
      loanProgress({ ...base, originalFrom: "2026-09" }).original?.balances.slice(0, 3),
    ).toEqual([10_000n, 10_000n, 8_100n]);
  });

  it("uses the most owed when the starting balance is $0 (98.1% of $2,074.97)", () => {
    const history: LoanHistoryMonth[] = [
      {
        month: "2026-09",
        startBalance: 0n,
        opening: 0n,
        payments: 0n,
        interest: 0n,
        endBalance: -207_497n,
      },
      {
        month: "2026-10",
        startBalance: -207_497n,
        opening: 0n,
        payments: 5_000n,
        interest: 1_038n,
        endBalance: -203_535n,
      },
    ];
    const termsFor = () => ({ interestRate: "6", minimumPayment: 100n, escrowAmount: null });
    expect(loanProgress({ history, termsFor, month: "2026-10", exponent: 2 }).started).toBe(
      207_497n,
    );
  });
});
