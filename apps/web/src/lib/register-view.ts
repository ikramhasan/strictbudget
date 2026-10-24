import { useCallback, useState } from "react";
import { todayIso } from "./dates";
import { DEFAULT_SORT, readSort, type SortField } from "./register-sort";

/**
 * A register's View menu: a date range and what to show, per account (and for All Accounts),
 * remembered in this browser.
 */
export interface RegisterView {
  range: DateRange;
  /** A custom range's first and last month, YYYY-MM. */
  from?: string;
  to?: string;
  showReconciled: boolean;
  /** Account registers only; All Accounts has no running balance. */
  showRunningBalance: boolean;
  showFlags: boolean;
  /** The attachment column ("Show Images"), on by default. */
  showAttachments: boolean;
  /** Who entered each transaction (off by default). */
  showEnteredBy: boolean;
  /** The Scheduled Transactions section folded away. */
  scheduledCollapsed: boolean;
  /** The stacked sort, first field first. */
  sort: SortField[];
}

export const DATE_RANGES = [
  "this_month",
  "last_month",
  "latest_3_months",
  "this_year",
  "last_year",
  "all",
] as const;
export type DateRange = (typeof DATE_RANGES)[number] | "custom";

export const DATE_RANGE_LABELS: Record<(typeof DATE_RANGES)[number], string> = {
  this_month: "This Month",
  last_month: "Last Month",
  latest_3_months: "Latest 3 Months",
  this_year: "This Year",
  last_year: "Last Year",
  all: "All Dates",
};

/** Defaults: all dates, reconciled transactions and the running balance hidden. */
export const DEFAULT_VIEW: RegisterView = {
  range: "all",
  showReconciled: false,
  showRunningBalance: false,
  showFlags: true,
  showAttachments: true,
  showEnteredBy: false,
  scheduledCollapsed: false,
  sort: [...DEFAULT_SORT],
};

/** "2026-10" → the first day, and the last day, of that month. */
function monthStart(month: string) {
  return `${month}-01`;
}
function monthEnd(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

export function addMonths(month: string, offset: number) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + offset;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** The first and last month a view's range covers (YYYY-MM); none for all dates. */
export function rangeMonths(
  view: Pick<RegisterView, "range" | "from" | "to">,
  today = todayIso(),
): { from?: string; to?: string } {
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  switch (view.range) {
    case "all":
      return {};
    case "this_month":
      return { from: month, to: month };
    case "last_month":
      return { from: addMonths(month, -1), to: addMonths(month, -1) };
    case "latest_3_months":
      return { from: addMonths(month, -2), to: month };
    case "this_year":
      return { from: `${year}-01`, to: `${year}-12` };
    case "last_year":
      return { from: `${Number(year) - 1}-01`, to: `${Number(year) - 1}-12` };
    case "custom":
      return { from: view.from, to: view.to };
  }
}

/** The view's date range as the API's `from`/`to` dates (YYYY-MM-DD). */
export function rangeDates(view: RegisterView, today = todayIso()) {
  const { from, to } = rangeMonths(view, today);
  return {
    ...(from ? { from: monthStart(from) } : {}),
    ...(to ? { to: monthEnd(to) } : {}),
  };
}

const STORAGE_PREFIX = "strictbudget:register-view:";

function read(key: string): RegisterView {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return DEFAULT_VIEW;
    const value = JSON.parse(raw) as Partial<RegisterView>;
    return { ...DEFAULT_VIEW, ...value, sort: readSort(value.sort) };
  } catch {
    return DEFAULT_VIEW;
  }
}

/** One register's view options (`key`: the account id, or "all"), remembered in the browser. */
export function useRegisterView(budgetId: string, key: string) {
  const storageKey = `${budgetId}:${key}`;
  const [state, setState] = useState(() => ({ key: storageKey, view: read(storageKey) }));
  // Another register (the route reuses this component): load its own view.
  const current = state.key === storageKey ? state.view : read(storageKey);
  if (state.key !== storageKey) setState({ key: storageKey, view: current });
  const setView = useCallback((patch: Partial<RegisterView>) => {
    setState((s) => {
      const view = { ...s.view, ...patch };
      try {
        localStorage.setItem(STORAGE_PREFIX + s.key, JSON.stringify(view));
      } catch {
        // Private windows and blocked storage: the view still applies until the page closes.
      }
      return { ...s, view };
    });
  }, []);
  return [current, setView] as const;
}

/**
 * Each register's search is remembered in the browser (per budget and account, All Accounts
 * included) and shown again on coming back, even after a reload.
 */
const SEARCH_PREFIX = "strictbudget:register-search:";

export function savedSearch(budgetId: string, key: string): string | undefined {
  try {
    return localStorage.getItem(`${SEARCH_PREFIX}${budgetId}:${key}`) || undefined;
  } catch {
    return undefined;
  }
}

export function saveSearch(budgetId: string, key: string, q: string | undefined) {
  try {
    if (q) localStorage.setItem(`${SEARCH_PREFIX}${budgetId}:${key}`, q);
    else localStorage.removeItem(`${SEARCH_PREFIX}${budgetId}:${key}`);
  } catch {
    // Blocked storage: the search just isn't remembered.
  }
}
