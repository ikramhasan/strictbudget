import { type Database, newId, sql } from "@strictbudget/db";
import {
  budgetAccount,
  category,
  type FlagColor,
  payee,
  scheduledSubTransaction,
  scheduledTransaction,
} from "@strictbudget/db/schema";
import {
  accountFamily,
  type BudgetMonth,
  type CurrencyCode,
  firstOccurrenceAfter,
  isOnBudget,
  monthBounds,
  monthOf,
  nextOccurrence,
  occurrencesBetween,
  type ScheduleFrequency,
  type SearchSettings,
  type SearchTerm,
  usesCategory as usesAccountCategory,
} from "@strictbudget/engine";
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import {
  type AccountRow,
  assertOpen,
  assertSameCurrency,
  assertTransferPair,
  clearedOnEntry,
  findAccount,
  insertOtherSide,
  resolveCategory,
  usesCategory,
} from "../routes/transactions/rules";
import {
  assertLinesAddUp,
  assertSplitAllowed,
  type LineInput,
  syncLines,
} from "../routes/transactions/splits";
import type { AppDeps } from "../types";
import { budgetCurrencyOf, type FxDeps, linesToBase, toBase } from "./base-amount";
import { shiftDay } from "./dates";
import { AppError } from "./errors";
import { knownRate, resolveRate } from "./fx";
import {
  type Db,
  findOrCreatePayee,
  insertTransaction,
  serverToday,
  transferPayeeId,
} from "./ledger";

export type ScheduleRow = typeof scheduledTransaction.$inferSelect;

// Entered occurrences start out like any new transaction.
export { clearedOnEntry };

async function scheduleLines(db: Db, scheduleIds: readonly string[]) {
  if (scheduleIds.length === 0) return [];
  return db
    .select({
      id: scheduledSubTransaction.id,
      scheduledTransactionId: scheduledSubTransaction.scheduledTransactionId,
      amount: scheduledSubTransaction.amount,
      payeeId: scheduledSubTransaction.payeeId,
      payeeName: payee.name,
      transferAccountId: payee.transferAccountId,
      categoryId: scheduledSubTransaction.categoryId,
      categoryName: category.name,
      memo: scheduledSubTransaction.memo,
    })
    .from(scheduledSubTransaction)
    .leftJoin(payee, eq(payee.id, scheduledSubTransaction.payeeId))
    .leftJoin(category, eq(category.id, scheduledSubTransaction.categoryId))
    .where(inArray(scheduledSubTransaction.scheduledTransactionId, [...scheduleIds]))
    .orderBy(asc(scheduledSubTransaction.sortOrder), asc(scheduledSubTransaction.id));
}

async function transferAccountOf(db: Db, payeeId: string | null) {
  if (!payeeId) return null;
  const [row] = await db
    .select({ transferAccountId: payee.transferAccountId })
    .from(payee)
    .where(eq(payee.id, payeeId));
  return row?.transferAccountId ?? null;
}

/**
 * Turns one occurrence of `schedule` into a transaction dated `date` (with its transfer's other
 * side and its split's lines), and returns the transaction's id. Due occurrences are entered
 * unapproved and Enter Now's approved. A transfer into a closed account is still entered.
 */
export async function enterOccurrence(
  tx: Db,
  fx: FxDeps,
  schedule: ScheduleRow,
  date: string,
  approved: boolean,
) {
  const { budgetId } = schedule;
  const account = await findAccount(tx, budgetId, schedule.accountId);
  const transferId = await transferAccountOf(tx, schedule.payeeId);
  const transferTo = transferId ? await findAccount(tx, budgetId, transferId) : null;
  const lines = await scheduleLines(tx, [schedule.id]);
  // A transfer's one category belongs to whichever side uses categories.
  const ownCategory = transferTo && !usesCategory(account, transferTo) ? null : schedule.categoryId;
  const id = await insertTransaction(tx, {
    budgetId,
    accountId: account.id,
    date,
    amount: schedule.amount,
    currency: account.currency,
    fx,
    split: lines.length > 0,
    payeeId: schedule.payeeId,
    categoryId:
      lines.length > 0
        ? null
        : await resolveCategory(tx, budgetId, account, transferTo, ownCategory),
    memo: schedule.memo,
    cleared: clearedOnEntry(account),
    approved,
    flag: schedule.flag,
  });
  if (lines.length > 0) {
    await syncLines(
      tx,
      {
        budgetId,
        parentId: id,
        date,
        account,
        moved: false,
        counterpart: { cleared: clearedOnEntry, approved },
        fx,
      },
      lines.map(
        (l): LineInput => ({
          amount: l.amount.toString(),
          payeeName: null,
          ...(l.transferAccountId
            ? { transferAccountId: l.transferAccountId }
            : { payeeId: l.payeeId }),
          categoryId: l.categoryId,
          memo: l.memo,
        }),
      ),
    );
  }
  if (transferTo) {
    await insertOtherSide(
      tx,
      { id, budgetId, date, amount: schedule.amount, memo: schedule.memo },
      account,
      transferTo,
      {
        categoryId: usesCategory(transferTo, account) ? schedule.categoryId : null,
        cleared: clearedOnEntry(transferTo),
        approved,
        fx,
      },
    );
  }
  return id;
}

/** Moves the schedule to its occurrence after `current`; a one-off is done and deleted. */
async function advance(tx: Db, schedule: ScheduleRow, current: string) {
  const next = nextOccurrence(schedule.frequency, schedule.dateFirst, current);
  if (next === null) {
    await tx.delete(scheduledTransaction).where(eq(scheduledTransaction.id, schedule.id));
  } else {
    await tx
      .update(scheduledTransaction)
      .set({ dateNext: next })
      .where(eq(scheduledTransaction.id, schedule.id));
  }
  return next;
}

/**
 * The user's `today` as far as entering schedules goes: held within a day of the server's UTC date
 * (time zones run from −12h to +14h), so a wrong device clock or a made-up `today` can't enter
 * years of occurrences at once.
 */
export function entryDate(deps: Pick<AppDeps, "serverDate">, today: string) {
  const server = deps.serverDate ? deps.serverDate() : serverToday();
  if (server === null) return today;
  const earliest = shiftDay(server, -1);
  const latest = shiftDay(server, 1);
  return today < earliest ? earliest : today > latest ? latest : today;
}

/**
 * Enters every occurrence due by the user's `today` (each missed one, dated its own date and
 * unapproved) and moves each schedule past it. Idempotent and safe to run from concurrent
 * requests: due schedules are locked, and ones another request holds are skipped (that request
 * enters them). Schedules in closed accounts wait and catch up on every missed date once the
 * account is reopened.
 */
export async function enterDueScheduled(db: Database, fx: FxDeps, budgetId: string, today: string) {
  const due = and(
    eq(scheduledTransaction.budgetId, budgetId),
    lte(scheduledTransaction.dateNext, today),
    eq(budgetAccount.closed, false),
  );
  const [any] = await db
    .select({ id: scheduledTransaction.id })
    .from(scheduledTransaction)
    .innerJoin(budgetAccount, eq(budgetAccount.id, scheduledTransaction.accountId))
    .where(due)
    .limit(1);
  if (!any) return;
  await db.transaction(async (tx) => {
    // Entered on someone's read, not by them: logged with no actor.
    await tx.execute(
      sql`select set_config('strictbudget.source', 'scheduled', true) where strictbudget_setting('actor_id') is null`,
    );
    const rows = await tx
      .select({ schedule: scheduledTransaction })
      .from(scheduledTransaction)
      .innerJoin(budgetAccount, eq(budgetAccount.id, scheduledTransaction.accountId))
      .where(due)
      .orderBy(asc(scheduledTransaction.dateNext), asc(scheduledTransaction.id))
      .for("update", { of: scheduledTransaction, skipLocked: true });
    for (const { schedule } of rows) {
      let date: string | null = schedule.dateNext;
      while (date !== null && date <= today) {
        const day = date;
        // A foreign account's occurrence with no rate available waits (still due) until one is,
        // so a missing rate never stops the reads that enter schedules.
        const entered = await tx
          .transaction(async (sp) => {
            await enterOccurrence(sp, fx, schedule, day, false);
            return true;
          })
          .catch((error: unknown) => {
            if (error instanceof AppError && error.code === "FX_RATE_UNAVAILABLE") return false;
            throw error;
          });
        if (!entered) break;
        date = await advance(tx, schedule, date);
      }
    }
  });
}

/** Enter Now: the next occurrence, dated `today` and approved; the schedule moves on. */
export async function enterNow(tx: Db, fx: FxDeps, schedule: ScheduleRow, today: string) {
  const id = await enterOccurrence(tx, fx, schedule, today, true);
  await advance(tx, schedule, schedule.dateNext);
  return id;
}

/** A schedule as the API receives it (create, or the full state after an edit). */
export interface ScheduleInput {
  accountId: string;
  frequency: ScheduleFrequency;
  date: string;
  dateFirst: string;
  amount: bigint;
  payee: { name: string | null } | { id: string | null } | { transferAccountId: string };
  categoryId: string | null;
  memo: string;
  flag: FlagColor | null;
  lines: LineInput[] | null;
}

/**
 * The category a schedule is stored with: its own account's, or for a transfer whose own side
 * takes none (tracking to budget), the other side's. Same rules as on transactions otherwise.
 */
async function scheduleCategory(
  db: Db,
  budgetId: string,
  account: AccountRow,
  transferTo: AccountRow | null,
  categoryId: string | null,
) {
  if (transferTo && !usesCategory(account, transferTo) && usesCategory(transferTo, account)) {
    return resolveCategory(db, budgetId, transferTo, account, categoryId);
  }
  return resolveCategory(db, budgetId, account, transferTo, categoryId);
}

/**
 * Checks `input` with the rules transactions follow and writes it, as a new schedule or over
 * `existing.id`. New transfers need both accounts open; one that already points at a closed
 * account (an edited schedule, or a transaction being rescheduled) keeps it. `restore` (an undo
 * putting a schedule back) skips the open-account checks.
 */
export async function writeSchedule(
  tx: Db,
  budgetId: string,
  input: ScheduleInput,
  existing?: {
    id?: string;
    transferAccountId: string | null;
    accountId: string;
    restore?: boolean;
  },
) {
  const restore = existing?.restore === true;
  const account = await findAccount(tx, budgetId, input.accountId);
  if (!restore && (!existing || existing.accountId !== account.id)) assertOpen(account);
  if (existing && existing.accountId !== account.id) {
    assertSameCurrency(await findAccount(tx, budgetId, existing.accountId), account, "move");
  }
  let transferTo: AccountRow | null = null;
  if ("transferAccountId" in input.payee) {
    transferTo = await findAccount(tx, budgetId, input.payee.transferAccountId);
    // A schedule has one amount; its other side between currencies isn't stored yet.
    assertTransferPair(account, transferTo, true);
    if (!restore && existing?.transferAccountId !== transferTo.id) assertOpen(transferTo);
  }
  if (input.dateFirst > input.date) {
    throw new AppError(400, "BAD_REQUEST", "`dateFirst` can't be after `date`");
  }
  const lines = input.lines;
  if (lines) {
    if (transferTo) {
      throw new AppError(
        400,
        "SPLIT_NOT_ALLOWED",
        "A transfer can't be split. Make the split's lines transfers instead.",
      );
    }
    if (input.categoryId !== null) {
      throw new AppError(
        400,
        "BAD_REQUEST",
        "A split's categories go on its lines; give either `categoryId` or `subtransactions`",
      );
    }
    assertSplitAllowed(account);
    assertLinesAddUp(lines, input.amount);
  }
  const values = {
    budgetId,
    accountId: account.id,
    frequency: input.frequency,
    dateFirst: input.dateFirst,
    dateNext: input.date,
    amount: input.amount,
    currency: account.currency,
    payeeId: transferTo
      ? await transferPayeeId(tx, transferTo)
      : "id" in input.payee
        ? input.payee.id
        : "name" in input.payee && input.payee.name
          ? await findOrCreatePayee(tx, budgetId, input.payee.name)
          : null,
    categoryId: lines
      ? null
      : await scheduleCategory(tx, budgetId, account, transferTo, input.categoryId),
    memo: input.memo,
    flag: input.flag,
  };
  const id = existing?.id ?? newId();
  if (existing?.id) {
    await tx.update(scheduledTransaction).set(values).where(eq(scheduledTransaction.id, id));
    await tx
      .delete(scheduledSubTransaction)
      .where(eq(scheduledSubTransaction.scheduledTransactionId, id));
  } else {
    await tx.insert(scheduledTransaction).values({ id, ...values });
  }
  for (const [index, line] of (lines ?? []).entries()) {
    let lineTo: AccountRow | null = null;
    if (line.transferAccountId) {
      lineTo = await findAccount(tx, budgetId, line.transferAccountId);
      assertTransferPair(account, lineTo, true);
      if (!restore) assertOpen(lineTo);
    }
    await tx.insert(scheduledSubTransaction).values({
      id: newId(),
      scheduledTransactionId: id,
      sortOrder: index,
      amount: BigInt(line.amount),
      currency: account.currency,
      payeeId: lineTo
        ? await transferPayeeId(tx, lineTo)
        : line.payeeName
          ? await findOrCreatePayee(tx, budgetId, line.payeeName)
          : null,
      categoryId: await resolveCategory(tx, budgetId, account, lineTo, line.categoryId),
      memo: line.memo,
    });
  }
  return id;
}

/**
 * After a schedule is written with a date on or before `today`, that occurrence is entered
 * (unapproved) and the schedule starts at its first date after today, skipping the ones between
 * (monthly from 9/01 added on 10/11: 9/01 entered, next 11/01). Returns the entered transaction's
 * id, or null if the date is still ahead.
 */
export async function enterIfPast(tx: Db, fx: FxDeps, id: string, today: string) {
  const [schedule] = await tx
    .select()
    .from(scheduledTransaction)
    .where(eq(scheduledTransaction.id, id))
    .for("update");
  if (!schedule || schedule.dateNext > today) return null;
  const entered = await enterOccurrence(tx, fx, schedule, schedule.dateNext, false);
  const next = firstOccurrenceAfter(schedule.frequency, schedule.dateFirst, today);
  if (next === null) {
    await tx.delete(scheduledTransaction).where(eq(scheduledTransaction.id, id));
  } else {
    await tx
      .update(scheduledTransaction)
      .set({ dateNext: next })
      .where(eq(scheduledTransaction.id, id));
  }
  return entered;
}

export type ScheduledRowKind = "schedule" | "transfer" | "splitTransfer";

/**
 * Every row the registers show for the budget's schedules (or one account's): each schedule in
 * its own account, plus a scheduled transfer in the other account (amount negated, "Transfer :
 * <account>") and a split's transfer line in its account. Newest first.
 */
export async function scheduledRows(db: Db, budgetId: string, accountId?: string) {
  const ownAccount = budgetAccount;
  const rows = await db
    .select({
      schedule: scheduledTransaction,
      accountName: ownAccount.name,
      accountType: ownAccount.type,
      payeeName: payee.name,
      transferAccountId: payee.transferAccountId,
      categoryName: category.name,
    })
    .from(scheduledTransaction)
    .innerJoin(ownAccount, eq(ownAccount.id, scheduledTransaction.accountId))
    .leftJoin(payee, eq(payee.id, scheduledTransaction.payeeId))
    .leftJoin(category, eq(category.id, scheduledTransaction.categoryId))
    .where(eq(scheduledTransaction.budgetId, budgetId));
  const lines = await scheduleLines(
    db,
    rows.map((r) => r.schedule.id),
  );
  const accounts = new Map(
    (
      await db
        .select({ id: budgetAccount.id, name: budgetAccount.name, type: budgetAccount.type })
        .from(budgetAccount)
        .where(eq(budgetAccount.budgetId, budgetId))
    ).map((a) => [a.id, a]),
  );
  const out = [];
  for (const row of rows) {
    const s = row.schedule;
    const own = lines.filter((l) => l.scheduledTransactionId === s.id);
    const base = {
      scheduledTransactionId: s.id,
      frequency: s.frequency,
      dateFirst: s.dateFirst,
      dateNext: s.dateNext,
      currency: s.currency,
      flag: s.flag,
    };
    const other = row.transferAccountId ? accounts.get(row.transferAccountId) : undefined;
    out.push({
      ...base,
      id: s.id,
      kind: "schedule" as ScheduledRowKind,
      accountId: s.accountId,
      accountName: row.accountName,
      amount: s.amount,
      payeeId: s.payeeId,
      payeeName: row.payeeName,
      // The stored category, even when it belongs on the other side of a transfer.
      categoryId: s.categoryId,
      categoryName: row.categoryName,
      memo: s.memo,
      transferAccountId: row.transferAccountId,
      subtransactions: own.map(({ scheduledTransactionId: _, ...l }) => ({
        ...l,
        amount: l.amount.toString(),
      })),
    });
    if (other) {
      const shown = usesAccountCategory(other.type, row.accountType) ? s.categoryId : null;
      out.push({
        ...base,
        id: `${s.id}~${other.id}`,
        kind: "transfer" as ScheduledRowKind,
        accountId: other.id,
        accountName: other.name,
        amount: -s.amount,
        payeeId: null,
        payeeName: `Transfer : ${row.accountName}`,
        categoryId: shown,
        categoryName: shown ? row.categoryName : null,
        memo: s.memo,
        transferAccountId: s.accountId,
        subtransactions: [],
      });
    }
    for (const line of own) {
      const to = line.transferAccountId ? accounts.get(line.transferAccountId) : undefined;
      if (!to) continue;
      out.push({
        ...base,
        flag: null,
        id: `${s.id}~${line.id}`,
        kind: "splitTransfer" as ScheduledRowKind,
        accountId: to.id,
        accountName: to.name,
        amount: -line.amount,
        payeeId: null,
        payeeName: `Transfer : ${row.accountName}`,
        categoryId: null,
        categoryName: null,
        memo: line.memo,
        transferAccountId: s.accountId,
        subtransactions: [],
      });
    }
  }
  return out
    .filter((r) => !accountId || r.accountId === accountId)
    .sort(
      (a, b) =>
        b.dateNext.localeCompare(a.dateNext) ||
        // A day's largest outflow on top, as the register sorts.
        (a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0) ||
        a.id.localeCompare(b.id),
    )
    .map((r) => ({ ...r, amount: r.amount.toString() }));
}

export type ScheduledRowJson = Awaited<ReturnType<typeof scheduledRows>>[number];

/** The flag colors whose budget name is `name` (lower case), for `Flag:` search terms. */
export type FlagNames = ReadonlyMap<string, string>;

function contains(value: string | null, text: string) {
  return value?.toLowerCase().includes(text.toLowerCase()) ?? false;
}

/**
 * Register search over a scheduled row (or one of its split lines), as `termWhere` does it for
 * transactions. Scheduled rows count as uncleared.
 */
export function scheduledRowMatches(
  row: ScheduledRowJson,
  terms: readonly SearchTerm[],
  context: {
    flagNames: FlagNames;
    /** For `Income:`, which matches a scheduled Ready to Assign row by its next date. */
    readyToAssignId: string;
    /** The user's today: a year-less `Income:` month is this year's. */
    today: string;
  },
) {
  const { flagNames } = context;
  type Unit = {
    payee: string | null;
    category: string | null;
    categoryId: string | null;
    memo: string;
    amount: bigint;
    split: boolean;
  };
  const units: Unit[] = [
    {
      payee: row.payeeName,
      category: row.categoryName,
      categoryId: row.categoryId,
      memo: row.memo,
      amount: BigInt(row.amount),
      split: row.subtransactions.length > 0,
    },
    ...row.subtransactions.map((l) => ({
      payee: l.payeeName ?? row.payeeName,
      category: l.categoryName,
      categoryId: l.categoryId,
      memo: l.memo,
      amount: BigInt(l.amount),
      split: false,
    })),
  ];
  const matches = (unit: Unit, term: SearchTerm): boolean => {
    switch (term.kind) {
      case "text":
        return (
          contains(unit.payee, term.text) ||
          contains(unit.category, term.text) ||
          contains(unit.memo, term.text) ||
          contains(row.accountName, term.text) ||
          (term.amount !== null && (unit.amount < 0n ? -unit.amount : unit.amount) === term.amount)
        );
      case "payee":
        return contains(unit.payee, term.text);
      case "category":
        return contains(unit.category, term.text);
      case "memo":
        return contains(unit.memo, term.text);
      case "account":
        return contains(row.accountName, term.text);
      case "split":
        return unit.split;
      case "flag": {
        const text = term.text.toLowerCase();
        if (text === "none") return row.flag === null;
        return row.flag === text || (row.flag !== null && flagNames.get(text) === row.flag);
      }
      case "is":
        return term.state === "uncleared" || term.state === "unreconciled";
      case "amount": {
        const signed = term.direction === "outflow" ? -unit.amount : unit.amount;
        if (signed <= 0n) return false;
        return term.op === "eq"
          ? signed === term.amount
          : term.op === "gte"
            ? signed >= term.amount
            : signed <= term.amount;
      }
      case "date":
        return term.op === "on"
          ? row.dateNext === term.date
          : term.op === "before"
            ? row.dateNext <= term.date
            : row.dateNext >= term.date;
      case "income": {
        const year = term.year ?? Number(context.today.slice(0, 4));
        const month = `${String(year).padStart(4, "0")}-${String(term.month).padStart(2, "0")}`;
        return unit.categoryId === context.readyToAssignId && row.dateNext.startsWith(month);
      }
    }
  };
  return units.some((unit) => terms.every((term) => matches(unit, term)));
}

export type { SearchSettings };

/** One upcoming scheduled transaction as a category's Activity popover lists it. */
export interface UpcomingTransaction {
  scheduleId: string;
  accountId: string;
  accountName: string;
  date: string;
  payeeName: string | null;
  memo: string;
  /** What it does to the category (a split's line, a payment's effect on the card's category). */
  amount: bigint;
}

export interface CategoryUpcoming {
  /** Net amount; negative when more goes out than comes in. */
  amount: bigint;
  date: string;
  /** Latest first. */
  transactions: UpcomingTransaction[];
}

/**
 * Each category's scheduled transactions still to come in `month`, as of the user's `today`:
 * occurrences after today in the month, earlier months counting nothing; inflows net against
 * outflows; a split counts line by line; spending on a card counts in its category; a payment from
 * a budget account counts against the card's payment category (`paymentCategoryByAccount`); Ready
 * to Assign and Uncategorized don't count. Schedules in closed accounts don't occur.
 */
export async function upcomingByCategory(
  db: Db,
  budgetId: string,
  month: BudgetMonth,
  today: string,
  paymentCategoryByAccount: ReadonlyMap<string, string>,
  /** Looks up a rate no read has cached yet; without it such a schedule is left out. */
  fx?: FxDeps,
): Promise<Map<string, CategoryUpcoming>> {
  const upcoming = new Map<string, CategoryUpcoming>();
  if (month < monthOf(today)) return upcoming;
  const { end } = monthBounds(month);
  const schedules = await db
    .select({
      schedule: scheduledTransaction,
      accountName: budgetAccount.name,
      accountType: budgetAccount.type,
      payeeName: payee.name,
      transferAccountId: payee.transferAccountId,
    })
    .from(scheduledTransaction)
    .innerJoin(budgetAccount, eq(budgetAccount.id, scheduledTransaction.accountId))
    .leftJoin(payee, eq(payee.id, scheduledTransaction.payeeId))
    .where(
      and(
        eq(scheduledTransaction.budgetId, budgetId),
        eq(budgetAccount.closed, false),
        lte(scheduledTransaction.dateNext, end),
      ),
    );
  if (schedules.length === 0) return upcoming;
  // A foreign account's schedule counts at the latest rate known for today, else
  // one looked up now; with no rate at all it's left out (FX_RATE_UNAVAILABLE).
  const budgetCurrency = await budgetCurrencyOf(db, budgetId);
  const rates = new Map<CurrencyCode, string | null>();
  for (const { schedule } of schedules) {
    if (schedule.currency === budgetCurrency || rates.has(schedule.currency)) continue;
    const known = await knownRate(db, {
      budgetId,
      budgetCurrency,
      from: schedule.currency,
      to: budgetCurrency,
      date: today,
    });
    rates.set(
      schedule.currency,
      known ??
        (fx ? await fetchedRate(db, fx, budgetId, schedule.currency, budgetCurrency, today) : null),
    );
  }
  const lines = await scheduleLines(
    db,
    schedules.map((r) => r.schedule.id),
  );
  const accountTypes = new Map(
    (
      await db
        .select({ id: budgetAccount.id, type: budgetAccount.type })
        .from(budgetAccount)
        .where(eq(budgetAccount.budgetId, budgetId))
    ).map((a) => [a.id, a.type]),
  );
  const counted = new Set(
    (
      await db
        .select({ id: category.id })
        .from(category)
        .where(and(eq(category.budgetId, budgetId), isNull(category.internalKind)))
    ).map((c) => c.id),
  );
  const isCard = (accountId: string | null) => {
    const type = accountId && accountTypes.get(accountId);
    return Boolean(type && accountFamily(type) === "credit");
  };
  const isBudgetCash = (accountId: string) => {
    const type = accountTypes.get(accountId);
    return Boolean(type && isOnBudget(type) && accountFamily(type) !== "credit");
  };
  // A card payment from a budget account takes money out of the card's payment category.
  const paymentFlow = (fromAccountId: string, toAccountId: string | null, amount: bigint) => {
    if (toAccountId && isCard(toAccountId) && isBudgetCash(fromAccountId)) {
      const paymentId = paymentCategoryByAccount.get(toAccountId);
      return paymentId ? { categoryId: paymentId, amount } : null;
    }
    if (toAccountId && isCard(fromAccountId) && isBudgetCash(toAccountId)) {
      const paymentId = paymentCategoryByAccount.get(fromAccountId);
      return paymentId ? { categoryId: paymentId, amount: -amount } : null;
    }
    return null;
  };

  for (const row of schedules) {
    const s = row.schedule;
    if (!isOnBudget(row.accountType)) continue;
    const rate = s.currency === budgetCurrency ? null : (rates.get(s.currency) ?? undefined);
    if (rate === undefined) continue;
    const own = lines.filter((l) => l.scheduledTransactionId === s.id);
    const ownBase = linesToBase(
      s.amount,
      own.map((l) => l.amount),
      s.currency,
      rate,
      budgetCurrency,
    );
    const amount = toBase(s.amount, s.currency, rate, budgetCurrency);
    const flows: { categoryId: string; amount: bigint }[] = [];
    if (own.length > 0) {
      for (const [i, line] of own.entries()) {
        const lineAmount = ownBase[i] as bigint;
        const flow = line.transferAccountId
          ? paymentFlow(s.accountId, line.transferAccountId, lineAmount)
          : line.categoryId
            ? { categoryId: line.categoryId, amount: lineAmount }
            : null;
        if (flow) flows.push(flow);
      }
    } else if (row.transferAccountId && !s.categoryId) {
      const flow = paymentFlow(s.accountId, row.transferAccountId, amount);
      if (flow) flows.push(flow);
    } else if (s.categoryId) {
      flows.push({ categoryId: s.categoryId, amount });
    }
    const relevant = flows.filter((f) => counted.has(f.categoryId));
    if (relevant.length === 0) continue;
    const dates = occurrencesBetween(s, today, end).filter((d) => monthOf(d) === month);
    for (const date of dates) {
      const byCategory = new Map<string, bigint>();
      for (const f of relevant) {
        byCategory.set(f.categoryId, (byCategory.get(f.categoryId) ?? 0n) + f.amount);
      }
      for (const [categoryId, amount] of byCategory) {
        const entry = upcoming.get(categoryId) ?? { amount: 0n, date, transactions: [] };
        entry.amount += amount;
        if (date < entry.date) entry.date = date;
        entry.transactions.push({
          scheduleId: s.id,
          accountId: s.accountId,
          accountName: row.accountName,
          date,
          payeeName: row.payeeName,
          memo: s.memo,
          amount,
        });
        upcoming.set(categoryId, entry);
      }
    }
  }
  for (const entry of upcoming.values()) {
    entry.transactions.sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));
  }
  return upcoming;
}

/** Today's rate from the providers when none is cached; null when none is available. */
async function fetchedRate(
  db: Db,
  fx: FxDeps,
  budgetId: string,
  from: CurrencyCode,
  to: CurrencyCode,
  today: string,
) {
  try {
    return (await resolveRate(db, fx, { budgetId, from, to, date: today, today })).rate;
  } catch (error) {
    if (error instanceof AppError && error.code === "FX_RATE_UNAVAILABLE") return null;
    throw error;
  }
}
