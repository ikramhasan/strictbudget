import { z } from "zod";

/**
 * Account types. Keys are persisted in the database, so an existing key must never be
 * renamed or change meaning.
 */
export const ACCOUNT_TYPES = [
  "checking",
  "savings",
  "cash",
  "credit_card",
  "line_of_credit",
  "mortgage",
  "auto_loan",
  "student_loan",
  "personal_loan",
  "medical_debt",
  "other_debt",
  "asset",
  "liability",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_FAMILIES = ["cash", "credit", "loan", "tracking"] as const;
export type AccountFamily = (typeof ACCOUNT_FAMILIES)[number];

const FAMILY: Record<AccountType, AccountFamily> = {
  checking: "cash",
  savings: "cash",
  cash: "cash",
  credit_card: "credit",
  line_of_credit: "credit",
  mortgage: "loan",
  auto_loan: "loan",
  student_loan: "loan",
  personal_loan: "loan",
  medical_debt: "loan",
  other_debt: "loan",
  asset: "tracking",
  liability: "tracking",
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: "Checking",
  savings: "Savings",
  cash: "Cash",
  credit_card: "Credit Card",
  line_of_credit: "Line of Credit",
  mortgage: "Mortgage",
  auto_loan: "Auto Loan",
  student_loan: "Student Loan",
  personal_loan: "Personal Loan",
  medical_debt: "Medical Debt",
  other_debt: "Other Debt",
  asset: "Asset (e.g. investment)",
  liability: "Liability",
};

export const zAccountType = z.enum(ACCOUNT_TYPES).describe("Account type");

export function accountFamily(type: AccountType): AccountFamily {
  return FAMILY[type];
}

/** Cash and credit accounts are in the budget; loan and tracking accounts only track a balance. */
export function isOnBudget(type: AccountType): boolean {
  const family = FAMILY[type];
  return family === "cash" || family === "credit";
}

/**
 * Whether a transaction in an account of `type` has a category. Tracking accounts never do. A
 * transfer (to or from `transferType`) only does when money leaves the budget: on the budget side
 * of a transfer with a tracking account. Between two budget accounts it stays in
 * the budget.
 */
export function usesCategory(type: AccountType, transferType?: AccountType | null): boolean {
  return isOnBudget(type) && !(transferType && isOnBudget(transferType));
}

/** Credit accounts get an automatic payment category. */
export function hasPaymentCategory(type: AccountType): boolean {
  return FAMILY[type] === "credit";
}

/**
 * Accounts whose balance people think of as "amount owed". Their forms ask for a positive amount
 * owed, stored as a negative balance.
 */
export function isDebtAccount(type: AccountType): boolean {
  const family = FAMILY[type];
  return family === "credit" || family === "loan" || type === "liability";
}
