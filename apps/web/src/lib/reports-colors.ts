import { addMonths } from "@strictbudget/engine";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useBudget } from "./budget-context";
import { type CategoryList, categoriesQueryOptions } from "./categories";
import { currentMonth, REPORT_COLORS, type ReportSum, reportActivityOptions } from "./reports";

/** Each category's and group's place in the report palette (distinctColors' `slot`). */
export interface ColorSlots {
  categories: ReadonlyMap<string, number>;
  groups: ReadonlyMap<string, number>;
}

/**
 * Palette places that hold across every report. The eight categories (and groups) that spent the
 * most over the past year take the eight colours, in plan order, so the ones a chart names are
 * apart and never move; the rest take their place in the plan, after them, and give way on a clash.
 * Without spending, everything goes by plan order.
 */
export function colorSlots(list: CategoryList, sums: readonly ReportSum[]): ColorSlots {
  const spent = new Map<string, bigint>();
  for (const s of sums) {
    if (s.categoryId) spent.set(s.categoryId, (spent.get(s.categoryId) ?? 0n) - BigInt(s.net));
  }
  const groupSpent = new Map<string, bigint>();
  const categories = list.groups.flatMap((g) =>
    g.categories.map((c) => {
      groupSpent.set(g.id, (groupSpent.get(g.id) ?? 0n) + (spent.get(c.id) ?? 0n));
      return c.id;
    }),
  );
  return {
    categories: slotsOf(categories, spent),
    groups: slotsOf(
      list.groups.map((g) => g.id),
      groupSpent,
    ),
  };
}

function slotsOf(plan: readonly string[], spent: ReadonlyMap<string, bigint>) {
  const top = new Set(
    plan
      .map((id, index) => ({ id, index, spent: spent.get(id) ?? 0n }))
      .filter((r) => r.spent > 0n)
      .sort((a, b) => (a.spent === b.spent ? a.index - b.index : a.spent > b.spent ? -1 : 1))
      .slice(0, REPORT_COLORS)
      .map((r) => r.id),
  );
  const slots = new Map<string, number>();
  let next = 0;
  plan.forEach((id, index) => {
    slots.set(id, top.has(id) ? next++ : REPORT_COLORS + index);
  });
  return slots;
}

/** The budget's ColorSlots, from the past year's spending; undefined while loading. */
export function useColorSlots(): ColorSlots | undefined {
  const { budget } = useBudget();
  const current = currentMonth();
  const categories = useQuery(categoriesQueryOptions(budget.id));
  const year = useQuery({
    ...reportActivityOptions({
      budgetId: budget.id,
      range: { from: addMonths(current, -11), to: current },
      kind: "spending",
      groupBy: ["category"],
    }),
    staleTime: 5 * 60 * 1000,
  });
  return useMemo(
    () => (categories.data && year.data ? colorSlots(categories.data, year.data.rows) : undefined),
    [categories.data, year.data],
  );
}
