import { budgetAccount, payee, transaction } from "@strictbudget/db/schema";
import {
  addMonths,
  allTimeHighs,
  type BudgetMonth,
  type CurrencyCode,
  convert,
  isOnBudget,
  money,
  monthBounds,
  type NetWorthParts,
  type NetWorthTotals,
  netWorthGroup,
  netWorthParts,
  netWorthTotals,
} from "@strictbudget/engine";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { FxDeps } from "./base-amount";
import { AppError } from "./errors";
import { resolveRate } from "./fx";
import type { Db } from "./ledger";
import { loanStates } from "./loans";

type AccountRow = typeof budgetAccount.$inferSelect;

export interface NetWorthBalance {
  native: bigint;
  /** In the budget's currency at the month-end rate; null when no rate is known. */
  base: bigint | null;
}

export interface NetWorthAccount {
  account: AccountRow;
  onBudget: boolean;
  /** The month of its first transaction, null when it has none (up to the range's end). */
  firstMonth: BudgetMonth | null;
  /** At the end of the month before the range. */
  opening: NetWorthBalance;
  /** At the end of each month of the range. */
  balances: NetWorthBalance[];
}

export interface NetWorthMonth extends NetWorthTotals {
  month: BudgetMonth;
  /** A net worth above every earlier month-end since the first month with a transaction. */
  allTimeHigh: boolean;
  /** Accounts left out of the totals: a balance in a currency with no rate for the month-end. */
  missing: string[];
  /** "What changed this month": from the previous month-end's net worth to this one's. */
  parts: NetWorthParts;
}

export interface NetWorthRate {
  currency: CurrencyCode;
  month: BudgetMonth;
  /** 1 `currency` = rate budget currency; null when none is known. */
  rate: string | null;
  rateDate: string | null;
}

interface MonthFlows {
  native: bigint;
  base: bigint;
  starting: bigint;
  transfers: bigint;
}

const ZERO_FLOWS: MonthFlows = { native: 0n, base: 0n, starting: 0n, transfers: 0n };

/**
 * Month-end balances of a budget's accounts over `from`–`to` and the net worth they add up to:
 * every account, closed ones included; the last day's working balance (uncleared included, a
 * loan's interest and escrow for the month included); the current month as of `today`. A
 * foreign-currency balance converts at its month-end's rate (`resolveRate`: the budget's override,
 * the cached market rate, a provider, else the nearest earlier rate); with none at all it's left
 * out of the totals and listed in `missing`. Flows for the waterfall are the transactions' base
 * amounts (booked rates), revaluations left out.
 */
export async function netWorthReport(
  db: Db,
  fx: FxDeps,
  input: {
    budgetId: string;
    budgetCurrency: CurrencyCode;
    from: BudgetMonth;
    to: BudgetMonth;
    today: string;
    accountIds?: readonly string[];
  },
) {
  const { budgetId, budgetCurrency, from, to, today } = input;
  const toEnd = monthBounds(to).end;
  const cutoff = toEnd < today ? toEnd : today;
  const accountFilter = input.accountIds
    ? and(eq(budgetAccount.budgetId, budgetId), inArray(budgetAccount.id, [...input.accountIds]))
    : eq(budgetAccount.budgetId, budgetId);
  const accounts = await db
    .select()
    .from(budgetAccount)
    .where(accountFilter)
    .orderBy(asc(budgetAccount.createdAt), asc(budgetAccount.id));
  const ids = accounts.map((a) => a.id);

  const transfer = sql`(${transaction.transferTransactionId} is not null or ${transaction.transferSubTransactionId} is not null)`;
  const revaluation = sql`${payee.internalKind} is not distinct from 'fx_revaluation'`;
  const rows = ids.length
    ? await db
        .select({
          accountId: transaction.accountId,
          month: sql<string>`to_char(${transaction.date}, 'YYYY-MM')`,
          native: sql<string>`coalesce(sum(${transaction.amount}), 0)`,
          base: sql<string>`coalesce(sum(${transaction.baseAmount}) filter (where not ${revaluation}), 0)`,
          starting: sql<string>`coalesce(sum(${transaction.baseAmount}) filter (where ${payee.internalKind} is not distinct from 'starting_balance'), 0)`,
          transfers: sql<string>`coalesce(sum(${transaction.baseAmount}) filter (where ${transfer}), 0)`,
        })
        .from(transaction)
        .leftJoin(payee, eq(payee.id, transaction.payeeId))
        .where(
          and(
            eq(transaction.budgetId, budgetId),
            inArray(transaction.accountId, ids),
            lte(transaction.date, cutoff),
          ),
        )
        .groupBy(transaction.accountId, sql`2`)
    : [];

  // flows.get(accountId).get(month)
  const flows = new Map<string, Map<BudgetMonth, MonthFlows>>();
  const firstMonths = new Map<string, BudgetMonth>();
  const addFlows = (accountId: string, month: BudgetMonth, f: Partial<MonthFlows>) => {
    const byMonth = flows.get(accountId) ?? new Map<BudgetMonth, MonthFlows>();
    const prev = byMonth.get(month) ?? ZERO_FLOWS;
    byMonth.set(month, {
      native: prev.native + (f.native ?? 0n),
      base: prev.base + (f.base ?? 0n),
      starting: prev.starting + (f.starting ?? 0n),
      transfers: prev.transfers + (f.transfers ?? 0n),
    });
    flows.set(accountId, byMonth);
    const first = firstMonths.get(accountId);
    if (!first || month < first) firstMonths.set(accountId, month);
  };
  for (const r of rows) {
    addFlows(r.accountId, r.month, {
      native: BigInt(r.native),
      base: BigInt(r.base),
      starting: BigInt(r.starting),
      transfers: BigInt(r.transfers),
    });
  }
  // A loan's interest and escrow add to its debt each month (always in the budget's currency).
  const loans = await loanStates(db, accounts, cutoff);
  for (const [accountId, state] of loans) {
    for (const m of state.months) {
      const charge = m.interest.applied + m.escrow.applied;
      if (charge !== 0n) addFlows(accountId, m.month, { native: -charge, base: -charge });
    }
  }

  // The months walked: from the first one with a transaction (for all-time highs) or the month
  // before the range (its opening), whichever is earlier, to the range's end.
  const before = addMonths(from, -1);
  const earliest = [...firstMonths.values()].reduce<BudgetMonth | null>(
    (a, m) => (a === null || m < a ? m : a),
    null,
  );
  const start = earliest !== null && earliest < before ? earliest : before;
  const months: BudgetMonth[] = [];
  for (let m = start; m <= to; m = addMonths(m, 1)) months.push(m);

  const rateCache = new Map<string, Promise<NetWorthRate>>();
  const rateFor = (currency: CurrencyCode, month: BudgetMonth) => {
    const end = monthBounds(month).end;
    const date = end < today ? end : today;
    const key = `${currency}:${date}`;
    let rate = rateCache.get(key);
    if (!rate) {
      rate = resolveRate(db, fx, {
        budgetId,
        from: currency,
        to: budgetCurrency,
        date,
        today,
      }).then(
        (r) => ({ currency, month, rate: r.rate, rateDate: r.rateDate }),
        (error: unknown) => {
          if (error instanceof AppError && error.code === "FX_RATE_UNAVAILABLE") {
            return { currency, month, rate: null, rateDate: null };
          }
          throw error;
        },
      );
      rateCache.set(key, rate);
    }
    return rate;
  };

  // Each month-end rate the walk needs (a foreign currency's months from its accounts' first
  // transaction), resolved together up front: each can be a provider round-trip.
  const foreignFirst = new Map<CurrencyCode, BudgetMonth>();
  for (const a of accounts) {
    const first = firstMonths.get(a.id);
    const known = foreignFirst.get(a.currency);
    if (a.currency !== budgetCurrency && first && (!known || first < known)) {
      foreignFirst.set(a.currency, first);
    }
  }
  await Promise.all(
    months.flatMap((m) =>
      [...foreignFirst].filter(([, first]) => m >= first).map(([c]) => rateFor(c, m)),
    ),
  );

  const running = new Map<string, bigint>(ids.map((id) => [id, 0n]));
  const balances: Map<string, NetWorthBalance>[] = [];
  const rates: NetWorthRate[] = [];
  for (const month of months) {
    const byAccount = new Map<string, NetWorthBalance>();
    for (const a of accounts) {
      const native = (running.get(a.id) ?? 0n) + (flows.get(a.id)?.get(month)?.native ?? 0n);
      running.set(a.id, native);
      let base: bigint | null = native;
      if (a.currency !== budgetCurrency && native !== 0n) {
        const rate = await rateFor(a.currency, month);
        base =
          rate.rate === null
            ? null
            : convert(money(native, a.currency), rate.rate, budgetCurrency).amount;
      }
      byAccount.set(a.id, { native, base });
    }
    balances.push(byAccount);
  }
  for (const month of months.filter((m) => m >= from)) {
    for (const currency of new Set(accounts.map((a) => a.currency))) {
      if (currency !== budgetCurrency) rates.push(await rateFor(currency, month));
    }
  }

  const totals = balances.map((b) => netWorthTotals([...b.values()].map((v) => v.base)));
  const firstIndex = earliest === null ? months.length : months.indexOf(earliest);
  const highs = [
    ...months.slice(0, firstIndex).map(() => false),
    ...allTimeHighs(totals.slice(firstIndex).map((t) => t.netWorth)),
  ];

  const startIndex = months.indexOf(from);
  const result: NetWorthMonth[] = [];
  for (let i = startIndex; i < months.length; i++) {
    const month = months[i] as BudgetMonth;
    const total = totals[i] as NetWorthTotals;
    const previous = totals[i - 1] as NetWorthTotals;
    const change = total.netWorth - previous.netWorth;
    const byAccount = balances[i] as Map<string, NetWorthBalance>;
    result.push({
      month,
      ...total,
      allTimeHigh: highs[i] ?? false,
      missing: accounts.filter((a) => byAccount.get(a.id)?.base === null).map((a) => a.id),
      parts: netWorthParts(
        change,
        // An account left out of the month's totals (no rate) is left out of what changed too.
        accounts
          .filter((a) => byAccount.get(a.id)?.base !== null)
          .map((a) => {
            const f = flows.get(a.id)?.get(month) ?? ZERO_FLOWS;
            return {
              group: netWorthGroup(a.type),
              total: f.base,
              starting: f.starting,
              transfers: f.transfers,
            };
          }),
      ),
    });
  }

  const opening = balances[startIndex - 1] as Map<string, NetWorthBalance>;
  return {
    opening: { month: before, ...(totals[startIndex - 1] as NetWorthTotals) },
    months: result,
    rates,
    firstMonth: earliest,
    accounts: accounts.map(
      (account): NetWorthAccount => ({
        account,
        onBudget: isOnBudget(account.type),
        firstMonth: firstMonths.get(account.id) ?? null,
        opening: opening.get(account.id) ?? { native: 0n, base: 0n },
        balances: balances
          .slice(startIndex)
          .map((b) => b.get(account.id) ?? { native: 0n, base: 0n }),
      }),
    ),
  };
}
