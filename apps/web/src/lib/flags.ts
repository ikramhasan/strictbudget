import type { components } from "@strictbudget/api-client";
import { $api } from "./api";

export type Flag = components["schemas"]["Flag"];
export type FlagColor = Flag["color"];

export const flagsQueryOptions = (budgetId: string) =>
  $api.queryOptions("get", "/v1/budgets/{budgetId}/flags", { params: { path: { budgetId } } });

/** Text color for each flag (Tailwind classes, spelled out so they're generated). */
export const FLAG_CLASS: Record<FlagColor, string> = {
  red: "text-red-500",
  orange: "text-orange-500",
  yellow: "text-yellow-500",
  green: "text-green-500",
  blue: "text-blue-500",
  purple: "text-purple-500",
};

export const COLOR_LABEL: Record<FlagColor, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
};

export function flagLabel(flag: Flag) {
  return flag.name ? `${flag.name} (${COLOR_LABEL[flag.color]})` : COLOR_LABEL[flag.color];
}
