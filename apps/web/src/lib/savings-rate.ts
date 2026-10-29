import type { components } from "@strictbudget/api-client";
import {
  type BudgetMonth,
  foldTail,
  type MonthRange,
  percentOf,
  TOP_INCOME_SOURCES,
} from "@strictbudget/engine";
import { z } from "zod";
import { $api } from "./api";
import { todayIso } from "./dates";
import { NO_PAYEE } from "./income-expense";
import { reportSearchSchema } from "./reports";

export type SavingsRate = components["schemas"]["SavingsRate"];
export type SavingsRateMonth = components["schemas"]["SavingsRateMonth"];
export type SavingsRateCategory = components["schemas"]["SavingsRateCategory"];

/**
 * `saving`: the rate with saving categories and transfers to tracking accounts added back.
 * `plain`: Income v Expense's rate (net income ÷ income), to check against it.
 */
export const SAVINGS_MODES = ["saving", "plain"] as const;
export type SavingsMode = (typeof SAVINGS_MODES)[number];

export const savingsRateSearchSchema = reportSearchSchema.extend({
  mode: z.enum(SAVINGS_MODES).optional().catch(undefined),
});

export const savingsRateOptions = (budgetId: string, range: MonthRange) =>
  $api.queryOptions("get", "/v1/budgets/{budgetId}/reports/savings-rate", {
    params: { path: { budgetId }, query: { from: range.from, to: range.to, today: todayIso() } },
  });

/** A month's rate and rolling rate in the chosen mode (percent, null for a gap). */
export function ratesFor(m: SavingsRateMonth, mode: SavingsMode) {
  return mode === "saving"
    ? { rate: m.rate, rolling: m.rollingRate }
    : { rate: m.plainRate, rolling: m.rollingPlainRate };
}

/** "34.5%", or "–" for no rate. */
export const percentLabel = (rate: number | null) => (rate === null ? "–" : `${rate.toFixed(1)}%`);

/** A goal typed as a percent ("20", "12.5") in basis points, or undefined when it isn't one. */
export function goalFromInput(text: string): number | null | undefined {
  const trimmed = text.trim().replace(/%$/, "").trim();
  if (trimmed === "") return null;
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(trimmed);
  if (!match) return undefined;
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return basisPoints <= 10000 ? basisPoints : undefined;
}

/** Basis points as the goal field shows them ("20", "12.5"). */
export const goalInputText = (basisPoints: number | null) =>
  basisPoints === null ? "" : String(basisPoints / 100);

export interface IncomeSource {
  /** A payee id, null for "[No Payee]"; "other" for the folded tail. */
  key: string;
  name: string;
  months: bigint[];
  total: bigint;
  /** Share of the range's income in percent (display only); null without income. */
  share: number | null;
  /** Months it brought something in, of the months counted. */
  monthsReceived: number;
  /** The payees folded into "Other" (only on it). */
  folded?: number;
}

export const OTHER_SOURCES = "Other income";

/**
 * Income by source for the stacked chart and its table: the `TOP_INCOME_SOURCES` largest payees
 * by total and "Other income" for the rest (the cash flow report folds its sources the same way).
 * Steadiness counts the months up to `current`, so months still to come don't count as missed.
 */
export function incomeSources(input: {
  months: readonly BudgetMonth[];
  current: BudgetMonth;
  sums: readonly { month?: string | null; payeeId?: string | null; net: string }[];
  payees: readonly { id: string; name: string }[];
}): { sources: IncomeSource[]; total: bigint[]; grandTotal: bigint; monthsCounted: number } {
  const index = new Map(input.months.map((m, i) => [m as string, i]));
  const names = new Map(input.payees.map((p) => [p.id, p.name]));
  const byPayee = new Map<string, bigint[]>();
  for (const s of input.sums) {
    const i = s.month ? index.get(s.month) : undefined;
    if (i === undefined) continue;
    const key = s.payeeId ?? "";
    const cells = byPayee.get(key) ?? input.months.map(() => 0n);
    cells[i] = (cells[i] ?? 0n) + BigInt(s.net);
    byPayee.set(key, cells);
  }
  const counted = input.months.filter((m) => m <= input.current).length;
  const total = input.months.map((_, i) =>
    [...byPayee.values()].reduce((sum, cells) => sum + (cells[i] ?? 0n), 0n),
  );
  const grandTotal = total.reduce((s, v) => s + v, 0n);
  const sourceOf = (key: string, name: string, months: bigint[]): IncomeSource => {
    const sum = months.reduce((s, v) => s + v, 0n);
    return {
      key,
      name,
      months,
      total: sum,
      share: grandTotal > 0n ? percentOf(sum, grandTotal) : null,
      monthsReceived: months.filter((v, i) => v > 0n && (input.months[i] ?? "") <= input.current)
        .length,
    };
  };
  const all = [...byPayee].map(([key, cells]) =>
    sourceOf(key, key === "" ? NO_PAYEE : (names.get(key) ?? NO_PAYEE), cells),
  );
  const { top, rest } = foldTail(all, TOP_INCOME_SOURCES, (s) => s.total);
  const sources = [...top];
  if (rest.length) {
    const cells = input.months.map((_, i) => rest.reduce((s, r) => s + (r.months[i] ?? 0n), 0n));
    sources.push({ ...sourceOf("other", OTHER_SOURCES, cells), folded: rest.length });
  }
  return { sources, total, grandTotal, monthsCounted: counted };
}
