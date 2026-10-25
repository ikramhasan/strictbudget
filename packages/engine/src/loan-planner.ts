import Decimal from "decimal.js";
import { monthlyInterest, rateThousandths } from "./loans";
import { addMonths, type BudgetMonth } from "./months";

/**
 * The loan planner: payoff projections and what-ifs for the loan page, payoff simulator and Debt
 * Payment targets. Nothing here writes to the ledger.
 *
 * Projections use the closed-form annuity rather than month by month: a payment `A` pays `P`
 * off in n = −ln(1 − iP/A) / ln(1 + i) months (i = rate ÷ 1200), payments starting next month, so
 * the payoff month is this month + ⌈n⌉ and the interest still to pay is n·A − P, rounded half up
 * ($10,000.00 at 6% paying $200.00: n = 57.68, Aug 2031 from October, $1,536.03). The chart is a
 * month-by-month schedule instead (`payoffSchedule`). Logarithms and powers use decimal.js at 40
 * significant digits; money stays in bigint minor units.
 */

const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** A month count this close to a whole number is that number (40-digit noise). */
const WHOLE = new Dec("1e-20");

/** The monthly rate as a fraction: rate% ÷ 12 ÷ 100. */
const monthlyRate = (rate: string) => new Dec(rateThousandths(rate).toString()).div(1_200_000);

const ceilMonths = (n: Decimal) => {
  const whole = n.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return (whole.minus(n).abs().lte(WHOLE) ? whole : n.ceil()).toNumber();
};

/** The smallest payment that pays the loan down: a month's interest plus one minor unit. */
export function minimumToPayDown(owed: bigint, rate: string | null, exponent: number): bigint {
  return monthlyInterest(owed, rate, exponent) + 1n;
}

export interface PayoffProjection {
  /** Payments still needed (⌈n⌉), the first next month; 0 when nothing is owed. */
  months: number;
  /** Interest still to pay, n·A − P rounded half up (minor units). */
  interest: bigint;
}

/**
 * How long `payment` a month takes to pay off `owed` (minor units, positive) at `rate`, and the
 * interest on the way; null when it never does: no rate, or a payment that doesn't beat the
 * month's interest ($50.00 against $50.00 of interest never pays it off, $50.01 does by Feb
 * 2169). A 0% loan takes owed ÷ payment months.
 */
export function payoffProjection(input: {
  owed: bigint;
  rate: string | null;
  payment: bigint;
  exponent: number;
}): PayoffProjection | null {
  const { owed, rate, payment, exponent } = input;
  if (owed <= 0n) return { months: 0, interest: 0n };
  if (rate === null || payment < minimumToPayDown(owed, rate, exponent)) return null;
  const P = new Dec(owed.toString());
  const A = new Dec(payment.toString());
  const i = monthlyRate(rate);
  const n = i.isZero()
    ? P.div(A)
    : Dec.ln(new Dec(1).minus(i.times(P).div(A)))
        .neg()
        .div(Dec.ln(i.plus(1)));
  const interest = n.times(A).minus(P).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return {
    months: ceilMonths(n),
    interest: BigInt(interest.isNegative() ? 0 : interest.toFixed(0)),
  };
}

/**
 * The monthly payment that pays `owed` off in `months` payments (the first next month): the
 * annuity payment P·i / (1 − (1 + i)^−k), rounded up to the minor unit ($10,000.00 at 6% by Dec
 * 2027, 14 payments, is $741.37 for $741.3609). Null for fewer than one payment or without a rate.
 */
export function paymentForMonths(input: {
  owed: bigint;
  rate: string | null;
  months: number;
}): bigint | null {
  const { owed, rate, months } = input;
  if (months < 1 || rate === null) return null;
  if (owed <= 0n) return 0n;
  const P = new Dec(owed.toString());
  const i = monthlyRate(rate);
  const A = i.isZero() ? P.div(months) : P.times(i).div(new Dec(1).minus(i.plus(1).pow(-months)));
  // Snap 40-digit noise (an exact $10,050.00 came out 10050.000…01) before rounding up.
  return BigInt(A.toDecimalPlaces(20).toDecimalPlaces(0, Decimal.ROUND_CEIL).toFixed(0));
}

/** Longest schedule drawn (a payment $0.01 above the interest can take 142 years). */
const SCHEDULE_LIMIT = 2400;

/**
 * What's owed after each monthly payment until it's paid off (the last entry is 0), with each
 * month's interest from `monthlyInterest`. Empty when nothing is owed; null when the payment never
 * pays it off.
 */
export function payoffSchedule(input: {
  owed: bigint;
  rate: string | null;
  payment: bigint;
  exponent: number;
}): bigint[] | null {
  const { owed, rate, payment, exponent } = input;
  if (owed <= 0n) return [];
  if (rate === null || payment < minimumToPayDown(owed, rate, exponent)) return null;
  const balances: bigint[] = [];
  let left = owed;
  while (left > 0n && balances.length < SCHEDULE_LIMIT) {
    left = left + monthlyInterest(left, rate, exponent) - payment;
    if (left < 0n) left = 0n;
    balances.push(left);
  }
  return balances;
}

export interface PlannedPayoff extends PayoffProjection {
  payoffMonth: BudgetMonth;
  /** What's owed after this month: the start of the projection. */
  owedAfterThisMonth: bigint;
}

/**
 * A plan from this month on (Current Track and the payoff simulator): `payment` a month from
 * next month, after an optional one-time `extra` this month. With no payment yet this month,
 * paying an extra pays this month's `payment` and interest too ($10,000.00, $200.00 a month,
 * $1,000.00 extra in October → $8,850.00 from November, interest $50.00 + $1,177.59); after a
 * payment this month it only lowers the balance ($9,850.00 → $8,850.00, interest $1,177.59).
 */
export function plannedPayoff(input: {
  owed: bigint;
  rate: string | null;
  payment: bigint;
  exponent: number;
  month: BudgetMonth;
  extra?: bigint;
  paidThisMonth?: boolean;
}): PlannedPayoff | null {
  const { owed, rate, payment, exponent, month } = input;
  const extra = input.extra ?? 0n;
  let after = owed;
  let interestNow = 0n;
  if (extra > 0n && owed > 0n) {
    if (input.paidThisMonth) after = owed - extra;
    else {
      interestNow = monthlyInterest(owed, rate, exponent);
      after = owed + interestNow - payment - extra;
    }
  }
  if (after < 0n) after = 0n;
  const projection = payoffProjection({ owed: after, rate, payment, exponent });
  if (!projection) return null;
  return {
    months: projection.months,
    interest: projection.interest + interestNow,
    payoffMonth: addMonths(month, projection.months),
    owedAfterThisMonth: after,
  };
}

/** A month of the loan's activity (`loanMonths`), in what the planner needs. */
export interface LoanHistoryMonth {
  month: BudgetMonth;
  /** Balance at the end of the previous month (signed like the account: debt is negative). */
  startBalance: bigint;
  endBalance: bigint;
  /** The month's payments (positive). */
  payments: bigint;
  /** Interest applied in the month (positive). */
  interest: bigint;
  /** The month's starting-balance transactions (the loan's first month only). */
  opening: bigint;
}

export function monthsBetween(a: BudgetMonth, b: BudgetMonth): number {
  const [ay, am] = a.split("-").map(Number) as [number, number];
  const [by, bm] = b.split("-").map(Number) as [number, number];
  return (by - ay) * 12 + (bm - am);
}

export interface LoanProgress {
  /** What's owed today (positive). */
  owed: bigint;
  /**
   * What was owed when the loan started: its starting balance, or with none, the most it has owed.
   */
  started: bigint;
  paidOff: boolean;
  paidThisMonth: boolean;
  paymentsThisMonth: bigint;
  /** "You paid off your loan in N months": this month − the loan's first month. */
  monthsSinceStart: number;
  /**
   * The Original Payment Schedule: drawn from the loan's first month (or a Past Balance picked
   * as its base), the minimum payment from the first month with a payment on what was owed at its
   * start; null before any payment or without terms that pay it off.
   */
  original: {
    /** Where the line starts. */
    from: BudgetMonth;
    /** The month its payments start. */
    month: BudgetMonth;
    owed: bigint;
    payment: bigint;
    projection: PayoffProjection;
    /** What's owed at the start of each month from `from` on, ending at 0. */
    balances: bigint[];
  } | null;
  /** Interest charged so far (positive). */
  interestPaid: bigint;
}

/**
 * Where a loan stands against the plan it started with. Paid off, it shows "You saved $2.10 in
 * interest and paid it off 4 months earlier": the original schedule's interest less what was
 * charged, and the month the original schedule reaches 0 less this month (e.g.
 * $100.00 at 12% from July, $20.00 minimum, $101.00 paid on August 10 → original Aug–Jan, $3.10;
 * charged $1.00; 4 months from October; paid on September 10 instead → 5 months).
 */
export function loanProgress(input: {
  history: readonly LoanHistoryMonth[];
  termsFor: (month: BudgetMonth) => {
    interestRate: string | null;
    minimumPayment: bigint | null;
    escrowAmount: bigint | null;
  } | null;
  month: BudgetMonth;
  exponent: number;
  /**
   * A Past Balance month to base the original schedule on: the line starts there, and its payments
   * at the later of it and the first month with a payment (the loan above, paid in September,
   * based on August: $100.00 in August and September, $81.00 in October).
   */
  originalFrom?: BudgetMonth;
}): LoanProgress {
  const { history, month, exponent } = input;
  const last = history.at(-1);
  const first = history[0];
  const owed = last ? -last.endBalance : 0n;
  const opening = first ? -(first.startBalance + first.opening) : 0n;
  const most = history.reduce((m, h) => (-h.endBalance > m ? -h.endBalance : m), 0n);
  const started = opening > 0n ? opening : most;
  const interestPaid = history.reduce((s, m) => s + m.interest, 0n);
  const firstPaid = history.find((m) => m.payments > 0n);
  const from = input.originalFrom ?? first?.month;
  const paidMonth =
    firstPaid && from && from > firstPaid.month ? history.find((m) => m.month === from) : firstPaid;
  // What was owed at the start of a month (the first month's starting balance included).
  const owedAt = (m: LoanHistoryMonth) => -(m.startBalance + m.opening);
  let original: LoanProgress["original"] = null;
  if (paidMonth && from) {
    const terms = input.termsFor(paidMonth.month);
    const startOwed = owedAt(paidMonth);
    const payment = effectivePayment(terms?.minimumPayment ?? null, terms?.escrowAmount ?? null);
    const rate = terms?.interestRate ?? null;
    const projection =
      payment !== null ? payoffProjection({ owed: startOwed, rate, payment, exponent }) : null;
    const schedule =
      payment !== null ? payoffSchedule({ owed: startOwed, rate, payment, exponent }) : null;
    if (payment !== null && projection && schedule) {
      const lead = history.filter((m) => m.month >= from && m.month < paidMonth.month).map(owedAt);
      original = {
        from: lead.length > 0 ? from : paidMonth.month,
        month: paidMonth.month,
        owed: startOwed,
        payment,
        projection,
        balances: [...lead, startOwed, ...schedule],
      };
    }
  }
  return {
    owed,
    started,
    paidOff: owed <= 0n,
    paidThisMonth: last?.month === month && last.payments > 0n,
    paymentsThisMonth: last?.month === month ? last.payments : 0n,
    monthsSinceStart: first ? Math.max(0, monthsBetween(first.month, month)) : 0,
    original,
    interestPaid,
  };
}

/**
 * What of a payment goes to principal and interest: escrow comes off first ($900.00 with $150.00
 * escrow pays off like $750.00). Null without a payment.
 */
export function effectivePayment(payment: bigint | null, escrow: bigint | null): bigint | null {
  if (payment === null) return null;
  const left = payment - (escrow && escrow > 0n ? escrow : 0n);
  return left > 0n ? left : 0n;
}

/** The paid-off line: interest saved and months earlier than the original schedule. */
export function paidOffSavings(progress: LoanProgress, month: BudgetMonth) {
  if (!progress.paidOff || !progress.original) return null;
  const zeroMonth = addMonths(progress.original.month, progress.original.projection.months);
  const saved = progress.original.projection.interest - progress.interestPaid;
  return {
    interest: saved > 0n ? saved : 0n,
    months: Math.max(0, monthsBetween(month, zeroMonth)),
  };
}
