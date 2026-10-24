import type { components } from "@strictbudget/api-client";
import {
  type AccountType,
  type BudgetMonth,
  changeOf,
  type DelimitedCell,
  divideRounded,
  type MonthRange,
  type NumberFormat,
  plainAmount,
  toDelimited,
} from "@strictbudget/engine";
import { $api } from "./api";
import { todayIso } from "./dates";
import { type ExportFile, monthLabel } from "./reports";

export type NetWorthReport = components["schemas"]["NetWorthReport"];
export type NetWorthMonth = components["schemas"]["NetWorthMonth"];
export type NetWorthAccount = components["schemas"]["NetWorthAccount"];

export const netWorthOptions = (r: { budgetId: string; range: MonthRange; accounts?: string }) =>
  $api.queryOptions("get", "/v1/budgets/{budgetId}/reports/net-worth", {
    params: {
      path: { budgetId: r.budgetId },
      query: {
        from: r.range.from,
        to: r.range.to,
        today: todayIso(),
        ...(r.accounts !== undefined && { accountIds: r.accounts }),
      },
    },
  });

/**
 * A change as a percent of |base| with one decimal ("-5.2%", "-16,132,587.0%"): exact tenths,
 * rounded half up; null when the base is zero.
 */
export function percentLabel(change: bigint, base: bigint): string | null {
  if (base === 0n) return null;
  const tenths = divideRounded(change * 1000n, base < 0n ? -base : base, "half-up");
  const negative = tenths < 0n;
  const abs = negative ? -tenths : tenths;
  const whole = (abs / 10n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${whole}.${abs % 10n}%`;
}

export interface MonthRow {
  month: BudgetMonth;
  netWorth: bigint;
  assets: bigint;
  debts: bigint;
  /** Against the month before (the first month against the range's opening). */
  change: bigint;
  changePercent: string | null;
  allTimeHigh: boolean;
}

/** The table (Month, Net Worth, Monthly Change), newest first. */
export function monthRows(report: Pick<NetWorthReport, "opening" | "months">): MonthRow[] {
  let previous = BigInt(report.opening.netWorth);
  const rows = report.months.map((m) => {
    const netWorth = BigInt(m.netWorth);
    const { amount } = changeOf(netWorth, previous);
    const row: MonthRow = {
      month: m.month,
      netWorth,
      assets: BigInt(m.assets),
      debts: BigInt(m.debts),
      change: amount,
      changePercent: percentLabel(amount, previous),
      allTimeHigh: m.allTimeHigh,
    };
    previous = netWorth;
    return row;
  });
  return rows.reverse();
}

export interface Headline {
  netWorth: bigint;
  assets: bigint;
  debts: bigint;
  /** Change in Net Worth: the last month's net worth less the first month's. */
  rangeChange: bigint;
  rangePercent: string | null;
  /** The last month against the one before. */
  monthChange: bigint;
  monthPercent: string | null;
}

export function headline(report: Pick<NetWorthReport, "opening" | "months">): Headline | null {
  const first = report.months[0];
  const last = report.months.at(-1);
  if (!first || !last) return null;
  const before = report.months.at(-2)?.netWorth ?? report.opening.netWorth;
  const netWorth = BigInt(last.netWorth);
  const rangeChange = netWorth - BigInt(first.netWorth);
  const monthChange = netWorth - BigInt(before);
  return {
    netWorth,
    assets: BigInt(last.assets),
    debts: BigInt(last.debts),
    rangeChange,
    rangePercent: percentLabel(rangeChange, BigInt(first.netWorth)),
    monthChange,
    monthPercent: percentLabel(monthChange, BigInt(before)),
  };
}

/** The composition chart's account kinds, assets first. */
export const COMPOSITION_KINDS = [
  "cash",
  "savings",
  "investments",
  "credit",
  "loans",
  "liabilities",
] as const;
export type CompositionKind = (typeof COMPOSITION_KINDS)[number];

export const COMPOSITION_LABELS: Record<CompositionKind, string> = {
  cash: "Cash",
  savings: "Savings",
  investments: "Investments and other assets",
  credit: "Credit cards",
  loans: "Loans",
  liabilities: "Other liabilities",
};

const KIND_OF: Record<AccountType, CompositionKind> = {
  checking: "cash",
  cash: "cash",
  savings: "savings",
  asset: "investments",
  credit_card: "credit",
  line_of_credit: "credit",
  mortgage: "loans",
  auto_loan: "loans",
  student_loan: "loans",
  personal_loan: "loans",
  medical_debt: "loans",
  other_debt: "loans",
  liability: "liabilities",
};

export const compositionKind = (type: AccountType) => KIND_OF[type];

/**
 * Each month's balances summed by account kind (in the budget's currency; balances with no rate
 * left out), for the stacked area view.
 */
export function composition(report: Pick<NetWorthReport, "months" | "accounts">) {
  return report.months.map((m, i) => {
    const sums = Object.fromEntries(COMPOSITION_KINDS.map((k) => [k, 0n])) as Record<
      CompositionKind,
      bigint
    >;
    for (const a of report.accounts) {
      const base = a.balances[i]?.base;
      if (base) sums[KIND_OF[a.type]] += BigInt(base);
    }
    return { month: m.month, sums };
  });
}

/** The kinds that hold anything in the range (the rest would be empty series). */
export function usedKinds(rows: ReturnType<typeof composition>): CompositionKind[] {
  return COMPOSITION_KINDS.filter((k) => rows.some((r) => r.sums[k] !== 0n));
}

export const PART_LABELS = {
  netSaved: "Net saved from income",
  debtPaidDown: "Debt paid down",
  tracking: "Tracking accounts",
  other: "Other",
} as const;
export type PartKey = keyof typeof PART_LABELS;
export const PART_KEYS = Object.keys(PART_LABELS) as PartKey[];

export const PART_HINTS: Record<PartKey, string> = {
  netSaved:
    "What your budget accounts took in less what they spent, money sent to loans and tracking accounts included. Starting balances don't count.",
  debtPaidDown: "Payments into your loan accounts.",
  tracking: "What your tracking accounts' transactions added: contributions and value updates.",
  other:
    "New accounts' starting balances, loan interest, escrow and adjustments, and exchange-rate changes.",
};

export interface WaterfallStep {
  key: "start" | PartKey | "end";
  label: string;
  /** The step's own amount (the start and end bars: the net worth). */
  amount: bigint;
  /** Where the bar runs, from–to. */
  low: bigint;
  high: bigint;
}

/**
 * "What changed this month": last month's net worth, each part stacked on the running total, then
 * this month's. The parts add up to the change, so the last part ends at this month's net worth.
 */
export function waterfall(previous: bigint, month: NetWorthMonth): WaterfallStep[] {
  const steps: WaterfallStep[] = [
    {
      key: "start",
      label: "Last month",
      amount: previous,
      low: min(0n, previous),
      high: max(0n, previous),
    },
  ];
  let running = previous;
  for (const key of PART_KEYS) {
    const amount = BigInt(month.parts[key]);
    const next = running + amount;
    steps.push({
      key,
      label: PART_LABELS[key],
      amount,
      low: min(running, next),
      high: max(running, next),
    });
    running = next;
  }
  const end = BigInt(month.netWorth);
  steps.push({
    key: "end",
    label: "This month",
    amount: end,
    low: min(0n, end),
    high: max(0n, end),
  });
  return steps;
}

/**
 * The waterfall's value axis, zoomed onto the change: from the lowest to the highest running total
 * (with room around), not from zero, so a month's parts stay visible next to a large net worth.
 * The start and end bars grow from `baseline`: zero when it's in view, else the edge on the
 * values' side (the axis' bottom for a positive net worth, its top for a negative one).
 */
export function waterfallScale(steps: readonly WaterfallStep[]) {
  const points = steps.flatMap((s) =>
    s.key === "start" || s.key === "end" ? [s.amount] : [s.low, s.high],
  );
  let low = points.reduce(min);
  let high = points.reduce(max);
  const span = high - low;
  const largest = max(low < 0n ? -low : low, high < 0n ? -high : high);
  const pad = span > 0n ? span / 4n : max(largest / 10n, 1n);
  low -= pad;
  high += pad;
  if (low > 0n && low < pad * 2n) low = 0n;
  if (high < 0n && -high < pad * 2n) high = 0n;
  const baseline = low <= 0n && high >= 0n ? 0n : low > 0n ? low : high;
  return { low, high, baseline };
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

/** The net worth at the end of the month before `month` (the range's opening for its first). */
export function previousNetWorth(
  report: Pick<NetWorthReport, "opening" | "months">,
  index: number,
) {
  return BigInt(index > 0 ? (report.months[index - 1]?.netWorth ?? "0") : report.opening.netWorth);
}

/**
 * The accounts worth listing for the range: anything with a balance in it or at its opening. A
 * closed account that held nothing in the range is left out.
 */
export function shownAccounts(report: Pick<NetWorthReport, "accounts">) {
  return report.accounts.filter(
    (a) => a.opening.native !== "0" || a.balances.some((b) => b.native !== "0"),
  );
}

/**
 * The Net Worth export: "Account" then a column per month, one row per account (every account, in
 * the order they were made) with its month-end balance, then "Net Worth". Plain amounts in the
 * budget's currency; no byte-order mark, unlike the spending exports. A balance with no rate is an
 * empty cell.
 */
export function exportRows(
  report: Pick<NetWorthReport, "accounts" | "months">,
  exponent: number,
  numberFormat: NumberFormat,
): DelimitedCell[][] {
  const amount = (value: string | null): DelimitedCell =>
    value === null ? { raw: "" } : { raw: plainAmount(BigInt(value), exponent, numberFormat) };
  return [
    ["Account", ...report.months.map((m) => monthLabel(m.month))],
    ...report.accounts.map((a) => [a.name, ...a.balances.map((b) => amount(b.base))]),
    ["Net Worth", ...report.months.map((m) => amount(m.netWorth))],
  ];
}

export function exportFile(
  report: Pick<NetWorthReport, "accounts" | "months">,
  exponent: number,
  numberFormat: NumberFormat,
  delimiter: "," | "\t",
  today: string,
): ExportFile {
  // The Net Worth file has no byte-order mark; toDelimited always starts with one.
  const text = toDelimited(exportRows(report, exponent, numberFormat), delimiter).slice(1);
  return { name: `net-worth-${today}.${delimiter === "\t" ? "tsv" : "csv"}`, text };
}

/**
 * One account's month-end balances in its own currency, from its first month with a transaction
 * (the register's balance chart).
 */
export function accountHistory(
  report: Pick<NetWorthReport, "accounts" | "months">,
  accountId: string,
) {
  const account = report.accounts.find((a) => a.id === accountId);
  if (!account?.firstMonth) return [];
  const first = account.firstMonth;
  return report.months
    .map((m, i) => ({ month: m.month, balance: BigInt(account.balances[i]?.native ?? "0") }))
    .filter((m) => m.month >= first);
}
