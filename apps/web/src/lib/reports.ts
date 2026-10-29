import type { components } from "@strictbudget/api-client";
import {
  type BudgetMonth,
  type CurrencyCode,
  comparisonRange,
  currencyExponent,
  isBudgetMonth,
  type MonthRange,
  monthOf,
  presetOf,
  presetRange,
  REPORT_COMPARISONS,
  REPORT_PRESETS,
  type ReportComparison,
  type ReportPreset,
} from "@strictbudget/engine";
import { strToU8, zipSync } from "fflate";
import { z } from "zod";
import { $api } from "./api";
import { todayIso } from "./dates";
import { monthName, monthLabel as shortMonthLabel } from "./months";

export type ReportSum = components["schemas"]["ReportSum"];
export type ReportTransaction = components["schemas"]["ReportTransaction"];
export type ReportKind = "spending" | "income" | "saving" | "activity";
export type ReportGrouping = "month" | "day" | "group" | "category" | "payee" | "account" | "flag";

const month = z.string().refine(isBudgetMonth).optional().catch(undefined);
/** A comma-separated id list kept in the URL ("" = nothing selected). */
const ids = z.string().optional().catch(undefined);

/**
 * The filters every report keeps in its URL, so a report can be shared, reloaded or opened from
 * elsewhere already filtered: the range (a preset, or `from`/`to`), account, category, payee and
 * flag selections, the comparison and the chart/table view.
 */
export const reportSearchSchema = z.object({
  range: z.enum(REPORT_PRESETS).optional().catch(undefined),
  from: month,
  to: month,
  accounts: ids,
  categories: ids,
  payees: ids,
  flags: ids,
  compare: z.enum(REPORT_COMPARISONS).optional().catch(undefined),
  view: z.enum(["chart", "table"]).optional().catch(undefined),
});
export type ReportSearch = z.infer<typeof reportSearchSchema>;

export const currentMonth = (): BudgetMonth => monthOf(todayIso());

/** The months a report's search asks for: `from`/`to` when both are set, else a preset. */
export function resolveRange(
  search: ReportSearch,
  defaultPreset: ReportPreset,
  earliest: BudgetMonth | null,
  current: BudgetMonth = currentMonth(),
): { range: MonthRange; preset: ReportPreset | undefined } {
  if (search.from && search.to && search.from <= search.to) {
    const range = { from: search.from, to: search.to };
    return { range, preset: presetOf(range, current, earliest) };
  }
  const preset = search.range ?? defaultPreset;
  return { range: presetRange(preset, current, earliest), preset };
}

/** A URL id list as an array; undefined means "all". */
export const splitIds = (value: string | undefined) =>
  value === undefined ? undefined : value.split(",").filter(Boolean);

/** The API filters a report's search asks for (the range's and `today` added by the caller). */
export function reportFilters(search: ReportSearch) {
  return {
    ...(search.accounts !== undefined && { accountIds: search.accounts }),
    ...(search.categories !== undefined && { categoryIds: search.categories }),
    ...(search.payees !== undefined && { payeeIds: search.payees }),
    ...(search.flags !== undefined && { flags: search.flags }),
  };
}

type ApiFilters = ReturnType<typeof reportFilters>;

export interface ReportRequest {
  budgetId: string;
  range: MonthRange;
  kind?: ReportKind;
  groupBy?: readonly ReportGrouping[];
  filters?: ApiFilters & { groupIds?: string };
  /** Narrows the months to these days (YYYY-MM-DD, inclusive), e.g. one day of a calendar. */
  days?: { fromDate?: string; toDate?: string };
}

const activityQuery = (r: ReportRequest) => ({
  from: r.range.from,
  to: r.range.to,
  today: todayIso(),
  ...(r.kind && { kind: r.kind }),
  ...(r.groupBy?.length && { groupBy: r.groupBy.join(",") }),
  ...r.filters,
  ...r.days,
});

export const reportActivityOptions = (r: ReportRequest) =>
  $api.queryOptions("get", "/v1/budgets/{budgetId}/reports/activity", {
    params: { path: { budgetId: r.budgetId }, query: activityQuery(r) },
  });

export const reportTransactionsOptions = (
  r: ReportRequest & { order?: "newest" | "largest_outflow"; limit?: number },
) =>
  $api.queryOptions("get", "/v1/budgets/{budgetId}/reports/transactions", {
    params: {
      path: { budgetId: r.budgetId },
      query: {
        ...activityQuery(r),
        ...(r.order && { order: r.order }),
        ...(r.limit && { limit: r.limit }),
      },
    },
  });

/** The months a comparison reads, or undefined when comparison is off. */
export function comparisonFor(range: MonthRange, compare: ReportComparison | undefined) {
  return compare ? comparisonRange(range, compare) : undefined;
}

export const PRESET_LABELS: Record<ReportPreset, string> = {
  this_month: "This Month",
  last_3_months: "Last 3 Months",
  last_6_months: "Last 6 Months",
  last_12_months: "Last 12 Months",
  year_to_date: "Year To Date",
  last_year: "Last Year",
  all_dates: "All Dates",
};

export const COMPARISON_LABELS: Record<ReportComparison, string> = {
  previous_period: "Previous period",
  last_year: "Same period last year",
  average_3: "Average of the previous 3 months",
  average_6: "Average of the previous 6 months",
  average_12: "Average of the previous 12 months",
};

/**
 * An amount as a plain number, only to place chart marks (bar heights, slice angles, pixel
 * positions). Never format or add these: labels, ticks and tooltips use the exact amount.
 */
export function chartNumber(minorUnits: string | bigint, currency: CurrencyCode): number {
  return Number(minorUnits) / 10 ** currencyExponent(currency);
}

/**
 * The report palette: Okabe–Ito's colour-blind-safe hues (CSS variables defined for both themes in
 * packages/ui's globals.css), handed out by a category's or group's place in the budget so it keeps
 * its colour in every report.
 */
export const REPORT_COLOR_COUNT = 8;
export const reportColor = (index: number) =>
  `var(--report-${(((index % REPORT_COLOR_COUNT) + REPORT_COLOR_COUNT) % REPORT_COLOR_COUNT) + 1})`;

/**
 * An axis tick's label: the tick (a chart position) rounded to the minor unit and formatted,
 * without decimals when it's a whole unit ("$1,000", but "$0.50" on a narrow axis).
 */
export function chartTick(
  units: number,
  currency: CurrencyCode,
  format: (minorUnits: bigint) => string,
  decimalMark: string,
) {
  const factor = 10n ** BigInt(currencyExponent(currency));
  const minor = BigInt(Math.round(units * Number(factor)));
  const text = format(minor);
  return minor % factor === 0n ? text.replace(new RegExp(`\\${decimalMark}\\d+`), "") : text;
}

/**
 * Each category's and group's colour, the same in every report: Uncategorized grey, then the
 * plan's groups and categories in plan order through the seven hues (grey is kept for
 * Uncategorized and "Other").
 */
export function planColors(list: {
  uncategorizedCategoryId: string;
  groups: readonly { id: string; categories: readonly { id: string }[] }[];
}) {
  const hue = (i: number) => reportColor(i % (REPORT_COLOR_COUNT - 1));
  const categories = new Map<string, string>([[list.uncategorizedCategoryId, UNCATEGORIZED_COLOR]]);
  const groups = new Map<string, string>();
  let index = 0;
  list.groups.forEach((g, groupIndex) => {
    groups.set(g.id, hue(groupIndex));
    for (const c of g.categories) categories.set(c.id, hue(index++));
  });
  return { categories, groups };
}

/** Uncategorized and "Other": the palette's grey. */
export const UNCATEGORIZED_COLOR = reportColor(REPORT_COLOR_COUNT - 1);

export interface ExportFile {
  name: string;
  text: string;
}

/** Saves a report's export: one file as itself, several in one zip. */
export function downloadExport(files: readonly ExportFile[], zipName: string) {
  const [only] = files;
  const blob =
    files.length === 1 && only
      ? new Blob([only.text], { type: "text/csv;charset=utf-8" })
      : new Blob([zipSync(Object.fromEntries(files.map((f) => [f.name, strToU8(f.text)])))], {
          type: "application/zip",
        });
  saveBlob(blob, files.length === 1 && only ? only.name : zipName);
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * "Oct 2026" (`short`, the range picker), "October 2026" (`long`, table rows) or "10/26" (`axis`,
 * chart ticks).
 */
export function monthLabel(month: BudgetMonth, style: "short" | "long" | "axis" = "short") {
  if (style === "short") return shortMonthLabel(month);
  if (style === "long") return `${monthName(month)} ${month.slice(0, 4)}`;
  return `${month.slice(5, 7)}/${month.slice(2, 4)}`;
}

/** "Aug 2026 – Oct 2026", or "Oct 2026" for one month. */
export const rangeLabel = (range: MonthRange) =>
  range.from === range.to
    ? monthLabel(range.from)
    : `${monthLabel(range.from)} – ${monthLabel(range.to)}`;
