import type { NumberFormat } from "./format-settings";
import { NUMBER_FORMAT_SPECS } from "./format-settings";

// The "Export Plan" and "Export # Transactions" files.

/** The plan file header. */
export const PLAN_EXPORT_HEADER = [
  "Month",
  "Category Group/Category",
  "Category Group",
  "Category",
  "Assigned",
  "Activity",
  "Available",
] as const;

/** The register file header. */
export const REGISTER_EXPORT_HEADER = [
  "Account",
  "Flag",
  "Date",
  "Payee",
  "Category Group/Category",
  "Category Group",
  "Category",
  "Memo",
  "Outflow",
  "Inflow",
  "Cleared",
] as const;

/**
 * Extra columns after the standard ones, written only when the budget has an account in another
 * currency: the row's currency, the applied rate and the amounts in the budget's.
 */
export const REGISTER_EXPORT_FX_HEADER = [
  "Currency",
  "FX Rate",
  "Base Outflow",
  "Base Inflow",
] as const;

/** The line break in export files. */
export const EXPORT_NEWLINE = "\r\n";

/** The UTF-8 byte-order mark at the start of each file in the Export Plan zip. */
export const EXPORT_BOM = "﻿";

/** A comma, or a tab for currencies whose decimal mark is a comma. */
export function exportSeparator(numberFormat: NumberFormat): "," | "\t" {
  return NUMBER_FORMAT_SPECS[numberFormat].decimal === "," ? "\t" : ",";
}

/** A quoted text cell, `"` doubled. */
export function exportQuote(text: string): string {
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * Formula guard: text that starts (after optional whitespace) with `+`, `-`, `=` or `@`
 * gets a backslash before that character, the leading whitespace dropped.
 */
export function exportSanitize(text: string): string {
  return text.replace(/^\s*([+\-=@])/, "\\$1");
}

/** A text cell: sanitized, then quoted. */
export const exportText = (text: string) => exportQuote(exportSanitize(text));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A plan row's month, "Oct 2026". `month` is YYYY-MM. */
export function exportMonthLabel(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** What's written for a category: "Group: Category", the group, the category. */
export interface ExportCategory {
  /** null for a row without a category (a transfer, or Uncategorized). */
  name: string | null;
  group: string;
  hidden: boolean;
  internalKind: "ready_to_assign" | "uncategorized" | null;
}

/**
 * The three category cells' text: income is "Inflow" / "Ready to Assign", a hidden category's group
 * is "Hidden Categories", and a row without a category (or Uncategorized) leaves all three empty.
 */
export function exportCategoryColumns(c: ExportCategory | null): [string, string, string] {
  if (!c || c.name === null || c.internalKind === "uncategorized") return ["", "", ""];
  const [group, name] =
    c.internalKind === "ready_to_assign"
      ? ["Inflow", "Ready to Assign"]
      : [c.hidden ? "Hidden Categories" : c.group, c.name];
  return [`${group}: ${name}`, group, name];
}

export function exportCleared(cleared: "uncleared" | "cleared" | "reconciled"): string {
  return cleared === "cleared" ? "Cleared" : cleared === "reconciled" ? "Reconciled" : "Uncleared";
}

/** The flag column: the flag's name when it has one, else its color ("Red"); "" for none. */
export function exportFlag(color: string | null, name: string | undefined): string {
  if (!color) return "";
  return name || `${color.charAt(0).toUpperCase()}${color.slice(1)}`;
}

/** A split line's memo: "Split (2/3) Groceries". */
export function exportSplitMemo(index: number, count: number, memo: string): string {
  return `Split (${index + 1}/${count}) ${memo}`;
}

/** The "as of" stamp in export file names: the local time as "YYYY-MM-DD HH-MM". */
export function exportDateStamp(now: Date): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString();
  return `${local.slice(0, 10)} ${local.slice(11, 16).replace(":", "-")}`;
}

/**
 * Export Plan's file names: the budget name with every run of characters other than ASCII letters
 * and digits turned into a space, then "as of" the stamp.
 */
export function planExportNames(budgetName: string, stamp: string, separator: "," | "\t") {
  const name = budgetName.replace(/[^a-zA-Z0-9]+/g, " ");
  const ext = separator === "," ? ".csv" : ".tsv";
  const at = stamp.replace(/[/:]/g, "_");
  return {
    zip: `strictbudget Export - ${name} as of ${at}.zip`,
    plan: `${name} as of ${at} - Plan${ext}`,
    register: `${name} as of ${at} - Register${ext}`,
  };
}

/** "Export # Transactions"' file name; the budget name is used as is. */
export function selectedExportName(budgetName: string, stamp: string, separator: "," | "\t") {
  return `Selected Transactions for ${budgetName} as of ${stamp}${separator === "," ? ".csv" : ".tsv"}`;
}
