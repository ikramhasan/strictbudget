import type { components } from "@strictbudget/api-client";
import { $api } from "./api";

export type FxRate = components["schemas"]["FxRate"];
export type FxRateOverride = components["schemas"]["FxRateOverride"];

export const fxRateOverridesQueryOptions = (budgetId: string) =>
  $api.queryOptions("get", "/v1/budgets/{budgetId}/fx-rate-overrides", {
    params: { path: { budgetId } },
  });

/** What the API accepts as a rate: a positive decimal with at most 12 decimals. */
export function isValidRate(text: string) {
  return /^\d+(\.\d{1,12})?$/.test(text) && /[1-9]/.test(text);
}

export const rateLabel = (from: string, rate: string, to: string) => `1 ${from} = ${rate} ${to}`;
