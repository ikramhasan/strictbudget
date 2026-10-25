import type { components } from "@strictbudget/api-client";
import { $api } from "./api";

export type Category = components["schemas"]["Category"];
export type CategoryGroup = components["schemas"]["CategoryGroup"];
export type CategoryList = components["schemas"]["CategoryList"];

export const categoriesQueryOptions = (budgetId: string) =>
  $api.queryOptions("get", "/v1/budgets/{budgetId}/categories", {
    params: { path: { budgetId } },
  });

/** What the budget screen shows: visible groups with their visible categories. */
export interface VisibleLayout {
  groupOrder: string[];
  /** groupId → visible category ids, in order. */
  items: Record<string, string[]>;
}

export function visibleLayout(list: CategoryList): VisibleLayout {
  const groups = list.groups.filter((g) => !g.hidden);
  return {
    groupOrder: groups.map((g) => g.id),
    items: Object.fromEntries(
      groups.map((g) => [g.id, g.categories.filter((c) => !c.hidden).map((c) => c.id)]),
    ),
  };
}

/** The "Hidden Categories" section: hidden groups, plus hidden categories of visible groups. */
export function hiddenItems(list: CategoryList) {
  return {
    groups: list.groups.filter((g) => g.hidden),
    categories: list.groups
      .filter((g) => !g.hidden)
      .flatMap((g) =>
        g.categories.filter((c) => c.hidden).map((c) => ({ ...c, groupName: g.name })),
      ),
  };
}

/** The id that follows `id` in `ids` (the API's "move before" target), or null at the end. */
export function nextId(ids: readonly string[], id: string): string | null {
  const at = ids.indexOf(id);
  return at === -1 ? null : (ids[at + 1] ?? null);
}

export function locateCategory(layout: VisibleLayout["items"], categoryId: string) {
  for (const [groupId, ids] of Object.entries(layout)) {
    if (ids.includes(categoryId)) return { groupId, beforeCategoryId: nextId(ids, categoryId) };
  }
  return null;
}
