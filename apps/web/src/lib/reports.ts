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
import { monthName, monthLabel as shortMonthLabel, shortMonthName } from "./months";

export type ReportSum = components["schemas"]["ReportSum"];
export type ReportTransaction = components["schemas"]["ReportTransaction"];
export type ReportKind = "spending" | "income";
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
 * The report palette: seven colour-blind-safe hues (`--report-1` to `--report-7`, defined for both
 * themes in packages/ui's theme.css), each with five tints strongest first
 * (`--report-<hue>-<1..5>`, all at least 3:1 against the background), and a grey (`--report-8`).
 */
export const REPORT_HUES = 7;
export const REPORT_TINTS = 5;
const wrap = (hue: number) => ((hue % REPORT_HUES) + REPORT_HUES) % REPORT_HUES;
/** A hue's mid tone, for charts whose series mean one thing each (income, debts…). */
export const reportColor = (hue: number) => `var(--report-${wrap(hue) + 1})`;
/** A hue's tint, 0 the strongest. */
export const reportTint = (hue: number, tint: number) =>
  `var(--report-${wrap(hue) + 1}-${Math.min(Math.max(tint, 0), REPORT_TINTS - 1) + 1})`;

/** Uncategorized, "No payee" and the like: the palette's grey. */
export const UNCATEGORIZED_COLOR = "var(--report-8)";
/** "Other" (the series a chart folds together): a lighter neutral, apart from Uncategorized. */
export const OTHER_COLOR = "var(--report-other)";

/** Text on a report colour (theme.css picks light or dark ink per theme for each band). */
export function reportInk(color: string) {
  const tint = /^var\(--report-\d-(\d)\)$/.exec(color)?.[1];
  if (tint) return Number(tint) <= 3 ? "var(--report-ink-strong)" : "var(--report-ink-soft)";
  if (color === UNCATEGORIZED_COLOR) return "var(--report-ink-strong)";
  return "var(--report-ink-soft)";
}

export interface ColorRequest {
  key: string;
  /**
   * The family the series belongs to (a category's group): a family shares one hue, its series
   * taking that hue's tints. Without one the series is a family of its own.
   */
  family?: string;
  /** The hue the family keeps wherever it can (its group's place in the plan). */
  hue?: number;
  /** A colour of its own (Uncategorized's grey, a flag's colour), never handed to another series. */
  color?: string;
}

/**
 * One chart's colours, none repeated. `series` come biggest first. Each family takes its hue
 * unless a bigger family has it, else the first hue still free, and its series take the hue's
 * tints in turn, so the biggest is the strongest. Past a family's tints, past the free hues or
 * past `max` named series, the rest get OTHER_COLOR and the chart folds them into "Other".
 */
export function distinctColors(
  series: readonly ColorRequest[],
  max = Number.POSITIVE_INFINITY,
): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<number>();
  // A hue whose colour is some series' own (a flag that is also a palette hue) is never handed out.
  for (const s of series) {
    const own = s.color && /^var\(--report-(\d)(?:-\d)?\)$/.exec(s.color)?.[1];
    if (own && Number(own) <= REPORT_HUES) taken.add(Number(own) - 1);
  }
  const families = new Map<string, { hue: number; used: number }>();
  let named = 0;
  for (const s of series) {
    if (s.color) {
      out.set(s.key, s.color);
      continue;
    }
    const id = s.family ?? s.key;
    let family = families.get(id);
    if (!family) {
      let hue = s.hue !== undefined && !taken.has(wrap(s.hue)) ? wrap(s.hue) : -1;
      for (let h = 0; hue < 0 && h < REPORT_HUES; h++) if (!taken.has(h)) hue = h;
      if (hue >= 0) {
        taken.add(hue);
        family = { hue, used: 0 };
        families.set(id, family);
      }
    }
    if (!family || family.used >= REPORT_TINTS || named >= max) {
      out.set(s.key, OTHER_COLOR);
      continue;
    }
    out.set(s.key, reportTint(family.hue, family.used++));
    named++;
  }
  return out;
}

/** One ramp for a chart of one dimension (payees, accounts): its biggest series strongest. */
export const RAMP_FAMILY = "ramp";

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
 * The order groups take the hues in: blue, purple, cyan, amber and pink first; green and
 * vermillion last, since they also mean income and spending (and good and bad) elsewhere.
 */
const GROUP_HUES = [0, 4, 6, 1, 5, 2, 3];

/**
 * Each group's hue (its place in the plan) and each category's group, so a group keeps one hue
 * across reports and its categories take that hue's tints (distinctColors). Uncategorized has
 * none: it's always grey.
 */
export function planHues(list: {
  groups: readonly { id: string; categories: readonly { id: string }[] }[];
}) {
  const groups = new Map<string, number>();
  const categories = new Map<string, { hue: number; family: string }>();
  list.groups.forEach((g, index) => {
    const hue = GROUP_HUES[index % REPORT_HUES] ?? 0;
    groups.set(g.id, hue);
    for (const c of g.categories) categories.set(c.id, { hue, family: g.id });
  });
  return { categories, groups };
}

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
 * "Oct 2026" (`short`, the range picker), "October 2026" (`long`, table rows) or "Oct" (`axis`,
 * chart ticks), where January carries its year ("Jan ’27") so a range across years reads.
 */
export function monthLabel(month: BudgetMonth, style: "short" | "long" | "axis" = "short") {
  if (style === "short") return shortMonthLabel(month);
  if (style === "long") return `${monthName(month)} ${month.slice(0, 4)}`;
  const name = shortMonthName(month);
  return month.endsWith("-01") ? `${name} ’${month.slice(2, 4)}` : name;
}

/** "Aug 2026 – Oct 2026", or "Oct 2026" for one month. */
export const rangeLabel = (range: MonthRange) =>
  range.from === range.to
    ? monthLabel(range.from)
    : `${monthLabel(range.from)} – ${monthLabel(range.to)}`;
