import type { RouteHandler } from "@hono/zod-openapi";
import { newId, sql } from "@strictbudget/db";
import {
  budgetAccount,
  budgetMember,
  budget as budgetTable,
  category,
  categoryAssignment,
  categoryGroup,
  categoryTarget,
  moneyMove,
  monthNote,
  payee,
  subTransaction,
  transaction,
  user,
} from "@strictbudget/db/schema";
import {
  ACCOUNT_TYPES,
  type AccountType,
  type AutoAssignOption,
  accountFamily,
  addMonths,
  afterStart,
  autoAssignAmounts,
  type BudgetMonth,
  budgetMonthRange,
  type CardActivity,
  type CardLine,
  type CardLineKind,
  type CategoryFunding,
  type CategoryMonth,
  type CategoryTarget,
  type CurrencyCode,
  cardLedger,
  categoryMonth,
  categoryOverspending,
  fundedCardSpending,
  fundUnderfunded,
  isOnBudget,
  isOverdraft,
  type MonthAmount,
  type MonthFigures,
  monthBounds,
  monthOf,
  type ProgressBar,
  paymentFunding,
  periodRollover,
  progressBar,
  readyToAssign,
  readyToAssignBreakdown,
  spendingFunding,
  type TargetNeed,
  targetInBase,
  targetNeed,
} from "@strictbudget/engine";
import {
  and,
  desc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNotNull,
  lte,
  max,
  min,
  not,
  or,
} from "drizzle-orm";
import { type AnyPgColumn, alias } from "drizzle-orm/pg-core";
import { adjustAssigned, assignedAmount, assignmentRow, logMove } from "../../lib/assignments";
import { loadBudgetAccess } from "../../lib/budget-access";
import { AppError } from "../../lib/errors";
import { prefetchRates, resolveRate } from "../../lib/fx";
import { accountBalances, type Db, internalCategoryId } from "../../lib/ledger";
import { memberAvatarColors, pictureUrlSql } from "../../lib/member-colors";
import {
  type CategoryUpcoming,
  enterDueScheduled,
  entryDate,
  upcomingByCategory,
  userToday,
} from "../../lib/scheduled";
import { lastAssignedBy, staleVersion } from "../../lib/versions";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppDeps, AppEnv } from "../../types";
import type {
  assignCategory,
  autoAssign,
  getBudgetMonth,
  listMonthMoves,
  listMoves,
  moveMoney,
  setExpectedIncome,
  setMonthNote,
} from "./routes";

type Env = AppEnv & AuthedEnv;

const monthKey = (date: AnyPgColumn) => sql<string>`to_char(${date}, 'YYYY-MM')`;
// Postgres returns numeric sums as strings; BigInt parses them exactly.
const total = (amount: AnyPgColumn) => sql<string>`sum(${amount})`;
const CREDIT_TYPES = ACCOUNT_TYPES.filter((t) => accountFamily(t) === "credit");
const CASH_TYPES = ACCOUNT_TYPES.filter((t) => accountFamily(t) === "cash");
/** The part of `amount`'s sum on credit accounts (credit spending). */
const creditTotal = (amount: AnyPgColumn) =>
  sql<string>`coalesce(sum(${amount}) filter (where ${inArray(budgetAccount.type, CREDIT_TYPES)}), 0)`;

/**
 * Each category's activity per month up to `cutoff` (and the part of it on credit accounts), and its
 * assigned amounts in every month (money assigned in later months counts toward Ready to Assign).
 */
async function categoryHistory(db: Db, budgetId: string, cutoff: string) {
  const rows = await db
    .select({
      categoryId: transaction.categoryId,
      month: monthKey(transaction.date),
      amount: total(transaction.baseAmount),
      credit: creditTotal(transaction.baseAmount),
    })
    .from(transaction)
    .innerJoin(budgetAccount, eq(budgetAccount.id, transaction.accountId))
    .where(
      and(
        eq(transaction.budgetId, budgetId),
        isNotNull(transaction.categoryId),
        lte(transaction.date, cutoff),
      ),
    )
    .groupBy(transaction.categoryId, monthKey(transaction.date));
  // A split's own category is null; its lines carry the categories.
  const lines = await db
    .select({
      categoryId: subTransaction.categoryId,
      month: monthKey(transaction.date),
      amount: total(subTransaction.baseAmount),
      credit: creditTotal(subTransaction.baseAmount),
    })
    .from(subTransaction)
    .innerJoin(transaction, eq(transaction.id, subTransaction.transactionId))
    .innerJoin(budgetAccount, eq(budgetAccount.id, transaction.accountId))
    .where(
      and(
        eq(transaction.budgetId, budgetId),
        isNotNull(subTransaction.categoryId),
        lte(transaction.date, cutoff),
      ),
    )
    .groupBy(subTransaction.categoryId, monthKey(transaction.date));
  const assigned = await db
    .select({
      categoryId: categoryAssignment.categoryId,
      month: monthKey(categoryAssignment.month),
      amount: categoryAssignment.amount,
    })
    .from(categoryAssignment)
    .where(eq(categoryAssignment.budgetId, budgetId));

  const history = new Map<string, MonthFigures[]>();
  const push = (categoryId: string | null, entry: MonthFigures) => {
    if (!categoryId) return;
    const list = history.get(categoryId) ?? [];
    list.push(entry);
    history.set(categoryId, list);
  };
  for (const r of [...rows, ...lines]) {
    push(r.categoryId, {
      month: r.month,
      assigned: 0n,
      activity: BigInt(r.amount),
      creditActivity: BigInt(r.credit),
    });
  }
  for (const r of assigned)
    push(r.categoryId, { month: r.month, assigned: r.amount, activity: 0n });
  return history;
}

/**
 * Every category's history up to `cutoff`, payment categories' Funded Spending included (the
 * funded part of card spending moves into the card's payment category).
 */
export async function budgetHistory(db: Db, budgetId: string, cutoff: string) {
  const history = await categoryHistory(db, budgetId, cutoff);
  const rows = await db
    .select({
      id: category.id,
      accountId: category.linkedAccountId,
      internalKind: category.internalKind,
    })
    .from(category)
    .where(eq(category.budgetId, budgetId));
  const byAccount = new Map(rows.flatMap((p) => (p.accountId ? [[p.accountId, p.id]] : [])));
  const readyToAssignId = rows.find((r) => r.internalKind === "ready_to_assign")?.id;
  const { credit: cards, debt } = applyCardLedger(
    history,
    await cardLines(db, budgetId, cutoff),
    readyToAssignId,
    byAccount,
  );
  // Card money moves through every spending category, Uncategorized included.
  const skip = new Set(
    rows.filter((r) => r.accountId || r.internalKind === "ready_to_assign").map((r) => r.id),
  );
  const creditOverspent = addFundedSpending(cards, history, byAccount, skip);
  await addPayments(db, budgetId, cutoff, history, byAccount);
  return { history, paymentAccounts: byAccount, creditOverspent, debt };
}

/**
 * Adds each payment category's Payments Made to `history`: money moved into a card from a cash
 * account comes out of the card's payment category in the payment's month (paying more than is
 * set aside leaves it negative). Money moved out of a card to a budget account (a cash advance)
 * only raises what's owed. From another card only the part it paid from above zero is a payment
 * (`applyCardLedger`). A transfer from a tracking account is no payment: its category on the card
 * side decides, as for any card inflow.
 */
async function addPayments(
  db: Db,
  budgetId: string,
  cutoff: string,
  history: Map<string, MonthFigures[]>,
  paymentCategoryByAccount: ReadonlyMap<string, string>,
) {
  const other = alias(transaction, "other_side");
  const otherAccount = alias(budgetAccount, "other_account");
  const otherLine = alias(subTransaction, "other_line");
  const otherLineTx = alias(transaction, "other_line_tx");
  const otherLineAccount = alias(budgetAccount, "other_line_account");
  // Inflows to a card whose other side (a transaction or a split's line) is in a cash account.
  const rows = await db
    .select({
      accountId: transaction.accountId,
      month: monthKey(transaction.date),
      amount: total(transaction.baseAmount),
    })
    .from(transaction)
    .innerJoin(budgetAccount, eq(budgetAccount.id, transaction.accountId))
    .leftJoin(other, eq(other.id, transaction.transferTransactionId))
    .leftJoin(otherAccount, eq(otherAccount.id, other.accountId))
    .leftJoin(otherLine, eq(otherLine.id, transaction.transferSubTransactionId))
    .leftJoin(otherLineTx, eq(otherLineTx.id, otherLine.transactionId))
    .leftJoin(otherLineAccount, eq(otherLineAccount.id, otherLineTx.accountId))
    .where(
      and(
        eq(transaction.budgetId, budgetId),
        inArray(budgetAccount.type, CREDIT_TYPES),
        gt(transaction.baseAmount, 0n),
        lte(transaction.date, cutoff),
        or(inArray(otherAccount.type, CASH_TYPES), inArray(otherLineAccount.type, CASH_TYPES)),
      ),
    )
    .groupBy(transaction.accountId, monthKey(transaction.date));
  for (const r of rows) {
    const paymentId = paymentCategoryByAccount.get(r.accountId);
    if (!paymentId) continue;
    const amount = -BigInt(r.amount);
    const list = history.get(paymentId) ?? [];
    list.push({ month: r.month, assigned: 0n, activity: amount, payments: amount });
    history.set(paymentId, list);
  }
}

/**
 * A card line with what the plan needs to place it: its account, its category, and for transfers
 * the line on the other side.
 */
type PlacedCardLine = CardLine & {
  accountId: string;
  categoryId: string | null;
  otherSideId: string | null;
};

/**
 * Every line on a credit account up to `cutoff` (a transaction, or each line of a split), with what
 * kind of money it is for `cardLedger`.
 */
async function cardLines(db: Db, budgetId: string, cutoff: string): Promise<PlacedCardLine[]> {
  const otherAccount = alias(budgetAccount, "other_account");
  const onCard = and(
    eq(transaction.budgetId, budgetId),
    inArray(budgetAccount.type, CREDIT_TYPES),
    lte(transaction.date, cutoff),
  );
  const whole = await db
    .select({
      id: transaction.id,
      date: transaction.date,
      amount: transaction.baseAmount,
      accountId: transaction.accountId,
      categoryId: transaction.categoryId,
      internalKind: category.internalKind,
      otherType: otherAccount.type,
      transferTransactionId: transaction.transferTransactionId,
      transferSubTransactionId: transaction.transferSubTransactionId,
    })
    .from(transaction)
    .innerJoin(budgetAccount, eq(budgetAccount.id, transaction.accountId))
    .leftJoin(category, eq(category.id, transaction.categoryId))
    .leftJoin(payee, eq(payee.id, transaction.payeeId))
    .leftJoin(otherAccount, eq(otherAccount.id, payee.transferAccountId))
    .where(
      and(
        onCard,
        not(
          exists(
            db
              .select({ id: subTransaction.id })
              .from(subTransaction)
              .where(eq(subTransaction.transactionId, transaction.id)),
          ),
        ),
      ),
    );
  const split = await db
    .select({
      id: subTransaction.id,
      transactionId: transaction.id,
      date: transaction.date,
      transactionAmount: transaction.baseAmount,
      lineOrder: subTransaction.sortOrder,
      amount: subTransaction.baseAmount,
      accountId: transaction.accountId,
      categoryId: subTransaction.categoryId,
      internalKind: category.internalKind,
      otherType: otherAccount.type,
    })
    .from(subTransaction)
    .innerJoin(transaction, eq(transaction.id, subTransaction.transactionId))
    .innerJoin(budgetAccount, eq(budgetAccount.id, transaction.accountId))
    .leftJoin(category, eq(category.id, subTransaction.categoryId))
    .leftJoin(payee, eq(payee.id, subTransaction.payeeId))
    .leftJoin(otherAccount, eq(otherAccount.id, payee.transferAccountId))
    .where(onCard);

  const kindOf = (r: {
    categoryId: string | null;
    internalKind: string | null;
    otherType: AccountType | null;
  }): CardLineKind => {
    // A transfer with a budget account: cash ones are payments and advances, credit ones move
    // money between cards. With a tracking account, the card side's category decides.
    if (r.otherType && isOnBudget(r.otherType)) {
      return accountFamily(r.otherType) === "cash" ? "budgetTransfer" : "creditTransfer";
    }
    // No category and no transfer: the card's starting debt.
    if (!r.categoryId) return r.otherType ? "neutral" : "readyToAssign";
    return r.internalKind === "ready_to_assign" ? "readyToAssign" : "category";
  };
  // A split's transfer line doesn't point at its other side; the other side points at it.
  const lineSide = new Map(
    whole.flatMap((r) => (r.transferSubTransactionId ? [[r.transferSubTransactionId, r.id]] : [])),
  );
  return [
    ...whole.map((r) => ({
      id: r.id,
      transactionId: r.id,
      date: r.date,
      transactionAmount: r.amount,
      lineOrder: 0,
      amount: r.amount,
      accountId: r.accountId,
      categoryId: r.categoryId,
      kind: kindOf(r),
      otherSideId: r.transferTransactionId ?? r.transferSubTransactionId,
    })),
    ...split.map((r) => ({
      id: r.id,
      transactionId: r.transactionId,
      date: r.date,
      transactionAmount: r.transactionAmount,
      lineOrder: r.lineOrder,
      amount: r.amount,
      accountId: r.accountId,
      categoryId: r.categoryId,
      kind: kindOf(r),
      otherSideId: lineSide.get(r.id) ?? null,
    })),
  ];
}

/**
 * Places each card's lines in the plan by the card's balance at the time (`cardLedger`):
 * the cash part of category lines moves from credit to cash activity, and Ready to Assign gets what
 * the card's balance above zero adds or takes (instead of every inflow to it), and a transfer from
 * another card is a payment for the part that card paid from above zero. Returns each category's
 * credit activity (and returns' cash parts) per month and day, which funds card spending.
 */
function applyCardLedger(
  history: Map<string, MonthFigures[]>,
  lines: readonly PlacedCardLine[],
  readyToAssignId: string | undefined,
  paymentCategoryByAccount: ReadonlyMap<string, string>,
) {
  const push = (categoryId: string, entry: MonthFigures) =>
    history.set(categoryId, [...(history.get(categoryId) ?? []), entry]);
  const byAccount = new Map<string, PlacedCardLine[]>();
  for (const line of lines) {
    byAccount.set(line.accountId, [...(byAccount.get(line.accountId) ?? []), line]);
  }
  // categoryId → month → each card's credit activity (and returns' cash parts) per day.
  const credit = new Map<string, Map<BudgetMonth, CardActivity[]>>();
  // A sending card's line id → what it paid from above zero.
  const paidFromCash = new Map<string, bigint>();
  // month → what the cards' balances above zero added to Ready to Assign.
  const debt = new Map<BudgetMonth, bigint>();
  const received: PlacedCardLine[] = [];
  for (const [accountId, own] of byAccount) {
    const byId = new Map(own.map((l) => [l.id, l]));
    for (const effect of cardLedger(own)) {
      const line = byId.get(effect.id) as PlacedCardLine;
      const month = monthOf(effect.date);
      if (line.kind === "creditTransfer") {
        if (line.amount < 0n) paidFromCash.set(line.id, effect.paidFromCash);
        else received.push(line);
      }
      if (effect.readyToAssign !== 0n) {
        debt.set(month, (debt.get(month) ?? 0n) + effect.readyToAssign);
      }
      // Inflows to Ready to Assign were counted in full as income; count what the ledger says.
      const counted = line.kind === "readyToAssign" && line.categoryId ? line.amount : 0n;
      if (readyToAssignId && effect.readyToAssign !== counted) {
        push(readyToAssignId, { month, assigned: 0n, activity: effect.readyToAssign - counted });
      }
      if (line.kind !== "category" || !line.categoryId) continue;
      if (effect.cash !== 0n) {
        push(line.categoryId, { month, assigned: 0n, activity: 0n, creditActivity: -effect.cash });
      }
      // A return's part above zero joins the category on its date (`CardActivity.cash`).
      const returned = effect.cash > 0n ? effect.cash : 0n;
      if (effect.credit === 0n && returned === 0n) continue;
      const months = credit.get(line.categoryId) ?? new Map<BudgetMonth, CardActivity[]>();
      const days = months.get(month) ?? [];
      const same = days.find((d) => d.date === effect.date && d.accountId === accountId);
      if (same) {
        same.amount += effect.credit;
        same.cash = (same.cash ?? 0n) + returned;
        if (line.transactionId < same.order) same.order = line.transactionId;
      } else {
        days.push({
          accountId,
          date: effect.date,
          amount: effect.credit,
          cash: returned,
          order: line.transactionId,
        });
      }
      months.set(month, days);
      credit.set(line.categoryId, months);
    }
  }
  for (const line of received) {
    const paid = (line.otherSideId && paidFromCash.get(line.otherSideId)) || 0n;
    const paymentId = paymentCategoryByAccount.get(line.accountId);
    if (!paymentId || paid === 0n) continue;
    push(paymentId, { month: monthOf(line.date), assigned: 0n, activity: -paid, payments: -paid });
  }
  return { credit, debt };
}

/**
 * Adds each payment category's Funded Spending to `history`: for every spending category and month
 * with card activity, what moved into (or, for returns, out of) each card's payment category. What
 * a category has before its card activity doesn't depend on funding, so months are independent.
 */
function addFundedSpending(
  cards: Map<string, Map<BudgetMonth, CardActivity[]>>,
  history: Map<string, MonthFigures[]>,
  paymentCategoryByAccount: ReadonlyMap<string, string>,
  skip: ReadonlySet<string>,
) {
  const funded = new Map<string, MonthFigures[]>();
  /** accountId → month → that card's unfunded spending (credit overspending, positive). */
  const unfunded = new Map<string, Map<BudgetMonth, bigint>>();
  for (const [categoryId, months] of cards) {
    if (skip.has(categoryId)) continue;
    const entries = history.get(categoryId) ?? [];
    for (const [month, days] of months) {
      const figures = categoryMonth(entries, month);
      // Returns' parts above zero come in on their dates, not before the card activity.
      const returned = days.reduce((sum, d) => sum + (d.cash ?? 0n), 0n);
      const cash = figures.carried + figures.assigned + figures.cashActivity - returned;
      const { moved, unfunded: short } = fundedCardSpending(cash, days);
      for (const [accountId, amount] of short) {
        const months = unfunded.get(accountId) ?? new Map<BudgetMonth, bigint>();
        months.set(month, (months.get(month) ?? 0n) + amount);
        unfunded.set(accountId, months);
      }
      for (const [accountId, amount] of moved) {
        const paymentId = paymentCategoryByAccount.get(accountId);
        if (!paymentId || amount === 0n) continue;
        const list = funded.get(paymentId) ?? [];
        list.push({ month, assigned: 0n, activity: amount, fundedSpending: amount });
        funded.set(paymentId, list);
      }
    }
  }
  for (const [paymentId, entries] of funded) {
    history.set(paymentId, [...(history.get(paymentId) ?? []), ...entries]);
  }
  return unfunded;
}

const ZERO: CategoryMonth = {
  carried: 0n,
  assigned: 0n,
  activity: 0n,
  cashActivity: 0n,
  creditActivity: 0n,
  fundedSpending: 0n,
  payments: 0n,
  available: 0n,
  cashOverspent: 0n,
  creditOverspent: 0n,
};

function addTo(sum: CategoryMonth, n: CategoryMonth): CategoryMonth {
  return {
    carried: sum.carried + n.carried,
    assigned: sum.assigned + n.assigned,
    activity: sum.activity + n.activity,
    cashActivity: sum.cashActivity + n.cashActivity,
    creditActivity: sum.creditActivity + n.creditActivity,
    fundedSpending: sum.fundedSpending + n.fundedSpending,
    payments: sum.payments + n.payments,
    cashOverspent: sum.cashOverspent + n.cashOverspent,
    creditOverspent: sum.creditOverspent + n.creditOverspent,
    available: sum.available + n.available,
  };
}

const totalsJson = (n: CategoryMonth) => ({
  assigned: n.assigned.toString(),
  activity: n.activity.toString(),
  cashActivity: n.cashActivity.toString(),
  creditActivity: n.creditActivity.toString(),
  available: n.available.toString(),
  cashOverspent: n.cashOverspent.toString(),
  creditOverspent: n.creditOverspent.toString(),
});

/** The months the budget shows, as of the user's `today`. */
export async function monthRange(db: Db, budgetId: string, today: string) {
  const [earliest] = await db
    .select({ date: min(transaction.date) })
    .from(transaction)
    .where(eq(transaction.budgetId, budgetId));
  const [latest] = await db
    .select({ month: max(categoryAssignment.month) })
    .from(categoryAssignment)
    .where(eq(categoryAssignment.budgetId, budgetId));
  return budgetMonthRange({
    current: monthOf(today),
    earliestTransaction: earliest?.date ? monthOf(earliest.date) : null,
    latestAssigned: latest?.month ? monthOf(latest.month) : null,
  });
}

/** Refuses months the budget doesn't show. */
async function assertMonthInRange(db: Db, budgetId: string, month: BudgetMonth, today: string) {
  const { first, last } = await monthRange(db, budgetId, today);
  if (month < first || month > last) {
    throw new AppError(400, "MONTH_OUT_OF_RANGE", `Money can be assigned from ${first} to ${last}`);
  }
}

/**
 * A category money can be assigned to or moved from: a listed category, or Ready to Assign's
 * internal one (the other end of assigning and removing money).
 */
async function moneyCategory(db: Db, budgetId: string, categoryId: string) {
  const [row] = await db
    .select({ id: category.id, internalKind: category.internalKind })
    .from(category)
    .where(and(eq(category.id, categoryId), eq(category.budgetId, budgetId)));
  if (!row || row.internalKind === "uncategorized") {
    throw new AppError(404, "NOT_FOUND", "Category not found");
  }
  return { id: row.id, readyToAssign: row.internalKind === "ready_to_assign" };
}

type FxDeps = Pick<AppDeps, "fxProviders" | "serverDate">;

interface TargetConversion {
  currency: CurrencyCode;
  amount: bigint;
  amountInBase: bigint;
  rate: string;
}

/**
 * Today's rate (the user's `today`) from each currency targets are set in to the budget's: an
 * override or cached rate for the day, else a provider fetch (cached), else the nearest earlier
 * known rate. Null for a currency with no rate at all. The day's own rate comes before the
 * nearest earlier one, so a target follows the rate as the days go by.
 */
async function targetRates(
  db: Db,
  deps: FxDeps,
  budget: { id: string; currency: CurrencyCode },
  currencies: Iterable<CurrencyCode>,
  today: string,
) {
  const rates = new Map<CurrencyCode, string | null>();
  for (const currency of new Set(currencies)) {
    if (currency === budget.currency) continue;
    try {
      const resolved = await resolveRate(db, deps, {
        budgetId: budget.id,
        from: currency,
        to: budget.currency,
        date: today,
        today,
      });
      rates.set(currency, resolved.rate);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "FX_RATE_UNAVAILABLE") throw error;
      rates.set(currency, null);
    }
  }
  return rates;
}

/**
 * Looks up today's rates for targets in other currencies before a write, so the month it answers
 * with doesn't fetch them while its changes hold locks.
 */
async function prefetchTargetRates(db: Db, deps: FxDeps, budgetId: string, today: string) {
  const rows = await db
    .selectDistinct({ currency: categoryTarget.currency })
    .from(categoryTarget)
    .where(eq(categoryTarget.budgetId, budgetId));
  const currencies = rows.map((r) => r.currency);
  await prefetchRates(db, deps, { budgetId, currencies, dates: [today], today });
}

/**
 * Every category's target in the budget's currency. A target in its own currency asks in the
 * budget's: its amount converted at today's rate, rounded up, before any target math. Without a
 * rate its need is unknown, so it's left out (`rateMissing`).
 */
export async function loadTargets(
  db: Db,
  deps: FxDeps,
  budget: { id: string; currency: CurrencyCode },
  today: string,
) {
  const targetRows = await db
    .select()
    .from(categoryTarget)
    .where(eq(categoryTarget.budgetId, budget.id));
  const rates = await targetRates(
    db,
    deps,
    budget,
    targetRows.map((t) => t.currency),
    today,
  );
  const targets = new Map<string, CategoryTarget>();
  const conversions = new Map<string, TargetConversion>();
  const rateMissing = new Set<string>();
  for (const t of targetRows) {
    const rate = t.currency === budget.currency ? "1" : rates.get(t.currency);
    if (!rate) {
      rateMissing.add(t.categoryId);
      continue;
    }
    const inBase = targetInBase(t, rate, budget.currency);
    targets.set(t.categoryId, { ...inBase, startMonth: monthOf(t.startMonth) });
    if (t.currency !== budget.currency) {
      conversions.set(t.categoryId, {
        currency: t.currency,
        amount: t.amount,
        amountInBase: inBase.amount,
        rate,
      });
    }
  }
  return { targetRows, targets, conversions, rateMissing };
}

/**
 * Everything the budget screen shows for `month`, as of the user's `today`: each category's
 * numbers, target and Auto-Assign amounts, and the month's totals.
 */
export async function monthState(
  db: Db,
  deps: FxDeps,
  budget: { id: string; currency: CurrencyCode; createdAt?: Date },
  month: BudgetMonth,
  today: string,
) {
  const budgetId = budget.id;
  // The budget's first day: the day it was created, or the user's today if that's earlier (the
  // creation time is UTC; behind UTC, a budget made in the evening was created "tomorrow").
  const created = budget.createdAt?.toISOString().slice(0, 10) ?? today;
  const firstDay = created < today ? created : today;
  const { start, end } = monthBounds(month);
  // Transactions dated after the user's today don't count yet.
  const cutoff = end < today ? end : today;
  const { history, paymentAccounts, creditOverspent, debt } = await budgetHistory(
    db,
    budgetId,
    cutoff,
  );
  const upcoming = await upcomingByCategory(db, budgetId, month, today, paymentAccounts, deps);

  const range = await monthRange(db, budgetId, today);

  // In list order (groups, then categories), which is the order Underfunded breaks ties in.
  const categories = await db
    .select({
      id: category.id,
      groupId: category.groupId,
      hidden: category.hidden,
      internalKind: category.internalKind,
      groupHidden: categoryGroup.hidden,
    })
    .from(category)
    .innerJoin(categoryGroup, eq(categoryGroup.id, category.groupId))
    .where(eq(category.budgetId, budgetId))
    .orderBy(categoryGroup.sortOrder, category.sortOrder, category.id);

  const { targetRows, targets, conversions, rateMissing } = await loadTargets(
    db,
    deps,
    budget,
    today,
  );
  // A snooze lasts for the month it was set in.
  const snoozedNow = new Set(
    targetRows
      .filter((t) => t.snoozedMonth && monthOf(t.snoozedMonth) === month)
      .map((t) => t.categoryId),
  );

  // Each card's payment details: what's owed at the end of the month (up to today) against what's
  // set aside, and how much of the shortfall is this month's credit overspending.
  // In the budget's currency: a foreign card owes what its spending was booked at (Σ base amounts).
  const balances = await accountBalances(db, budgetId, cutoff, "base");
  // The card's month in its register: what it owed before, and its outflows and inflows since,
  // and whether any of the month's transactions are uncategorized.
  const uncategorizedId = categories.find((c) => c.internalKind === "uncategorized")?.id ?? "";
  const cardMonth = await db
    .select({
      accountId: transaction.accountId,
      uncategorized: sql<number>`count(*) filter (where ${transaction.date} >= ${start} and ${transaction.categoryId} = ${uncategorizedId})`,
      prior: sql<string>`coalesce(sum(${transaction.baseAmount}) filter (where ${transaction.date} < ${start}), 0)`,
      outflows: sql<string>`coalesce(sum(${transaction.baseAmount}) filter (where ${transaction.date} >= ${start} and ${transaction.baseAmount} < 0), 0)`,
      inflows: sql<string>`coalesce(sum(${transaction.baseAmount}) filter (where ${transaction.date} >= ${start} and ${transaction.baseAmount} > 0), 0)`,
    })
    .from(transaction)
    .innerJoin(budgetAccount, eq(budgetAccount.id, transaction.accountId))
    .where(
      and(
        eq(transaction.budgetId, budgetId),
        inArray(budgetAccount.type, CREDIT_TYPES),
        lte(transaction.date, cutoff),
      ),
    )
    .groupBy(transaction.accountId);
  const register = new Map(cardMonth.map((r) => [r.accountId, r]));
  // Each card's opening month: the month of its first transaction (the Starting Balance).
  const openedRows = await db
    .select({ accountId: transaction.accountId, date: min(transaction.date) })
    .from(transaction)
    .innerJoin(budgetAccount, eq(budgetAccount.id, transaction.accountId))
    .where(and(eq(transaction.budgetId, budgetId), inArray(budgetAccount.type, CREDIT_TYPES)))
    .groupBy(transaction.accountId);
  const openedMonth = new Map(
    openedRows.flatMap((r) => (r.date ? [[r.accountId, monthOf(r.date)] as const] : [])),
  );
  const accountOf = new Map([...paymentAccounts].map(([accountId, id]) => [id, accountId]));
  const paymentOf = (categoryId: string, figures: CategoryMonth) => {
    const accountId = accountOf.get(categoryId);
    if (!accountId) return null;
    const balance = balances.get(accountId)?.working ?? 0n;
    const owed = balance < 0n ? -balance : 0n;
    // What's underfunded is the debt Available doesn't reach. A negative Available (overpayment,
    // red cash overspending) adds to it while the card still owes: owing $90.00 at −$10.00 is
    // $100.00 underfunded.
    const setAside = owed > 0n || figures.available > 0n ? figures.available : 0n;
    const underfunded = owed > setAside ? owed - setAside : 0n;
    const overspentNow = creditOverspent.get(accountId)?.get(month) ?? 0n;
    const fromOverspending = overspentNow < underfunded ? overspentNow : underfunded;
    return { accountId, balance, owed, underfunded, fromOverspending, overspentNow };
  };

  // A payment target asks nothing in months before its card was opened.
  const beforeOpening = (
    accountId: string | undefined,
    need: TargetNeed | null,
    m: BudgetMonth = month,
  ): TargetNeed | null => {
    const opened = accountId && openedMonth.get(accountId);
    if (!need || !opened || m >= opened) return need;
    return { ...need, underfunded: 0n, monthAmount: 0n };
  };

  const listed: {
    categoryId: string;
    figures: CategoryMonth;
    auto: Record<AutoAssignOption, bigint>;
    need: TargetNeed | null;
    conversion: TargetConversion | null;
    rateMissing: boolean;
    snoozed: boolean;
    bar: ProgressBar | null;
    payment: ReturnType<typeof paymentOf>;
    /** A payment category in a month before its card was opened. */
    beforeOpening: boolean;
    funding: CategoryFunding;
    upcoming: CategoryUpcoming | null;
    hidden: boolean;
  }[] = [];
  const groups = new Map<string, CategoryMonth>();
  let hidden = ZERO;
  let uncategorized: CategoryMonth | null = null;
  const income: MonthAmount[] = [];
  const assigned: MonthAmount[] = [];
  const overspent: MonthAmount[] = [];
  const nextMonth = addMonths(month, 1);
  const monthTargets = { month: 0n, nextMonth: 0n };
  // Each later month the panel lists (money assigned there, and always next month): how much its
  // targets need and how much of that is funded, for the pie or check by the month.
  const futureTargets = new Map<BudgetMonth, { needed: bigint; funded: bigint }>([
    [nextMonth, { needed: 0n, funded: 0n }],
  ]);
  for (const entries of history.values()) {
    for (const e of entries) {
      if (e.month > month && e.assigned !== 0n && !futureTargets.has(e.month)) {
        futureTargets.set(e.month, { needed: 0n, funded: 0n });
      }
    }
  }
  for (const cat of categories) {
    const entries = history.get(cat.id) ?? [];
    if (cat.internalKind === "ready_to_assign") {
      income.push(...entries.map((e) => ({ month: e.month, amount: e.activity })));
      continue;
    }
    // Cash overspending comes out of the next month's Ready to Assign, hidden categories and
    // Uncategorized included; credit overspending is new card debt and doesn't.
    overspent.push(...categoryOverspending(entries));
    assigned.push(...entries.map((e) => ({ month: e.month, amount: e.assigned })));
    const figures = categoryMonth(entries, month);
    if (cat.internalKind === "uncategorized") {
      // Listed only in months with uncategorized transactions.
      if (entries.some((e) => e.month === month)) uncategorized = figures;
      continue;
    }
    const isHidden = cat.hidden || cat.groupHidden;
    const target = targets.get(cat.id) ?? null;
    const payment = paymentOf(cat.id, figures);
    // A payment target pays toward what the card owes; next month starts from the same balance.
    const owed = payment?.owed ?? 0n;
    const need = beforeOpening(
      payment?.accountId,
      target && targetNeed(entries, target, month, monthOf(today), owed),
    );
    // Credit card payment targets can't be snoozed.
    const snoozed = !payment && snoozedNow.has(cat.id);
    const coming = upcoming.get(cat.id) ?? null;
    const funded = payment
      ? paymentFunding(figures.available, payment.owed, payment.fromOverspending, need, coming)
      : spendingFunding(month, figures.available, target, need, snoozed, coming);
    const funding =
      month === monthOf(firstDay)
        ? { ...funded, parts: afterStart(funded.parts, firstDay) }
        : funded;
    if (target && !isHidden) {
      for (const [m, sums] of futureTargets) {
        const n = beforeOpening(
          payment?.accountId,
          targetNeed(entries, target, m, monthOf(today), owed),
          m,
        );
        // A one-time target past its due month asks for nothing there.
        if (!n || n.needed <= 0n || (n.dueDate && monthOf(n.dueDate) < m)) continue;
        sums.needed += n.needed;
        sums.funded += n.funded < 0n ? 0n : n.funded < n.needed ? n.funded : n.needed;
      }
      monthTargets.month += need?.monthAmount ?? 0n;
      monthTargets.nextMonth +=
        beforeOpening(
          payment?.accountId,
          targetNeed(entries, target, nextMonth, monthOf(today), owed),
          nextMonth,
        )?.monthAmount ?? 0n;
    }
    listed.push({
      categoryId: cat.id,
      figures,
      auto: {
        ...autoAssignAmounts(entries, month),
        underfunded: figures.assigned + funding.underfunded,
        reduceOverfunding: figures.assigned - funding.overfunded,
      },
      need,
      conversion: conversions.get(cat.id) ?? null,
      rateMissing: rateMissing.has(cat.id),
      snoozed,
      bar: payment
        ? null
        : progressBar(
            figures,
            target,
            need,
            snoozed,
            month,
            target ? periodRollover(entries, target, month) : 0n,
          ),
      payment,
      beforeOpening: !!payment && (openedMonth.get(payment.accountId) ?? month) > month,
      funding,
      upcoming: coming,
      hidden: isHidden,
    });
    if (isHidden) {
      hidden = addTo(hidden, figures);
    } else {
      groups.set(cat.groupId, addTo(groups.get(cat.groupId) ?? ZERO, figures));
    }
  }
  const groupRows = await db
    .select({ id: categoryGroup.id })
    .from(categoryGroup)
    .where(and(eq(categoryGroup.budgetId, budgetId), eq(categoryGroup.internal, false)))
    .orderBy(categoryGroup.sortOrder, categoryGroup.id);

  const rta = readyToAssign({ month, income, assigned, overspent });
  const debtIncome = [...debt].map(([m, amount]) => ({ month: m, amount }));
  const breakdown = readyToAssignBreakdown({
    month,
    income,
    debt: debtIncome,
    assigned,
    overspent,
  });
  return {
    breakdown,
    range,
    listed,
    groupRows,
    groups,
    hidden,
    uncategorized,
    income,
    assigned,
    overspent,
    rta,
    register,
    monthTargets,
    futureTargets,
  };
}

/**
 * The first later month whose Ready to Assign is negative (only the first is named when several
 * are). Later months have no transactions yet, so only months with money assigned can go negative.
 */
function futureShortfall(
  state: Pick<Awaited<ReturnType<typeof monthState>>, "income" | "assigned" | "overspent">,
  future: ReadonlyMap<BudgetMonth, bigint>,
) {
  for (const m of [...future.keys()].sort()) {
    const { readyToAssign: amount } = readyToAssign({ month: m, ...state });
    if (amount < 0n) return { month: m, readyToAssign: amount.toString() };
  }
  return null;
}

/** A later month's targets for the panel, or null when it has none. */
function futureTargetsJson(sums: { needed: bigint; funded: bigint } | undefined) {
  return sums && sums.needed > 0n
    ? { needed: sums.needed.toString(), funded: sums.funded.toString() }
    : null;
}

/** The budget screen's numbers for `month`, as of the user's `today`. */
export async function budgetMonthJson(
  db: Db,
  deps: FxDeps,
  budget: { id: string; currency: CurrencyCode; expectedIncome?: bigint | null; createdAt?: Date },
  month: BudgetMonth,
  today: string,
) {
  const state = await monthState(db, deps, budget, month, today);
  const { range, listed, groupRows, groups, hidden, uncategorized, rta, register } = state;
  const future = new Map<BudgetMonth, bigint>();
  for (const a of state.assigned) {
    if (a.month > month) future.set(a.month, (future.get(a.month) ?? 0n) + a.amount);
  }

  return {
    month,
    currency: budget.currency,
    firstMonth: range.first,
    lastMonth: range.last,
    readyToAssign: rta.readyToAssign.toString(),
    overdraft: isOverdraft(
      rta.readyToAssign,
      listed.map((l) => l.figures),
    ),
    assignedInFuture: rta.assignedInFuture.toString(),
    readyToAssignBreakdown: {
      leftOver: state.breakdown.leftOver.toString(),
      inflows: state.breakdown.inflows.toString(),
      debtInflows: state.breakdown.debtInflows.toString(),
      cashOverspending: state.breakdown.cashOverspending.toString(),
      assigned: state.breakdown.assigned.toString(),
      assignedInFuture: state.breakdown.assignedInFuture.toString(),
      total: state.breakdown.total.toString(),
    },
    futureMonths: [...future]
      .filter(([, amount]) => amount !== 0n)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([m, amount]) => ({
        month: m,
        assigned: amount.toString(),
        targets: futureTargetsJson(state.futureTargets.get(m)),
      })),
    nextMonthTargets: futureTargetsJson(state.futureTargets.get(addMonths(month, 1))),
    note:
      (
        await db
          .select({ note: monthNote.note })
          .from(monthNote)
          .where(and(eq(monthNote.budgetId, budget.id), eq(monthNote.month, `${month}-01`)))
      )[0]?.note ?? "",
    futureShortfall: futureShortfall(state, future),
    categories: listed.map((l) => {
      const reg = l.payment && register.get(l.payment.accountId);
      return {
        categoryId: l.categoryId,
        ...totalsJson(l.figures),
        payment: l.payment && {
          balance: l.payment.balance.toString(),
          priorBalance: reg?.prior ?? "0",
          spendingAndOutflows: reg?.outflows ?? "0",
          paymentsAndInflows: reg?.inflows ?? "0",
          underfunded: l.payment.underfunded.toString(),
          overspentCategories: l.payment.fromOverspending.toString(),
          creditOverspending: l.payment.overspentNow.toString(),
          fundedSpending: l.figures.fundedSpending.toString(),
          paymentsMade: l.figures.payments.toString(),
          hasUncategorized: Number(reg?.uncategorized ?? 0) > 0,
        },
        target: l.need && {
          needed: l.need.needed.toString(),
          funded: l.need.funded.toString(),
          underfunded: l.need.underfunded.toString(),
          dueDate: l.need.dueDate,
          // Only a one-time target's due date can be before the month it's shown in.
          pastDue: l.need.dueDate !== null && monthOf(l.need.dueDate) < month,
          snoozed: l.snoozed,
          beforeOpening: l.beforeOpening,
        },
        targetConversion: l.conversion && {
          currency: l.conversion.currency,
          amount: l.conversion.amount.toString(),
          amountInBase: l.conversion.amountInBase.toString(),
          rate: l.conversion.rate,
        },
        targetRateMissing: l.rateMissing,
        bar: l.bar && {
          tone: l.bar.tone,
          sections: l.bar.sections.map((section) => ({
            kind: section.kind,
            size: section.size.toString(),
            segments: section.segments.map((g) => ({ kind: g.kind, amount: g.amount.toString() })),
          })),
        },
        autoAssign: Object.fromEntries(
          Object.entries(l.auto).map(([option, amount]) => [option, amount.toString()]),
        ) as Record<AutoAssignOption, string>,
        underfundedParts: l.funding.parts.map((p) => ({
          amount: p.amount.toString(),
          step: p.step,
          date: p.date,
        })),
        upcoming: l.upcoming && {
          amount: l.upcoming.amount.toString(),
          transactions: l.upcoming.transactions.map((t) => ({
            scheduleId: t.scheduleId,
            accountId: t.accountId,
            accountName: t.accountName,
            date: t.date,
            payeeName: t.payeeName,
            memo: t.memo,
            amount: t.amount.toString(),
          })),
        },
      };
    }),
    groups: groupRows.map((g) => ({ groupId: g.id, ...totalsJson(groups.get(g.id) ?? ZERO) })),
    hidden: totalsJson(hidden),
    uncategorized: uncategorized && {
      activity: uncategorized.activity.toString(),
      cashActivity: uncategorized.cashActivity.toString(),
      creditActivity: uncategorized.creditActivity.toString(),
      available: uncategorized.available.toString(),
      cashOverspent: uncategorized.cashOverspent.toString(),
      creditOverspent: uncategorized.creditOverspent.toString(),
    },
    targets: {
      month: state.monthTargets.month.toString(),
      nextMonth: state.monthTargets.nextMonth.toString(),
      expectedIncome: budget.expectedIncome?.toString() ?? null,
    },
  };
}

export const getBudgetMonthHandler: RouteHandler<typeof getBudgetMonth, Env> = async (c) => {
  const { budgetId, month } = c.req.valid("param");
  const query = c.req.valid("query");
  const today = userToday(c.var.deps, query.today);
  const { budget } = await loadBudgetAccess(c, budgetId);
  if (query.today)
    await enterDueScheduled(
      c.var.deps.db,
      c.var.deps,
      budgetId,
      entryDate(c.var.deps, query.today),
    );
  return c.json(await budgetMonthJson(c.var.deps.db, c.var.deps, budget, month, today), 200);
};

export const setMonthNoteHandler: RouteHandler<typeof setMonthNote, Env> = async (c) => {
  const { budgetId, month } = c.req.valid("param");
  const { note } = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { budget: ["assign"] });
  const day = `${month}-01`;
  if (note.trim() === "") {
    await db
      .delete(monthNote)
      .where(and(eq(monthNote.budgetId, budgetId), eq(monthNote.month, day)));
    return c.json({ month, note: "" }, 200);
  }
  await db
    .insert(monthNote)
    .values({ id: newId(), budgetId, month: day, note })
    .onConflictDoUpdate({
      target: [monthNote.budgetId, monthNote.month],
      set: { note, updatedAt: sql`now()` },
    });
  return c.json({ month, note }, 200);
};

export const assignCategoryHandler: RouteHandler<typeof assignCategory, Env> = async (c) => {
  const { budgetId, month, categoryId } = c.req.valid("param");
  const { assigned, expectedAssigned, today: rawToday } = c.req.valid("json");
  const { db } = c.var.deps;
  const today = userToday(c.var.deps, rawToday);
  const { budget } = await loadBudgetAccess(c, budgetId, { budget: ["assign"] });

  const target = await moneyCategory(db, budgetId, categoryId);
  if (target.readyToAssign) throw new AppError(404, "NOT_FOUND", "Category not found");
  await assertMonthInRange(db, budgetId, month, today);
  await prefetchTargetRates(db, c.var.deps, budgetId, today);

  await db.transaction(async (tx) => {
    const current = await assignedAmount(tx, categoryId, month, { lock: true });
    if (expectedAssigned !== undefined && current !== BigInt(expectedAssigned)) {
      const row = await assignmentRow(tx, categoryId, month);
      const by = row ? await lastAssignedBy(tx, budgetId, row.id) : null;
      throw await staleVersion(tx, by, c.var.user.id, "assigned amount");
    }
    const delta = BigInt(assigned) - current;
    await adjustAssigned(tx, budget, categoryId, month, delta);
    if (delta === 0n) return;
    const readyToAssignId = await internalCategoryId(tx, budgetId, "ready_to_assign");
    await logMove(tx, budget, {
      userId: c.var.user.id,
      fromCategoryId: delta > 0n ? readyToAssignId : categoryId,
      toCategoryId: delta > 0n ? categoryId : readyToAssignId,
      month,
      amount: delta > 0n ? delta : -delta,
    });
  });
  return c.json(await budgetMonthJson(db, c.var.deps, budget, month, today), 200);
};

export const moveMoneyHandler: RouteHandler<typeof moveMoney, Env> = async (c) => {
  const { budgetId, month } = c.req.valid("param");
  const {
    fromCategoryId,
    toCategoryId,
    amount,
    fromMonth = month,
    today: rawToday,
  } = c.req.valid("json");
  const { db } = c.var.deps;
  const today = userToday(c.var.deps, rawToday);
  const { budget } = await loadBudgetAccess(c, budgetId, { budget: ["assign"] });

  const from = await moneyCategory(db, budgetId, fromCategoryId);
  const to = await moneyCategory(db, budgetId, toCategoryId);
  if (from.id === to.id && fromMonth === month) {
    throw new AppError(400, "BAD_REQUEST", "Money has to move to another category");
  }
  const value = BigInt(amount);
  if (value <= 0n) throw new AppError(400, "BAD_REQUEST", "Move a positive amount");
  await assertMonthInRange(db, budgetId, month, today);
  if (fromMonth !== month) await assertMonthInRange(db, budgetId, fromMonth, today);
  await prefetchTargetRates(db, c.var.deps, budgetId, today);

  // Moving money changes what each side has assigned; Ready to Assign follows from that. Covering
  // from a later month takes it off that month's Assigned.
  await db.transaction(async (tx) => {
    if (!from.readyToAssign) await adjustAssigned(tx, budget, from.id, fromMonth, -value);
    if (!to.readyToAssign) await adjustAssigned(tx, budget, to.id, month, value);
    if (fromMonth === month) {
      await logMove(tx, budget, {
        userId: c.var.user.id,
        fromCategoryId: from.id,
        toCategoryId: to.id,
        month,
        amount: value,
      });
      return;
    }
    // Across months each side is logged in its own month: removed there, assigned here.
    const readyToAssignId = await internalCategoryId(tx, budgetId, "ready_to_assign");
    const log = (fromId: string, toId: string, m: BudgetMonth) =>
      fromId === toId
        ? Promise.resolve()
        : logMove(tx, budget, {
            userId: c.var.user.id,
            fromCategoryId: fromId,
            toCategoryId: toId,
            month: m,
            amount: value,
          });
    await log(from.id, readyToAssignId, fromMonth);
    await log(readyToAssignId, to.id, month);
  });
  return c.json(await budgetMonthJson(db, c.var.deps, budget, month, today), 200);
};

export const autoAssignHandler: RouteHandler<typeof autoAssign, Env> = async (c) => {
  const { budgetId, month } = c.req.valid("param");
  const { option, categoryIds, scope, today: rawToday } = c.req.valid("json");
  const { db } = c.var.deps;
  const today = userToday(c.var.deps, rawToday);
  const { budget } = await loadBudgetAccess(c, budgetId, { budget: ["assign"] });
  await assertMonthInRange(db, budgetId, month, today);

  const state = await monthState(db, c.var.deps, budget, month, today);
  // The listed categories asked for, or every one that isn't hidden.
  const wanted = categoryIds && new Set(categoryIds);
  const covered = state.listed.filter((l) => (wanted ? wanted.has(l.categoryId) : !l.hidden));
  if (wanted && covered.length !== wanted.size) {
    throw new AppError(404, "NOT_FOUND", "Category not found");
  }

  // What each category's Assigned becomes. Underfunded over the whole plan or a view funds until
  // Ready to Assign runs out (`fundUnderfunded`); on a selection it funds every category in full.
  const goal = new Map(covered.map((l) => [l.categoryId, l.auto[option]]));
  if (option === "underfunded" && (!wanted || scope === "view")) {
    const given = fundUnderfunded(
      covered.map((l) => ({ categoryId: l.categoryId, parts: l.funding.parts })),
      state.rta.readyToAssign,
    );
    for (const l of covered) {
      goal.set(l.categoryId, l.figures.assigned + (given.get(l.categoryId) ?? 0n));
    }
  }

  await db.transaction(async (tx) => {
    const readyToAssignId = await internalCategoryId(tx, budgetId, "ready_to_assign");
    // One Auto-Assign is listed as a single "auto-assigned … to N categories" move.
    const autoAssign = { batchId: newId(), method: option };
    for (const [id, target] of goal) {
      const delta = target - (await assignedAmount(tx, id, month));
      if (delta === 0n) continue;
      await adjustAssigned(tx, budget, id, month, delta);
      await logMove(tx, budget, {
        userId: c.var.user.id,
        fromCategoryId: delta > 0n ? readyToAssignId : id,
        toCategoryId: delta > 0n ? id : readyToAssignId,
        month,
        amount: delta > 0n ? delta : -delta,
        autoAssign,
      });
    }
  });
  return c.json(await budgetMonthJson(db, c.var.deps, budget, month, today), 200);
};

/**
 * Money moves as the API lists them, newest first: Recent Moves' (every move since `since`) or a
 * category history's (every move into or out of a category in one month).
 */
async function movesJson(
  db: Db,
  budgetId: string,
  where: { since: Date } | { month: BudgetMonth },
) {
  const readyToAssignId = await internalCategoryId(db, budgetId, "ready_to_assign");
  const rows = await db
    .select({
      id: moneyMove.id,
      fromCategoryId: moneyMove.fromCategoryId,
      toCategoryId: moneyMove.toCategoryId,
      fromCategoryName: moneyMove.fromCategoryName,
      toCategoryName: moneyMove.toCategoryName,
      deletion: moneyMove.deletion,
      month: moneyMove.month,
      amount: moneyMove.amount,
      createdAt: moneyMove.createdAt,
      autoAssignBatchId: moneyMove.autoAssignBatchId,
      autoAssignMethod: moneyMove.autoAssignMethod,
      userId: moneyMove.userId,
      userName: user.name,
      userPicture: pictureUrlSql(user.id),
      memberRole: budgetMember.role,
    })
    .from(moneyMove)
    .leftJoin(user, eq(user.id, moneyMove.userId))
    .leftJoin(
      budgetMember,
      and(eq(budgetMember.budgetId, moneyMove.budgetId), eq(budgetMember.userId, moneyMove.userId)),
    )
    .where(
      and(
        eq(moneyMove.budgetId, budgetId),
        "since" in where
          ? gte(moneyMove.createdAt, where.since)
          : eq(moneyMove.month, `${where.month}-01`),
      ),
    )
    .orderBy(desc(moneyMove.createdAt), desc(moneyMove.id));
  const colors = await memberAvatarColors(db, budgetId);
  return rows.map((m) => {
    const fromReady = m.fromCategoryId === readyToAssignId;
    const toReady = m.toCategoryId === readyToAssignId;
    return {
      id: m.id,
      kind: toReady
        ? ("removed" as const)
        : fromReady && !m.deletion
          ? ("assigned" as const)
          : ("moved" as const),
      fromCategoryId: fromReady ? null : m.fromCategoryId,
      toCategoryId: toReady ? null : m.toCategoryId,
      fromDeletedCategory: m.fromCategoryId ? null : m.fromCategoryName,
      toDeletedCategory: m.toCategoryId ? null : m.toCategoryName,
      deletion: m.deletion,
      month: monthOf(m.month),
      amount: m.amount.toString(),
      movedAt: m.createdAt.toISOString(),
      autoAssign:
        m.autoAssignBatchId && m.autoAssignMethod
          ? { batchId: m.autoAssignBatchId, method: m.autoAssignMethod }
          : null,
      userId: m.userId,
      userName: m.userName,
      memberRole: m.memberRole,
      avatarColor: (m.userId && colors.get(m.userId)?.color) || null,
      removed: !m.memberRole,
      picture: m.userPicture,
    };
  });
}

export const listMovesHandler: RouteHandler<typeof listMoves, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId);
  const since = new Date(Date.now() - RECENT_MOVES_DAYS * 24 * 60 * 60 * 1000);
  return c.json({ moves: await movesJson(db, budgetId, { since }) }, 200);
};

export const listMonthMovesHandler: RouteHandler<typeof listMonthMoves, Env> = async (c) => {
  const { budgetId, month } = c.req.valid("param");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId);
  return c.json({ moves: await movesJson(db, budgetId, { month }) }, 200);
};

/** Recent Moves covers the previous 34 days of assigning and moving money. */
const RECENT_MOVES_DAYS = 34;

export const setExpectedIncomeHandler: RouteHandler<typeof setExpectedIncome, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { amount } = c.req.valid("json");
  const { db } = c.var.deps;
  // A planning number like Assigned, so whoever can assign can set it.
  const { budget: row } = await loadBudgetAccess(c, budgetId, { budget: ["assign"] });
  await db
    .update(budgetTable)
    .set({ expectedIncome: BigInt(amount), expectedIncomeCurrency: row.currency })
    .where(eq(budgetTable.id, budgetId));
  return c.json({ expectedIncome: amount }, 200);
};
