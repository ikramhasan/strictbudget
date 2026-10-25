import type { ApiError, components } from "@strictbudget/api-client";
import type { QueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { $api } from "./api";

dayjs.extend(relativeTime);

export type Budget = components["schemas"]["Budget"];
export type BudgetList = components["schemas"]["BudgetList"];

export const budgetsQueryOptions = () => $api.queryOptions("get", "/v1/budgets");

export const budgetQueryOptions = (budgetId: string) =>
  $api.queryOptions("get", "/v1/budgets/{budgetId}", { params: { path: { budgetId } } });

/** Where "/" should send the user: last-used budget, else the first active one, else nowhere. */
export function pickBudgetRedirect(list: BudgetList): string | null {
  return (
    list.lastUsedBudgetId ??
    list.budgets.find((b) => !b.archivedAt)?.id ??
    list.budgets[0]?.id ??
    null
  );
}

export function lastUsedLabel(lastUsedAt: string, now = new Date()) {
  return `Last used ${dayjs(lastUsedAt).from(now)}`;
}

/** The `error.code` of an API error thrown by `$api` queries/mutations, if it is one. */
export function apiErrorCode(error: unknown): string | undefined {
  return (error as Partial<ApiError> | null)?.error?.code;
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  return (error as Partial<ApiError> | null)?.error?.message ?? fallback;
}

export async function invalidateBudgets(queryClient: QueryClient) {
  await queryClient.invalidateQueries({ queryKey: ["get", "/v1/budgets"] });
  await queryClient.invalidateQueries({ queryKey: ["get", "/v1/budgets/{budgetId}"] });
}
