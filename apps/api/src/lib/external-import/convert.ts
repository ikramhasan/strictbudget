import {
  type AccountType,
  CURRENCY_CODES,
  type CurrencyCode,
  type CurrencySymbolPosition,
  currencyExponent,
  DATE_FORMATS,
  type DateFormat,
  isOnBudget,
  type NumberFormat,
} from "@strictbudget/engine";
import { AppError } from "../errors";

// Pieces both sources (the API and the export files) share.

/** The source app's account types (API spelling) and ours. */
export const EXTERNAL_ACCOUNT_TYPES: Record<string, AccountType> = {
  checking: "checking",
  savings: "savings",
  cash: "cash",
  creditCard: "credit_card",
  lineOfCredit: "line_of_credit",
  otherAsset: "asset",
  otherLiability: "liability",
  mortgage: "mortgage",
  autoLoan: "auto_loan",
  studentLoan: "student_loan",
  personalLoan: "personal_loan",
  medicalDebt: "medical_debt",
  otherDebt: "other_debt",
};

/** The source app's built-in payees, by name, and our kinds for them. */
export const EXTERNAL_INTERNAL_PAYEES = {
  "Starting Balance": "starting_balance",
  "Manual Balance Adjustment": "manual_balance_adjustment",
  "Reconciliation Balance Adjustment": "reconciliation_balance_adjustment",
} as const;

export const EXTERNAL_INTERNAL_GROUP = "Internal Master Category";
export const EXTERNAL_CARD_GROUP = "Credit Card Payments";
export const EXTERNAL_HIDDEN_GROUP = "Hidden Categories";
export const EXTERNAL_READY_TO_ASSIGN = "Inflow: Ready to Assign";
export const EXTERNAL_UNCATEGORIZED = "Uncategorized";

export function currencyOf(iso: string | undefined): CurrencyCode {
  if (iso && (CURRENCY_CODES as readonly string[]).includes(iso)) return iso as CurrencyCode;
  throw new AppError(
    422,
    "EXTERNAL_CURRENCY_UNSUPPORTED",
    `strictbudget doesn't know the currency ${iso}`,
  );
}

/**
 * Milliunits (1000 = 1.00) as minor units of `currency`, exactly: 12340 milliunits are 1234 cents.
 * An amount that doesn't divide evenly (a fraction of a cent) is refused, never rounded.
 */
export function minorUnits(milli: number | bigint, currency: CurrencyCode): bigint {
  const exponent = currencyExponent(currency);
  const factor = 10n ** BigInt(3 - exponent);
  const value = BigInt(milli);
  if (value % factor !== 0n) {
    throw new AppError(
      422,
      "EXTERNAL_AMOUNT_INEXACT",
      `${value} milliunits isn't a whole number of ${currency}'s smallest unit`,
    );
  }
  return value / factor;
}

/** The source's number format (its separators) as ours; null when there's no match. */
export function numberFormatOf(format: {
  decimal_separator: string;
  group_separator: string;
  example_format?: string;
}): NumberFormat | null {
  if (format.example_format === "1,23,456.78" || format.example_format === "12,34,567.89") {
    return "indian";
  }
  // A no-break space groups like a space.
  const group = format.group_separator.replace(/\u00a0|\u202f/g, " ");
  const key = `${format.decimal_separator}${group}`;
  const formats: Record<string, NumberFormat> = {
    ".,": "comma_dot",
    ",.": "dot_comma",
    ", ": "space_comma",
    ". ": "space_dot",
    ".'": "apostrophe_dot",
    ".\u2019": "apostrophe_dot",
  };
  return formats[key] ?? null;
}

export function symbolPositionOf(format: {
  display_symbol: boolean;
  symbol_first: boolean;
}): CurrencySymbolPosition {
  if (!format.display_symbol) return "none";
  return format.symbol_first ? "before" : "after";
}

export function dateFormatOf(format: string | undefined): DateFormat | null {
  return (DATE_FORMATS as readonly string[]).includes(format ?? "") ? (format as DateFormat) : null;
}

/**
 * A transaction's category from the source's: a Starting Balance takes Ready to Assign only as a
 * budget account's inflow (the source's API reports a card's starting debt in Ready to Assign too,
 * but its register says "Category not needed"); a tracking account's rows take none; a budget
 * account's uncategorized row (null in the source's API) is Uncategorized.
 */
export function categoryFor(input: {
  accountType: AccountType;
  /** The other account of a transfer. */
  transferType: AccountType | null;
  startingBalance: boolean;
  amount: bigint;
  categoryId: string | null;
  readyToAssignId: string;
  uncategorizedId: string;
}): string | null {
  if (!isOnBudget(input.accountType)) return null;
  if (input.startingBalance) return input.amount >= 0n ? input.readyToAssignId : null;
  if (input.transferType && isOnBudget(input.transferType)) return null;
  return input.categoryId ?? input.uncategorizedId;
}
