import type { components } from "@strictbudget/api-client";
import {
  type BudgetMonth,
  type CurrencyCode,
  type Money,
  money,
  monthOf,
} from "@strictbudget/engine";
import type { QueryClient } from "@tanstack/react-query";
import { format, parse } from "date-fns";
import { useCallback, useState } from "react";
import { $api } from "./api";
import type { CategoryList } from "./categories";
import { todayIso } from "./dates";

export type BudgetMonthData = components["schemas"]["BudgetMonth"];
export type MonthTotals = components["schemas"]["MonthTotals"];

/** Activity leaves out transactions dated after the user's today. */
export const monthQueryOptions = (budgetId: string, month: BudgetMonth, today = todayIso()) =>
  $api.queryOptions("get", "/v1/budgets/{budgetId}/months/{month}", {
    params: { path: { budgetId, month }, query: { today } },
  });

/**
 * Refetches every month, and spending pace, credit card health and category history (built from
 * the same figures): call after anything that changes assigned amounts or activity.
 */
export function invalidateMonths(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["get", "/v1/budgets/{budgetId}/months/{month}"] }),
    queryClient.invalidateQueries({
      queryKey: ["get", "/v1/budgets/{budgetId}/reports/spending-pace"],
    }),
    queryClient.invalidateQueries({
      queryKey: ["get", "/v1/budgets/{budgetId}/reports/credit-card-health"],
    }),
    queryClient.invalidateQueries({
      queryKey: ["get", "/v1/budgets/{budgetId}/reports/category-history"],
    }),
  ]);
}

export const currentMonth = (now = new Date()) => monthOf(todayIso(now));

/**
 * The month last shown on each budget's screen: reopened on coming back to Plan, but a reload (or
 * another device) starts on the current month again, so it lives in memory only.
 */
const lastViewed = new Map<string, BudgetMonth>();

export function rememberMonth(budgetId: string, month: BudgetMonth) {
  lastViewed.set(budgetId, month);
}

/** The month to reopen the budget screen on; undefined means the current month. */
export function lastViewedMonth(budgetId: string): BudgetMonth | undefined {
  const month = lastViewed.get(budgetId);
  return month === currentMonth() ? undefined : month;
}

export function monthLabel(month: BudgetMonth) {
  return format(parse(month, "yyyy-MM", new Date()), "MMM yyyy");
}

export function monthName(month: BudgetMonth) {
  return format(parse(month, "yyyy-MM", new Date()), "MMMM");
}

export function shortMonthName(month: BudgetMonth) {
  return format(parse(month, "yyyy-MM", new Date()), "MMM");
}

export const toMoney = (amount: string, currency: CurrencyCode): Money =>
  money(BigInt(amount), currency);

function readCollapsed(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Collapsed category groups, kept across reloads and months in this browser. */
export function useCollapsedGroups(budgetId: string) {
  const key = `strictbudget:collapsed-groups:${budgetId}`;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(readCollapsed(key)),
  );
  const update = useCallback(
    (next: ReadonlySet<string>) => {
      setCollapsed(next);
      try {
        localStorage.setItem(key, JSON.stringify([...next]));
      } catch {
        // Storage can be unavailable (private windows); the state still works for this visit.
      }
    },
    [key],
  );
  return { collapsed, setCollapsed: update };
}

export interface MoneyOption {
  id: string;
  name: string;
  group: string;
  /** What's available in it this month (Ready to Assign's own amount for Ready to Assign). */
  available: string;
  /**
   * Set on a savings category: its safety fund or save-up goal this month (the balance to keep or
   * the goal, and what counts toward it), for saying what taking money out does.
   */
  savings?: {
    goal: { kind: "safety_fund" | "save_up"; needed: bigint; funded: bigint } | null;
  };
}

/**
 * Where money can move to or from: Ready to Assign first, then the visible categories by group,
 * each with what's available this month.
 */
export function moneyOptions(list: CategoryList, month: BudgetMonthData): MoneyOption[] {
  const available = new Map(month.categories.map((c) => [c.categoryId, c.available]));
  const needs = new Map(month.categories.map((c) => [c.categoryId, c.target]));
  const savingsOf = (c: CategoryList["groups"][number]["categories"][number]) => {
    const goal = c.target?.goal;
    const need = needs.get(c.id);
    return {
      goal:
        need && (goal === "safety_fund" || goal === "save_up")
          ? { kind: goal, needed: BigInt(need.needed), funded: BigInt(need.funded) }
          : null,
    };
  };
  return [
    {
      id: list.readyToAssignCategoryId,
      name: "Ready to Assign",
      group: "Inflow",
      available: month.readyToAssign,
    },
    ...list.groups
      .filter((g) => !g.hidden)
      .flatMap((g) =>
        g.categories
          .filter((c) => !c.hidden)
          .map((c) => ({
            id: c.id,
            name: c.name,
            group: g.name,
            available: available.get(c.id) ?? "0",
            ...(c.savings && { savings: savingsOf(c) }),
          })),
      ),
  ];
}

export const minAmount = (a: bigint, b: bigint) => (a < b ? a : b);
