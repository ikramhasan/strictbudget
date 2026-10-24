import { userPreference } from "@strictbudget/db/schema";
import {
  type AccountFamily,
  type AccountType,
  accountFamily,
  type CurrencyCode,
  convert,
  isOnBudget,
  money,
} from "@strictbudget/engine";
import { eq } from "drizzle-orm";
import { knownRate } from "./fx";
import type { AccountBalances, Db } from "./ledger";

/** The sidebar's groups (as the web app's `sidebarSections`), plus all open accounts. */
export const TOTAL_IDS = ["starred", "budget", "loans", "tracking", "closed", "netWorth"] as const;
export type TotalId = (typeof TOTAL_IDS)[number];

export interface ConvertedBalances {
  currency: CurrencyCode;
  cleared: bigint;
  uncleared: bigint;
  working: bigint;
}

export interface Total {
  currency: CurrencyCode;
  amount: bigint;
  /** Some account in it was converted from another currency. */
  converted: boolean;
  /** Accounts left out because no rate to the display currency is known. */
  missing: string[];
}

/** The user's display currency; null is each budget's own. */
export async function displayCurrencyOf(db: Db, userId: string): Promise<CurrencyCode | null> {
  const [row] = await db
    .select({ currency: userPreference.displayCurrency })
    .from(userPreference)
    .where(eq(userPreference.userId, userId));
  return row?.currency ?? null;
}

const SECTION_OF: Record<AccountFamily, TotalId> = {
  cash: "budget",
  credit: "budget",
  loan: "loans",
  tracking: "tracking",
};

interface TotalsAccount {
  id: string;
  type: AccountType;
  currency: CurrencyCode;
  closed: boolean;
  starredSortOrder: number | null;
  balances: AccountBalances;
}

/** The totals an account counts in: its sidebar groups, and net worth while it's open. */
function totalsOf(a: TotalsAccount): TotalId[] {
  if (a.closed) return ["closed"];
  const ids: TotalId[] = [SECTION_OF[accountFamily(a.type)], "netWorth"];
  if (a.starredSortOrder !== null && isOnBudget(a.type)) ids.push("starred");
  return ids;
}

/**
 * Each account's balances in `display`, and the sidebar's totals and net worth in it: native
 * balances at today's known rate (no network), converted half-even, so they are today's value,
 * not what the budget booked. Accounts with no known rate are left out of the totals (`missing`).
 */
export async function convertedTotals(
  db: Db,
  input: {
    budgetId: string;
    budgetCurrency: CurrencyCode;
    display: CurrencyCode;
    today: string;
    accounts: readonly TotalsAccount[];
  },
) {
  const { budgetId, budgetCurrency, display, today } = input;
  const rates = new Map<CurrencyCode, string | null>();
  const converted = new Map<string, ConvertedBalances>();
  const totals = Object.fromEntries(
    TOTAL_IDS.map((id): [TotalId, Total] => [
      id,
      { currency: display, amount: 0n, converted: false, missing: [] },
    ]),
  ) as Record<TotalId, Total>;
  for (const a of input.accounts) {
    if (!rates.has(a.currency)) {
      rates.set(
        a.currency,
        await knownRate(db, {
          budgetId,
          budgetCurrency,
          from: a.currency,
          to: display,
          date: today,
        }),
      );
    }
    const rate = rates.get(a.currency) ?? null;
    const ids = totalsOf(a);
    if (rate === null) {
      for (const id of ids) totals[id].missing.push(a.id);
      continue;
    }
    const to = (amount: bigint) => convert(money(amount, a.currency), rate, display).amount;
    // Working converts as a whole; uncleared is the rest, so the parts add up.
    const working = to(a.balances.working);
    const cleared = to(a.balances.cleared);
    converted.set(a.id, { currency: display, cleared, uncleared: working - cleared, working });
    for (const id of ids) {
      totals[id].amount += working;
      if (a.currency !== display) totals[id].converted = true;
    }
  }
  const missingRates = input.accounts.filter((a) => !converted.has(a.id)).length;
  return { converted, totals, missingRates };
}
