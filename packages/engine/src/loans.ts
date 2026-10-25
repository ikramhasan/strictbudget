import { addMonths, type BudgetMonth, monthOf } from "./months";
import { divideRounded } from "./rounding";

/**
 * Loan activity: each month that has payments is charged escrow first, then
 * the month's interest, then the rest goes to principal. Interest and escrow aren't transactions;
 * they're worked out per month here and move the loan's balance.
 */

/** A loan's terms from `month` on (until a later entry). */
export interface LoanTerms {
  month: BudgetMonth;
  /** Annual rate in percent with up to three decimals, e.g. "5.125"; null if unknown. */
  interestRate: string | null;
  /** Minor units a month; null if unknown. */
  minimumPayment: bigint | null;
  /** Minor units a month; null or zero when the payment has no escrow. */
  escrowAmount: bigint | null;
}

export const LOAN_LINE_KINDS = ["payment", "starting_balance", "other"] as const;
export type LoanLineKind = (typeof LOAN_LINE_KINDS)[number];

/** A transaction in the loan account. Payments are transfers into it. */
export interface LoanLine {
  date: string;
  /** Minor units, signed like the account (a payment is positive). */
  amount: bigint;
  kind: LoanLineKind;
}

export const LOAN_CHARGE_KINDS = ["interest", "escrow"] as const;
export type LoanChargeKind = (typeof LOAN_CHARGE_KINDS)[number];

export const LOAN_CHARGE_STATUSES = ["edited", "reconciled"] as const;
export type LoanChargeStatus = (typeof LOAN_CHARGE_STATUSES)[number];

/** A month's interest or escrow set by hand or fixed by a reconcile. */
export interface LoanChargeOverride {
  month: BudgetMonth;
  kind: LoanChargeKind;
  /** Minor units charged (positive adds to the debt). */
  amount: bigint;
  status: LoanChargeStatus;
}

export interface LoanCharge {
  /** What the month is charged in full: the estimate (or term) unless overridden. */
  total: bigint;
  /** The part of `total` the month's payments covered (all of an override). */
  applied: bigint;
  status: "estimated" | LoanChargeStatus;
}

export interface LoanMonth {
  month: BudgetMonth;
  startBalance: bigint;
  payments: bigint;
  /** Total of the month's other transactions (starting balance, credits, charges, adjustments). */
  other: bigint;
  interest: LoanCharge;
  escrow: LoanCharge;
  /** `startBalance + payments + other − interest.applied − escrow.applied`. */
  endBalance: bigint;
}

const RATE = /^(\d{1,3})(?:\.(\d{1,3}))?$/;

/** A percentage like "5.125" in thousandths of a percent (5125); throws on anything else. */
export function rateThousandths(rate: string): bigint {
  const match = RATE.exec(rate);
  if (!match) throw new RangeError(`Not an interest rate: ${rate}`);
  return BigInt(match[1] as string) * 1000n + BigInt((match[2] ?? "").padEnd(3, "0"));
}

/**
 * One month's interest on `owed` (minor units, positive) at an annual `rate` in percent:
 * owed × rate ÷ 12 with exact math, rounded half up twice: to the milliunit (a
 * thousandth of the currency's major unit), then to the minor unit. $10,001.00 at 6% is $50.01,
 * $7.00 at 6% is $0.04, and $2,074.97 at 6% ($10.37485) is $10.38, not $10.37.
 * `exponent` is the currency's (2 for USD); with 3 or more there's one rounding.
 */
export function monthlyInterest(owed: bigint, rate: string | null, exponent: number): bigint {
  if (owed <= 0n || rate === null) return 0n;
  const scale = exponent < 3 ? 10n ** BigInt(3 - exponent) : 1n;
  // rate% / 12 = thousandths / (100 × 1000 × 12)
  const milli = divideRounded(owed * scale * rateThousandths(rate), 1_200_000n, "half-up");
  return divideRounded(milli, scale, "half-up");
}

/**
 * The terms that apply in `month`: the latest entry from that month or before. Months before the
 * first entry use the first one.
 */
export function termsFor(terms: readonly LoanTerms[], month: BudgetMonth): LoanTerms | null {
  let found: LoanTerms | null = null;
  for (const t of [...terms].sort((a, b) => a.month.localeCompare(b.month))) {
    if (t.month <= month || found === null) found = t;
    if (t.month > month) break;
  }
  return found;
}

/** A term changed in Update Balance's check step, and whether it's kept after this month. */
export interface LoanTermChange<T> {
  value: T;
  /** "Keep this new … going forward"; unchecked, next month goes back to the old value. */
  keep: boolean;
}

export interface LoanTermsChange {
  interestRate?: LoanTermChange<string | null>;
  escrowAmount?: LoanTermChange<bigint | null>;
}

const sameRate = (a: string | null, b: string | null) =>
  a === null || b === null ? a === b : rateThousandths(a) === rateThousandths(b);

/**
 * The `loan_terms` entries Update Balance's check step writes: the new values from `month` on;
 * with "Keep … going forward" unchecked the old value comes back the month after (rates
 * {Oct: 7%, Nov: 6%}). Values equal to the current ones aren't changes; with none, there's nothing
 * to write.
 */
export function loanTermsEntries(
  terms: readonly LoanTerms[],
  month: BudgetMonth,
  change: LoanTermsChange,
): LoanTerms[] {
  const current: LoanTerms = termsFor(terms, month) ?? {
    month,
    interestRate: null,
    minimumPayment: null,
    escrowAmount: null,
  };
  const rate = change.interestRate;
  const escrow = change.escrowAmount;
  const rateChanged = rate !== undefined && !sameRate(rate.value, current.interestRate);
  const escrowChanged =
    escrow !== undefined && (escrow.value ?? 0n) !== (current.escrowAmount ?? 0n);
  if (!rateChanged && !escrowChanged) return [];
  const now: LoanTerms = {
    ...current,
    month,
    interestRate: rateChanged ? rate.value : current.interestRate,
    escrowAmount: escrowChanged ? escrow.value : current.escrowAmount,
  };
  const entries = [now];
  const rateBack = rateChanged && !rate.keep;
  const escrowBack = escrowChanged && !escrow.keep;
  if (rateBack || escrowBack) {
    entries.push({
      ...now,
      month: addMonths(month, 1),
      interestRate: rateBack ? current.interestRate : now.interestRate,
      escrowAmount: escrowBack ? current.escrowAmount : now.escrowAmount,
    });
  }
  // A value kept going forward also replaces it in later months' entries (an earlier unkept
  // change left one for the month after it, which would otherwise bring the old value back).
  const rateKept = rateChanged && rate.keep;
  const escrowKept = escrowChanged && escrow.keep;
  if (rateKept || escrowKept) {
    const written = new Set(entries.map((e) => e.month));
    for (const t of terms) {
      if (t.month <= month || written.has(t.month)) continue;
      entries.push({
        ...t,
        interestRate: rateKept ? now.interestRate : t.interestRate,
        escrowAmount: escrowKept ? now.escrowAmount : t.escrowAmount,
      });
    }
  }
  return entries;
}

/** `terms` with `entries` written over them (an entry replaces the same month's). */
export function withLoanTerms(
  terms: readonly LoanTerms[],
  entries: readonly LoanTerms[],
): LoanTerms[] {
  const months = new Set(entries.map((e) => e.month));
  return [...terms.filter((t) => !months.has(t.month)), ...entries].sort((a, b) =>
    a.month.localeCompare(b.month),
  );
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);

/**
 * The loan's months from its first transaction through `through` (the user's current month),
 * oldest first. `lines` should stop at the user's today, like account balances.
 */
export function loanMonths(input: {
  lines: readonly LoanLine[];
  terms: readonly LoanTerms[];
  overrides: readonly LoanChargeOverride[];
  through: BudgetMonth;
  /** The loan currency's exponent (for `monthlyInterest`'s rounding). */
  exponent: number;
}): LoanMonth[] {
  const { lines, terms, overrides, through, exponent } = input;
  if (lines.length === 0) return [];
  const first = lines.map((l) => monthOf(l.date)).reduce((a, b) => (a < b ? a : b));
  const last = first > through ? first : through;
  const override = new Map(overrides.map((o) => [`${o.month}:${o.kind}`, o]));

  const months: LoanMonth[] = [];
  let balance = 0n;
  for (let month = first; month <= last; month = addMonths(month, 1)) {
    const own = lines.filter((l) => monthOf(l.date) === month);
    const payments = own.filter((l) => l.kind === "payment").reduce((s, l) => s + l.amount, 0n);
    const other = own.filter((l) => l.kind !== "payment").reduce((s, l) => s + l.amount, 0n);
    // The month's own activity doesn't count, except the loan's starting balance (its first month
    // is charged interest on it).
    const base =
      balance + own.filter((l) => l.kind === "starting_balance").reduce((s, l) => s + l.amount, 0n);
    const term = termsFor(terms, month);
    const paid = payments > 0n ? payments : 0n;

    const escrowOverride = override.get(`${month}:escrow`);
    const escrowTerm = term?.escrowAmount && term.escrowAmount > 0n ? term.escrowAmount : 0n;
    const escrow: LoanCharge = escrowOverride
      ? {
          total: escrowOverride.amount,
          applied: escrowOverride.amount,
          status: escrowOverride.status,
        }
      : { total: escrowTerm, applied: min(escrowTerm, paid), status: "estimated" };

    const interestOverride = override.get(`${month}:interest`);
    const estimate = monthlyInterest(-base, term?.interestRate ?? null, exponent);
    const left = paid - escrow.applied;
    const interest: LoanCharge = interestOverride
      ? {
          total: interestOverride.amount,
          applied: interestOverride.amount,
          status: interestOverride.status,
        }
      : { total: estimate, applied: min(estimate, left > 0n ? left : 0n), status: "estimated" };

    const endBalance = balance + payments + other - interest.applied - escrow.applied;
    months.push({ month, startBalance: balance, payments, other, interest, escrow, endBalance });
    balance = endBalance;
  }
  return months;
}

/** What the charges add to the debt in total (minor units, positive). */
export function loanCharges(months: readonly LoanMonth[]): bigint {
  return months.reduce((s, m) => s + m.interest.applied + m.escrow.applied, 0n);
}
