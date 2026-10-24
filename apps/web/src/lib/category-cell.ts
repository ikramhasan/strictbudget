import { type AccountType, accountFamily, usesCategory } from "@strictbudget/engine";

/**
 * Whether a saved register row's category cell reads "Category not needed" (or, between a card and
 * a cash account, the card's payment category): every row in a tracking account, in-budget transfers
 * (card↔card, cash↔cash, card↔cash), and a credit card's Starting Balance whatever its sign; a cash
 * account's Starting Balance is "Inflow: Ready to Assign".
 */
export function categoryNotNeeded(row: {
  accountType: AccountType;
  transferAccountType: AccountType | null;
  payeeName: string | null;
}) {
  if (!usesCategory(row.accountType, row.transferAccountType)) return true;
  return (
    accountFamily(row.accountType) === "credit" &&
    row.transferAccountType === null &&
    row.payeeName === "Starting Balance"
  );
}
