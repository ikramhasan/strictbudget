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

/** Each flag's colour as a CSS colour, for chart marks (the same hues as `FLAG_CLASS`). */
export const FLAG_COLOR: Record<FlagColor, string> = {
  red: "var(--color-red-500)",
  orange: "var(--color-orange-500)",
  yellow: "var(--color-yellow-500)",
  green: "var(--color-green-500)",
  blue: "var(--color-blue-500)",
  purple: "var(--color-purple-500)",
};

/** The flags in the order the app lists them. */
export const FLAG_ORDER = Object.keys(COLOR_LABEL) as FlagColor[];

/** What reports call a flag: its custom name, else its colour; null is "No flag". */
export function flagName(color: FlagColor | null, flags: readonly Flag[]) {
  if (color === null) return "No flag";
  return flags.find((f) => f.color === color)?.name || COLOR_LABEL[color];
}

export function flagLabel(flag: Flag) {
  return flag.name ? `${flag.name} (${COLOR_LABEL[flag.color]})` : COLOR_LABEL[flag.color];
}
