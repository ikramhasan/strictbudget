import {
  type BudgetFormatSettings,
  type BudgetMonth,
  type CurrencyCode,
  currencyExponent,
  type DelimitedCell,
  formatAmount,
  type MonthRange,
  monthsIn,
  plainAmount,
  type TrendCell,
  type TrendMonth,
  topSpenders,
} from "@strictbudget/engine";
import { z } from "zod";
import type { CategoryList } from "./categories";
import { COLOR_LABEL } from "./flags";
import {
  monthLabel,
  planColors,
  type ReportSum,
  type ReportTransaction,
  reportSearchSchema,
  UNCATEGORIZED_COLOR,
} from "./reports";

/**
 * How Spending Trends draws its months: stacked bars, lines per category (top N + Other), 100%
 * share, small multiples and a calendar of daily spending.
 */
export const TREND_MODES = ["bars", "lines", "share", "multiples", "calendar"] as const;
export type TrendMode = (typeof TREND_MODES)[number];

export const TREND_MODE_LABELS: Record<TrendMode, string> = {
  bars: "Stacked bars",
  lines: "Lines",
  share: "100% share",
  multiples: "Small multiples",
  calendar: "Calendar",
};

/** What the series are: categories or category groups. */
export type TrendLevel = "category" | "group";

export const trendsSearchSchema = reportSearchSchema.extend({
  mode: z.enum(TREND_MODES).optional().catch(undefined),
  by: z.enum(["category", "group"]).optional().catch(undefined),
  /** The category group drilled into (its categories become the series). */
  group: z.string().optional().catch(undefined),
});
export type TrendsSearch = z.infer<typeof trendsSearchSchema>;

/** The key of the lines-and-share modes' "Other" series. */
export const OTHER_KEY = "other";
/** Series shown by name in the lines and share modes; the rest are "Other". */
export const TOP_SERIES = 5;

export interface SeriesInfo {
  key: string;
  label: string;
  color: string;
  /** Place in the plan (stack order). */
  order: number;
  /** The category's group (a group's own id); null for Uncategorized and Other. */
  groupId: string | null;
  groupName: string;
}

/** Categories and groups by id, with their names, places in the plan and colours. */
export interface Catalog {
  uncategorizedId: string;
  categories: Map<string, SeriesInfo>;
  groups: Map<string, SeriesInfo>;
}

const UNCATEGORIZED_LABEL = "Uncategorized";

export function catalogOf(list: CategoryList): Catalog {
  const colors = planColors(list);
  const categories = new Map<string, SeriesInfo>();
  const groups = new Map<string, SeriesInfo>();
  // Uncategorized first, as the category filter lists it.
  categories.set(list.uncategorizedCategoryId, {
    key: list.uncategorizedCategoryId,
    label: UNCATEGORIZED_LABEL,
    color: UNCATEGORIZED_COLOR,
    order: -1,
    groupId: null,
    groupName: "",
  });
  let index = 0;
  list.groups.forEach((g, groupIndex) => {
    groups.set(g.id, {
      key: g.id,
      label: g.name,
      color: colors.groups.get(g.id) ?? UNCATEGORIZED_COLOR,
      order: groupIndex,
      groupId: g.id,
      groupName: g.name,
    });
    for (const c of g.categories) {
      categories.set(c.id, {
        key: c.id,
        label: c.name,
        color: colors.categories.get(c.id) ?? UNCATEGORIZED_COLOR,
        order: index,
        groupId: g.id,
        groupName: g.name,
      });
      index++;
    }
  });
  return { uncategorizedId: list.uncategorizedCategoryId, categories, groups };
}

const OTHER_INFO: SeriesInfo = {
  key: OTHER_KEY,
  label: "Other",
  color: "var(--muted-foreground)",
  order: Number.MAX_SAFE_INTEGER,
  groupId: null,
  groupName: "",
};

/** A series' name, colour and place; unknown ids (a category deleted since) still get a row. */
export function seriesInfo(catalog: Catalog, level: TrendLevel, key: string): SeriesInfo {
  if (key === OTHER_KEY) return OTHER_INFO;
  const category = catalog.categories.get(key);
  if (level === "category" || key === catalog.uncategorizedId) {
    return (
      category ?? {
        key,
        label: "Unknown category",
        color: "var(--report-8)",
        order: Number.MAX_SAFE_INTEGER - 1,
        groupId: null,
        groupName: "",
      }
    );
  }
  return (
    catalog.groups.get(key) ?? {
      key,
      label: "Unknown group",
      color: "var(--report-8)",
      order: Number.MAX_SAFE_INTEGER - 1,
      groupId: key,
      groupName: "",
    }
  );
}

/**
 * The series key a category's spending falls under: the category, or (by group) its group;
 * Uncategorized stays its own series either way.
 */
export function keyOf(catalog: Catalog, level: TrendLevel, categoryId: string | null | undefined) {
  const id = categoryId ?? catalog.uncategorizedId;
  if (level === "category" || id === catalog.uncategorizedId) return id;
  return catalog.categories.get(id)?.groupId ?? id;
}

/** Report rows grouped by month and category, as trend cells for `level`. */
export function cellsOf(
  rows: readonly ReportSum[],
  catalog: Catalog,
  level: TrendLevel,
): TrendCell<string>[] {
  return rows.flatMap((r) =>
    r.month
      ? [
          {
            month: r.month as BudgetMonth,
            key: keyOf(catalog, level, r.categoryId),
            net: BigInt(r.net),
          },
        ]
      : [],
  );
}

/** Every series key with lines in `months`, in plan order. */
export function seriesKeys(
  months: readonly TrendMonth<string>[],
  catalog: Catalog,
  level: TrendLevel,
): string[] {
  const keys = new Set<string>();
  for (const m of months) for (const key of m.nets.keys()) keys.add(key);
  return [...keys].sort(
    (a, b) => seriesInfo(catalog, level, a).order - seriesInfo(catalog, level, b).order,
  );
}

/**
 * The months with the top `n` spenders kept and everything else summed into "Other" (the lines
 * and share modes), so a plan with dozens of categories still reads.
 */
export function withOther(
  months: readonly TrendMonth<string>[],
  n: number,
): { keys: string[]; months: TrendMonth<string>[] } {
  const top = topSpenders(months, n);
  const keep = new Set(top);
  let other = false;
  const folded = months.map((m) => {
    const nets = new Map<string, bigint>();
    for (const [key, net] of m.nets) {
      const k = keep.has(key) ? key : OTHER_KEY;
      if (k === OTHER_KEY) other = true;
      nets.set(k, (nets.get(k) ?? 0n) + net);
    }
    return { ...m, nets };
  });
  return { keys: other ? [...top, OTHER_KEY] : top, months: folded };
}

/** The bar chart's months: only months with transactions. */
export const chartedMonths = (months: readonly TrendMonth<string>[]) =>
  months.filter((m) => m.nets.size > 0);

export const exportBaseName = (today: string) => `strictbudget-reflect-spending-trends-${today}`;

/**
 * The summary export: one row per category with lines in the range, in budget order, Uncategorized
 * as ("", "Uncategorized"); a column per month (each net, signed), the average month and the total.
 * No total row.
 */
export function summaryExportRows({
  rows,
  catalog,
  range,
  average,
  currency,
  numberFormat,
}: {
  rows: readonly ReportSum[];
  catalog: Catalog;
  range: MonthRange;
  average: (total: bigint, months: number) => bigint;
  currency: CurrencyCode;
  numberFormat: BudgetFormatSettings["numberFormat"];
}): DelimitedCell[][] {
  const months = monthsIn(range);
  const nets = new Map<string, Map<string, bigint>>();
  for (const r of rows) {
    if (!r.month) continue;
    const key = r.categoryId ?? catalog.uncategorizedId;
    const byMonth = nets.get(key) ?? new Map<string, bigint>();
    byMonth.set(r.month, (byMonth.get(r.month) ?? 0n) + BigInt(r.net));
    nets.set(key, byMonth);
  }
  const exponent = currencyExponent(currency);
  const amount = (v: bigint) => ({ raw: plainAmount(v, exponent, numberFormat) });
  const keys = [...nets.keys()].sort(
    (a, b) => seriesInfo(catalog, "category", a).order - seriesInfo(catalog, "category", b).order,
  );
  return [
    ["Category Group", "Category", ...months.map((m) => monthLabel(m)), "Average", "Total"],
    ...keys.map((key) => {
      const info = seriesInfo(catalog, "category", key);
      const byMonth = nets.get(key) ?? new Map<string, bigint>();
      const values = months.map((m) => byMonth.get(m) ?? 0n);
      const total = values.reduce((s, v) => s + v, 0n);
      return [
        info.groupName,
        info.label,
        ...values.map(amount),
        amount(average(total, months.length)),
        amount(total),
      ];
    }),
  ];
}

const CLEARED_LABELS: Record<ReportTransaction["cleared"], string> = {
  uncleared: "Uncleared",
  cleared: "Cleared",
  reconciled: "Reconciled",
};

/** An export amount: the budget's symbol and decimal mark, no digit grouping ("$1234.56"), unsigned. */
export function exportMoney(
  amount: bigint,
  currency: CurrencyCode,
  settings: BudgetFormatSettings,
) {
  const abs = amount < 0n ? -amount : amount;
  const money = { amount: abs, currency };
  const grouped = formatAmount(money, { ...settings, currencySymbolPosition: "none" });
  const plain = plainAmount(abs, currencyExponent(currency), settings.numberFormat);
  return formatAmount(money, settings).replace(grouped, plain);
}

/**
 * The transactions export: newest first; Uncategorized lines have the three category columns empty;
 * amounts as Outflow/Inflow with the currency symbol, unquoted.
 */
export function transactionExportRows({
  transactions,
  uncategorizedId,
  currency,
  settings,
  formatDate,
}: {
  transactions: readonly ReportTransaction[];
  uncategorizedId: string;
  currency: CurrencyCode;
  settings: BudgetFormatSettings;
  formatDate: (iso: string) => string;
}): DelimitedCell[][] {
  return [
    [
      "Account",
      "Flag",
      "Date",
      "Payee",
      "Category Group/Category",
      "Category Group",
      "Category",
      "Memo",
      "Outflow",
      "Inflow",
      "Cleared",
    ],
    ...transactions.map((t) => {
      const amount = BigInt(t.amount);
      const categorized = t.categoryId !== null && t.categoryId !== uncategorizedId;
      const group = categorized ? (t.groupName ?? "") : "";
      const name = categorized ? (t.categoryName ?? "") : "";
      return [
        t.accountName,
        t.flag ? COLOR_LABEL[t.flag] : "",
        formatDate(t.date),
        t.payeeName ?? "",
        categorized ? `${group}: ${name}` : "",
        group,
        name,
        t.memo,
        { raw: exportMoney(amount < 0n ? amount : 0n, currency, settings) },
        { raw: exportMoney(amount > 0n ? amount : 0n, currency, settings) },
        CLEARED_LABELS[t.cleared],
      ];
    }),
  ];
}

export interface CalendarDay {
  date: string;
  /** Spending that day, positive (net of refunds; negative when refunds beat it). */
  total: bigint;
  count: number;
  /** Past the user's today (nothing can count yet). */
  future: boolean;
}

/** A week column of the calendar: seven slots from the week's first day, null outside the range. */
export type CalendarWeek = (CalendarDay | null)[];

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/**
 * The calendar heatmap's grid: weeks (columns) × weekdays (rows), Sunday first, covering every
 * day of `range`; `months` marks the week each month starts in (for its label).
 */
export function calendarWeeks(
  range: MonthRange,
  days: ReadonlyMap<string, { total: bigint; count: number }>,
  today: string,
  weekStartsOn = 0,
): { weeks: CalendarWeek[]; months: { month: BudgetMonth; week: number }[] } {
  const [fy = 0, fm = 1] = range.from.split("-").map(Number);
  const [ty = 0, tm = 1] = range.to.split("-").map(Number);
  const start = new Date(Date.UTC(fy, fm - 1, 1));
  const end = new Date(Date.UTC(ty, tm, 0));
  const weeks: CalendarWeek[] = [];
  const months: { month: BudgetMonth; week: number }[] = [];
  let week: CalendarWeek = Array(7).fill(null);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const slot = (d.getUTCDay() - weekStartsOn + 7) % 7;
    if (slot === 0 && d > start) {
      weeks.push(week);
      week = Array(7).fill(null);
    }
    const date = isoOf(d);
    if (date.endsWith("-01")) months.push({ month: date.slice(0, 7), week: weeks.length });
    const day = days.get(date);
    week[slot] = { date, total: day?.total ?? 0n, count: day?.count ?? 0, future: date > today };
  }
  weeks.push(week);
  return { weeks, months };
}

/**
 * A day's shade, 0 (nothing spent) to 4 (the most): quartiles of the range's spending days, so
 * one big bill doesn't wash the rest out.
 */
export function calendarLevels(days: readonly CalendarDay[]): (day: CalendarDay) => number {
  const spent = days
    .map((d) => d.total)
    .filter((t) => t > 0n)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const at = (q: number) => spent[Math.min(spent.length - 1, Math.floor(q * spent.length))] ?? 0n;
  const cuts = [at(0.25), at(0.5), at(0.75)];
  return (day) => {
    if (day.total <= 0n) return 0;
    return 1 + cuts.filter((c) => day.total > c).length;
  };
}
