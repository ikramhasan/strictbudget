import {
  addMonths,
  type BudgetMonth,
  type CurrencyCode,
  currencyExponent,
  effectivePayment,
  type LoanHistoryMonth,
  type LoanProgress,
  loanProgress,
  minimumToPayDown,
  monthsBetween,
  type PayoffProjection,
  payoffProjection,
  payoffSchedule,
} from "@strictbudget/engine";
import type { LoanActivity } from "./loans";

/**
 * The loan planner's view of a loan, built on the engine's `loan-planner` from the loan activity
 * API.
 */

export interface PlannerTerms {
  interestRate: string | null;
  minimumPayment: bigint | null;
  escrowAmount: bigint | null;
}

export function loanHistory(activity: LoanActivity): LoanHistoryMonth[] {
  return activity.months.map((m) => ({
    month: m.month,
    startBalance: BigInt(m.startBalance),
    endBalance: BigInt(m.endBalance),
    payments: BigInt(m.payments),
    interest: BigInt(m.interest.applied),
    opening: m.transactions
      .filter((t) => t.kind === "starting_balance")
      .reduce((s, t) => s + BigInt(t.amount), 0n),
  }));
}

/** The terms that apply in `month` (months before the first entry use it). */
export function termsLookup(activity: LoanActivity) {
  const terms = activity.terms.map((t) => ({
    month: t.month,
    interestRate: t.interestRate,
    minimumPayment: t.minimumPayment === null ? null : BigInt(t.minimumPayment),
    escrowAmount: t.escrowAmount === null ? null : BigInt(t.escrowAmount),
  }));
  return (month: BudgetMonth): PlannerTerms | null => {
    let found: PlannerTerms | null = null;
    for (const t of terms) {
      if (t.month <= month || found === null) found = t;
      if (t.month > month) break;
    }
    return found;
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "1 month", "10 months", "1 year", "2 years", "1 yr, 1 mo", "4 yrs, 10 mos". */
export function formatDuration(months: number) {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return plural(rest, "month", "months");
  if (rest === 0) return plural(years, "year", "years");
  return `${plural(years, "yr", "yrs")}, ${plural(rest, "mo", "mos")}`;
}

/** A track to plot: what's owed at the start of each month from `from`. */
export interface Track {
  from: BudgetMonth;
  balances: bigint[];
}

export interface LoanPlan {
  progress: LoanProgress;
  current: BudgetMonth;
  exponent: number;
  rate: string | null;
  /** The minimum payment, less escrow (null without one). */
  minimum: bigint | null;
  /** The minimum as entered (escrow included), for messages. */
  minimumShown: bigint | null;
  /** The paired category's Monthly Debt Payment target, less escrow, if any. */
  target: bigint | null;
  targetShown: bigint | null;
  byMinimum: PayoffProjection | null;
  byTarget: PayoffProjection | null;
  /** The header's Payoff Date: from the target when there is one, else the minimum. */
  payoffMonth: BudgetMonth | null;
  tracks: {
    past: Track;
    current: Track | null;
    minimum: Track | null;
    original: Track | null;
  };
}

/**
 * Everything the loan page shows about the payoff. With `targetAmount` (the paired category's
 * Monthly Debt Payment target) it projects with the target (Payoff Date, Current Track) and adds
 * the Original Payment Schedule and Minimum Payment lines.
 */
export function loanPlan(input: {
  activity: LoanActivity;
  currency: CurrencyCode;
  current: BudgetMonth;
  targetAmount: bigint | null;
  /** A Past Balance month picked as the original schedule's start. */
  originalFrom?: BudgetMonth;
}): LoanPlan {
  const { activity, currency, current } = input;
  const exponent = currencyExponent(currency);
  const terms = termsLookup(activity);
  const history = loanHistory(activity);
  const progress = loanProgress({
    history,
    termsFor: terms,
    month: current,
    exponent,
    originalFrom: input.originalFrom,
  });
  const now = terms(current);
  const rate = now?.interestRate ?? null;
  const escrow = now?.escrowAmount ?? null;
  const minimum = effectivePayment(now?.minimumPayment ?? null, escrow);
  const target = effectivePayment(input.targetAmount, escrow);
  const project = (payment: bigint | null) =>
    payment === null || progress.paidOff
      ? null
      : payoffProjection({ owed: progress.owed, rate, payment, exponent });
  const track = (payment: bigint | null): Track | null => {
    if (payment === null || progress.paidOff) return null;
    const schedule = payoffSchedule({ owed: progress.owed, rate, payment, exponent });
    return schedule && { from: addMonths(current, 1), balances: [progress.owed, ...schedule] };
  };
  const byMinimum = project(minimum);
  const byTarget = project(target);
  const tracking = target !== null ? byTarget : byMinimum;

  // Past Balance: what was owed at the start of each month, then after this month.
  const past: Track = {
    from: history[0]?.month ?? current,
    balances: [
      ...history.map((m, i) => -(m.startBalance + (i === 0 ? m.opening : 0n))),
      ...(progress.paidOff ? [] : [progress.owed]),
    ],
  };
  const original = progress.original && {
    from: progress.original.from,
    balances: progress.original.balances,
  };
  return {
    progress,
    current,
    exponent,
    rate,
    minimum,
    minimumShown: now?.minimumPayment ?? null,
    target,
    targetShown: input.targetAmount,
    byMinimum,
    byTarget,
    payoffMonth: tracking && !progress.paidOff ? addMonths(current, tracking.months) : null,
    tracks: {
      past,
      current: track(target ?? minimum),
      minimum: target !== null && target !== minimum ? track(minimum) : null,
      original: target !== null || progress.paidOff ? original : null,
    },
  };
}

/** The months a chart covers: from the first track's start to the last one's end. */
export function chartMonths(tracks: readonly (Track | null)[]): BudgetMonth[] {
  const shown = tracks.filter((t): t is Track => t !== null && t.balances.length > 0);
  if (shown.length === 0) return [];
  const first = shown.map((t) => t.from).reduce((a, b) => (a < b ? a : b));
  const last = shown
    .map((t) => addMonths(t.from, t.balances.length - 1))
    .reduce((a, b) => (a > b ? a : b));
  return Array.from({ length: monthsBetween(first, last) + 1 }, (_, i) => addMonths(first, i));
}

/** A track's balance at the start of `month`, or undefined outside it. */
export function trackAt(track: Track | null, month: BudgetMonth): bigint | undefined {
  if (!track) return undefined;
  const index = monthsBetween(track.from, month);
  return index >= 0 ? track.balances[index] : undefined;
}

/**
 * A chart coordinate for `minorUnits`: whole major units, by bigint division. Only for placing
 * points on the chart; amounts shown are always formatted from the bigint.
 */
export function plotValue(minorUnits: bigint, exponent: number): number {
  return Number(minorUnits / 10n ** BigInt(exponent));
}

/** "$9,745 (97.5%)": what's left as a share of the starting balance, one decimal, half up. */
export function remainingPercent(owed: bigint, started: bigint): string {
  if (started <= 0n) return "0.0";
  const tenths = (owed * 2000n + started) / (2n * started); // owed ÷ started × 1000, half up
  return `${tenths / 10n}.${tenths % 10n}`;
}

/** The share card's "3% Paid Off": whole percent, half up. */
export function paidOffPercent(owed: bigint, started: bigint): string {
  if (started <= 0n) return "100";
  const paid = started - owed;
  return ((paid * 200n + started) / (2n * started)).toString();
}

/** A piece of a message; `strong` pieces are highlighted amounts and durations. */
export type MessagePart = string | { strong: string };

export interface ProgressMessage {
  /** Yellow for a target below the minimum or the interest; green when paid off. */
  tone: "info" | "warning" | "success";
  lines: MessagePart[][];
  /** "Increase your target" (the target can't beat the interest). */
  increaseTarget?: boolean;
  /** "Increase your minimum monthly payment" (no target, and the minimum can't beat it). */
  increaseMinimum?: boolean;
}

/**
 * The message under the progress chart, or null when there's nothing it could say (no terms that
 * pay the loan down).
 */
export function progressMessage(
  plan: LoanPlan,
  format: (minorUnits: bigint) => string,
  savings: { interest: bigint; months: number } | null,
): ProgressMessage | null {
  const { progress, byMinimum, byTarget } = plan;
  const strong = (text: string) => ({ strong: text });
  if (progress.paidOff) {
    const months = strong(formatDuration(progress.monthsSinceStart));
    return {
      tone: "success",
      lines: savings
        ? [
            ["You did it! You paid off your loan in ", months, " !!"],
            [
              `You saved ${format(savings.interest)} in interest and paid it off `,
              `${formatDuration(savings.months)} earlier. Time to celebrate!`,
            ],
          ]
        : [["You did it! You paid off your loan in ", months, " . Time to celebrate!!"]],
    };
  }
  const minimum = plan.minimumShown;
  if (plan.targetShown === null) {
    if (minimum === null || plan.rate === null) return null;
    if (!byMinimum) {
      return {
        tone: "warning",
        increaseMinimum: true,
        lines: [
          [
            "We estimate the interest charges for this loan will be greater than the minimum payment.",
          ],
          ["to at least ", strong(format(minimumToPayDownNow(plan))), " to pay off this loan."],
        ],
      };
    }
    return {
      tone: "info",
      lines: [
        [
          "The minimum payment of ",
          strong(format(minimum)),
          " will pay off this loan in ",
          strong(formatDuration(byMinimum.months)),
        ],
      ],
    };
  }
  const target = strong(format(plan.targetShown));
  if (!byTarget) {
    return {
      tone: "warning",
      increaseTarget: true,
      lines: [
        [
          "We estimate the interest charges for this loan will be greater than your monthly target.",
        ],
        [
          "to at least ",
          strong(format(minimumToPayDownNow(plan))),
          ...(minimum !== null ? [", or to the account minimum of ", strong(format(minimum))] : []),
        ],
      ],
    };
  }
  if (!byMinimum || plan.targetShown === minimum) {
    return {
      tone: "info",
      lines: [
        [
          "Your monthly target of ",
          target,
          " keeps you on track to pay off this loan in ",
          strong(formatDuration(byTarget.months)),
        ],
      ],
    };
  }
  const months = strong(formatDuration(Math.abs(byMinimum.months - byTarget.months)));
  const interest = byMinimum.interest - byTarget.interest;
  if (minimum !== null && plan.targetShown < minimum) {
    return {
      tone: "warning",
      lines: [
        interest < 0n
          ? [
              "Your monthly target of ",
              target,
              " may increase the time to pay your loan off by ",
              months,
              " and you may owe an additional ",
              strong(format(-interest)),
              " in interest.",
            ]
          : [
              "Your monthly target of ",
              target,
              " may increase the time to pay your loan off by ",
              months,
              " .",
            ],
      ],
    };
  }
  return {
    tone: "info",
    lines: [
      interest > 0n
        ? [
            "Your monthly target of ",
            target,
            " saves you ",
            strong(format(interest)),
            " in interest over the remainder of your loan, and you’ll pay the loan off ",
            months,
            " sooner.",
          ]
        : [
            "You’ll pay off your loan ",
            months,
            " sooner if you continue to pay ",
            target,
            " each month.",
          ],
    ],
  };
}

/** "to at least $48.74": this month's interest on what's owed, plus a minor unit. */
function minimumToPayDownNow(plan: LoanPlan) {
  return minimumToPayDown(plan.progress.owed, plan.rate, plan.exponent);
}
