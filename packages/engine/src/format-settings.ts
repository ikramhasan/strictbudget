import { z } from "zod";

/**
 * Per-budget display settings. Keys are persisted in the database, so an
 * existing key must never be renamed or change meaning.
 */
export const NUMBER_FORMATS = [
  "comma_dot",
  "dot_comma",
  "space_comma",
  "space_dot",
  "apostrophe_dot",
  "indian",
] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

export const CURRENCY_SYMBOL_POSITIONS = ["before", "after", "none"] as const;
export type CurrencySymbolPosition = (typeof CURRENCY_SYMBOL_POSITIONS)[number];

export const DATE_FORMATS = [
  "MM/DD/YYYY",
  "DD/MM/YYYY",
  "YYYY-MM-DD",
  "DD.MM.YYYY",
  "YYYY/MM/DD",
  "DD-MM-YYYY",
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const zNumberFormat = z
  .enum(NUMBER_FORMATS)
  .describe("Digit grouping and decimal separator");
export const zCurrencySymbolPosition = z
  .enum(CURRENCY_SYMBOL_POSITIONS)
  .describe("Where the currency symbol goes");
export const zDateFormat = z.enum(DATE_FORMATS).describe("How dates are displayed");

export interface BudgetFormatSettings {
  numberFormat: NumberFormat;
  currencySymbolPosition: CurrencySymbolPosition;
  dateFormat: DateFormat;
}

const NBSP = " ";

interface NumberFormatSpec {
  group: string;
  decimal: "." | ",";
  /** "indian" groups the last three digits, then pairs: 12,34,567. */
  grouping: "thousands" | "indian";
  /** Characters accepted as group separators when parsing user input. */
  groupInput: RegExp;
}

export const NUMBER_FORMAT_SPECS: Record<NumberFormat, NumberFormatSpec> = {
  comma_dot: { group: ",", decimal: ".", grouping: "thousands", groupInput: /,/g },
  dot_comma: { group: ".", decimal: ",", grouping: "thousands", groupInput: /\./g },
  space_comma: { group: NBSP, decimal: ",", grouping: "thousands", groupInput: /\s/g },
  space_dot: { group: NBSP, decimal: ".", grouping: "thousands", groupInput: /\s/g },
  apostrophe_dot: { group: "'", decimal: ".", grouping: "thousands", groupInput: /['’]/g },
  indian: { group: ",", decimal: ".", grouping: "indian", groupInput: /,/g },
};
