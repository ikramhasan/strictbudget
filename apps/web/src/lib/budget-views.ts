import type { components } from "@strictbudget/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { $api } from "./api";

export type CustomView = components["schemas"]["BudgetView"];
export type ViewList = components["schemas"]["BudgetViewList"];

export const MAX_CUSTOM_VIEWS = 12;

export const viewsQueryOptions = (budgetId: string) =>
  $api.queryOptions("get", "/v1/budgets/{budgetId}/views", { params: { path: { budgetId } } });

export function useViewActions(budgetId: string) {
  const queryClient = useQueryClient();
  const key = viewsQueryOptions(budgetId).queryKey;
  const create = $api.useMutation("post", "/v1/budgets/{budgetId}/views");
  const update = $api.useMutation("patch", "/v1/budgets/{budgetId}/views/{viewId}");
  const remove = $api.useMutation("delete", "/v1/budgets/{budgetId}/views/{viewId}");
  const reorder = $api.useMutation("put", "/v1/budgets/{budgetId}/views/order");
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  return {
    create: async (body: { name: string; categoryIds: string[] }) => {
      try {
        return await create.mutateAsync({ params: { path: { budgetId } }, body });
      } finally {
        await refresh();
      }
    },
    update: async (viewId: string, body: { name?: string; categoryIds?: string[] }) => {
      try {
        return await update.mutateAsync({ params: { path: { budgetId, viewId } }, body });
      } finally {
        await refresh();
      }
    },
    remove: async (viewId: string) => {
      try {
        await remove.mutateAsync({ params: { path: { budgetId, viewId } } });
      } finally {
        await refresh();
      }
    },
    reorder: async (order: string[]) => {
      // Show the new order at once; the server's answer replaces it.
      queryClient.setQueryData(key, (old: ViewList | undefined) => old && { ...old, order });
      try {
        queryClient.setQueryData(
          key,
          await reorder.mutateAsync({ params: { path: { budgetId } }, body: { order } }),
        );
      } finally {
        await refresh();
      }
    },
  };
}
export type ViewActions = ReturnType<typeof useViewActions>;
