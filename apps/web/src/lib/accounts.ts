import type { components } from "@strictbudget/api-client";
import { type AccountFamily, accountFamily, isOnBudget } from "@strictbudget/engine";
import { $api } from "./api";
import { todayIso } from "./dates";

export type Account = components["schemas"]["Account"];
export type AccountTotals = components["schemas"]["AccountList"]["totals"];

/** Balances leave out transactions dated after the user's today. */
export const accountsQueryOptions = (budgetId: string, today = todayIso()) =>
  $api.queryOptions("get", "/v1/budgets/{budgetId}/accounts", {
    params: { path: { budgetId }, query: { today } },
  });

export type SidebarSectionId = "starred" | "cash" | "credit" | "loans" | "tracking" | "closed";

/** An account as the list returns it: with its balances in the display currency (null: no rate). */
type ListedAccount = Account & { converted?: { currency: string; working: string } | null };

export interface SidebarSection {
  id: SidebarSectionId;
  title: string;
  accounts: Account[];
  /** Sum of the working balances, in `currency`'s minor units (closed accounts: always zero). */
  total: bigint;
  /** The display currency, or the budget's. */
  currency: string;
  /** Some account in `total` was converted from another currency at today's rate. */
  converted: boolean;
  /** Accounts left out of `total`: no rate to convert them is known yet. */
  excluded: Account[];
}

const SECTION_OF: Record<AccountFamily, SidebarSectionId> = {
  cash: "cash",
  credit: "credit",
  loan: "loans",
  tracking: "tracking",
};

const TITLES: Record<SidebarSectionId, string> = {
  starred: "Starred",
  cash: "Cash",
  credit: "Credit",
  loans: "Loans",
  tracking: "Tracking",
  closed: "Closed",
};

/** Only open cash and credit accounts can be starred. */
export function canStar(account: Account) {
  return !account.closed && isOnBudget(account.type);
}

/** Starred and still starrable (a closed account drops out). */
export function isStarred(account: Account) {
  return account.starredOrder !== null && canStar(account);
}

/**
 * Starred first (its own order; those accounts stay in their usual group too), then open accounts
 * by family (cash, credit, loans, tracking), then closed ones. Empty sections are left out. Totals
 * are in the display currency at today's rates: the API's, or for Cash and Credit (which it totals
 * as one) the sum of the accounts' converted balances. Without them they add up the accounts in
 * `budgetCurrency` only.
 */
export function sidebarSections(
  accounts: readonly ListedAccount[],
  budgetCurrency: string,
  totals?: AccountTotals,
): SidebarSection[] {
  const order: SidebarSectionId[] = ["starred", "cash", "credit", "loans", "tracking", "closed"];
  const inSectionOf = (id: SidebarSectionId) => {
    if (id === "starred") {
      return accounts
        .filter(isStarred)
        .sort((a, b) => (a.starredOrder ?? 0) - (b.starredOrder ?? 0));
    }
    return accounts.filter((a) =>
      id === "closed" ? a.closed : !a.closed && SECTION_OF[accountFamily(a.type)] === id,
    );
  };
  return order
    .map((id): SidebarSection => {
      const inSection = inSectionOf(id);
      const base = { id, title: TITLES[id], accounts: inSection };
      const given = id === "cash" || id === "credit" ? undefined : totals?.[id];
      if (given) {
        const missing = new Set(given.missing);
        return {
          ...base,
          total: BigInt(given.amount),
          currency: given.currency,
          converted: given.converted,
          excluded: inSection.filter((a) => missing.has(a.id)),
        };
      }
      if (totals) {
        // As the API totals: converted balances, leaving out the accounts with no rate.
        const display = totals.netWorth.currency;
        return {
          ...base,
          total: inSection.reduce(
            (sum, a) => (a.converted ? sum + BigInt(a.converted.working) : sum),
            0n,
          ),
          currency: display,
          converted: inSection.some((a) => a.converted && a.currency !== display),
          excluded: inSection.filter((a) => !a.converted),
        };
      }
      return {
        ...base,
        total: inSection
          .filter((a) => a.currency === budgetCurrency)
          .reduce((sum, a) => sum + BigInt(a.balances.working), 0n),
        currency: budgetCurrency,
        converted: false,
        excluded: inSection.filter((a) => a.currency !== budgetCurrency),
      };
    })
    .filter((s) => s.accounts.length > 0);
}

/**
 * The Close Account dialog for an account whose working balance isn't zero: the closing adjustment
 * (minus the balance), and whether it shows the "money will be removed from your plan" box. That
 * shows only for money in the plan: an on-budget (cash or credit) account above zero.
 */
export function closeAccountNotice(
  type: Account["type"],
  working: bigint,
): { adjustment: bigint; removesMoneyFromPlan: boolean } {
  return { adjustment: -working, removesMoneyFromPlan: working > 0n && isOnBudget(type) };
}

export function excludedHint(excluded: readonly Pick<Account, "currency">[]): string | null {
  if (excluded.length === 0) return null;
  const currencies = new Set(excluded.map((a) => a.currency));
  const noun = excluded.length === 1 ? "account" : "accounts";
  return currencies.size === 1
    ? `Excludes ${excluded.length} ${[...currencies][0]} ${noun}`
    : `Excludes ${excluded.length} ${noun} in other currencies`;
}

export function totalHint(
  section: Pick<SidebarSection, "converted" | "currency" | "excluded">,
): string | null {
  const parts = [
    section.converted ? `Converted to ${section.currency} at today's rates` : null,
    excludedHint(section.excluded),
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(". ") : null;
}

export function editBalanceLabel(type: Account["type"]): string {
  const family = accountFamily(type);
  return family === "loan" || family === "tracking" ? "Today's Balance" : "Working Balance";
}
