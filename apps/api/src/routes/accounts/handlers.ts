import type { RouteHandler } from "@hono/zod-openapi";
import { newId } from "@strictbudget/db";
import {
  budgetAccount,
  category,
  categoryGroup,
  categoryTarget,
  payee,
  scheduledSubTransaction,
  scheduledTransaction,
  transaction,
} from "@strictbudget/db/schema";
import {
  accountFamily,
  type CurrencyCode,
  hasPaymentCategory,
  impliedRate,
  isOnBudget,
  type LoanTerms,
  money,
  rateThousandths,
} from "@strictbudget/engine";
import { and, asc, eq, inArray, isNotNull, isNull, lte, max, ne, or, sql } from "drizzle-orm";
import {
  convertedTotals,
  displayCurrencyOf,
  TOTAL_IDS,
  type Total,
  type TotalId,
} from "../../lib/account-totals";
import { budgetCurrencyOf, type FxDeps } from "../../lib/base-amount";
import { loadBudgetAccess } from "../../lib/budget-access";
import { AppError } from "../../lib/errors";
import {
  type AccountBalances,
  accountBalances,
  createPaymentCategory,
  type Db,
  insertStartingBalance,
  insertTransaction,
  internalCategoryId,
  internalPayeeId,
  serverToday,
  transferPayeeId,
  transferPayeeName,
  ZERO_BALANCES,
} from "../../lib/ledger";
import {
  applyLoanTerms,
  checkLoanTerms,
  currentLoanTerms,
  freezeLoanCharges,
  keepEarlierTerms,
  LOAN_TYPES,
  lastLoanPayments,
  lastPaymentSources,
  saveLoanTerms,
} from "../../lib/loans";
import { reorder, writeOrder } from "../../lib/ordering";
import { type Unrealized, unrealizedGains } from "../../lib/revaluation";
import { transactionsToReview } from "../../lib/review";
import { enterDueScheduled, entryDate } from "../../lib/scheduled";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import { accountLogoUrls } from "../pictures/handlers";
import type {
  closeAccount,
  createAccount,
  deleteAccount,
  listAccounts,
  moveAccount,
  previewReconcileAccount,
  reconcileAccount,
  reopenAccount,
  updateAccount,
  updateToLoanAccount,
} from "./routes";

type Env = AppEnv & AuthedEnv;
type AccountRow = typeof budgetAccount.$inferSelect;

function toAccountJson(
  a: AccountRow,
  balances: AccountBalances,
  paymentCategoryId: string | null,
  hasHistory: boolean,
  lastPaymentDate: string | null,
  lastPaymentFromAccountId: string | null,
  /** A loan's terms this month, when it has `loan_terms` entries. */
  terms: LoanTerms | undefined,
  migratedFromAccountId: string | null,
  toReview: number,
  unrealized: Unrealized | undefined,
  logo: string | null,
) {
  return {
    id: a.id,
    name: a.name,
    logo,
    type: a.type,
    note: a.note,
    closed: a.closed,
    starredOrder: a.starredSortOrder,
    currency: a.currency,
    interestRate: terms ? terms.interestRate : a.interestRate,
    minimumPayment: (terms ? terms.minimumPayment : a.minimumPayment)?.toString() ?? null,
    escrowAmount: (terms ? terms.escrowAmount : a.escrowAmount)?.toString() ?? null,
    paymentCategoryId,
    hasHistory,
    balances: {
      cleared: balances.cleared.toString(),
      uncleared: balances.uncleared.toString(),
      working: balances.working.toString(),
    },
    lastReconciledAt: a.lastReconciledAt?.toISOString() ?? null,
    pairedCategoryId: a.pairedCategoryId,
    lastPaymentDate,
    lastPaymentFromAccountId,
    migratedToAccountId: a.migratedToAccountId,
    migratedFromAccountId,
    toReview,
    unrealizedGain: unrealized?.gain.toString() ?? null,
    rate: unrealized?.rate ?? null,
    rateDate: unrealized?.rateDate ?? null,
  };
}

async function listAccountJson(db: Db, budgetId: string, today: string) {
  const accounts = await db
    .select()
    .from(budgetAccount)
    .where(eq(budgetAccount.budgetId, budgetId))
    .orderBy(asc(budgetAccount.sortOrder), asc(budgetAccount.id));
  const payments = await db
    .select({ id: category.id, accountId: category.linkedAccountId })
    .from(category)
    .where(eq(category.budgetId, budgetId));
  const paymentByAccount = new Map(payments.map((p) => [p.accountId, p.id]));
  const balances = await accountBalances(db, budgetId, today);
  const booked = await accountBalances(db, budgetId, today, "base");
  const unrealized = await unrealizedGains(db, {
    budgetId,
    budgetCurrency: await budgetCurrencyOf(db, budgetId),
    today,
    accounts: accounts.map((a) => ({
      id: a.id,
      currency: a.currency,
      native: balances.get(a.id)?.working ?? 0n,
      booked: booked.get(a.id)?.working ?? 0n,
    })),
  });
  const startingBalancePayee = await internalPayeeId(db, budgetId, "starting_balance");
  const withHistory = await db
    .selectDistinct({ accountId: transaction.accountId })
    .from(transaction)
    .where(
      and(
        eq(transaction.budgetId, budgetId),
        or(isNull(transaction.payeeId), ne(transaction.payeeId, startingBalancePayee)),
      ),
    );
  const history = new Set(withHistory.map((r) => r.accountId));
  const lastPayments = await lastLoanPayments(db, budgetId, today);
  const paidFrom = await lastPaymentSources(db, budgetId);
  const terms = await currentLoanTerms(
    db,
    accounts.filter((a) => LOAN_TYPES.includes(a.type)).map((a) => a.id),
    today,
  );
  const migratedFrom = new Map(
    accounts.flatMap((a) => (a.migratedToAccountId ? [[a.migratedToAccountId, a.id]] : [])),
  );
  const toReview = await transactionsToReview(db, budgetId);
  const logos = await accountLogoUrls(db, budgetId);
  return accounts.map((a) =>
    toAccountJson(
      a,
      balances.get(a.id) ?? ZERO_BALANCES,
      paymentByAccount.get(a.id) ?? null,
      history.has(a.id),
      lastPayments.get(a.id) ?? null,
      paidFrom.get(a.id) ?? null,
      terms.get(a.id),
      migratedFrom.get(a.id) ?? null,
      toReview.get(a.id) ?? 0,
      unrealized.get(a.id),
      logos.get(a.id) ?? null,
    ),
  );
}

/**
 * The account list with each account's balances and the sidebar's totals and net worth in
 * `display` (the user's display currency, else the budget's).
 */
async function accountListJson(
  db: Db,
  budgetId: string,
  today: string,
  display: CurrencyCode | null,
) {
  const accounts = await listAccountJson(db, budgetId, today);
  const budgetCurrency = await budgetCurrencyOf(db, budgetId);
  const { converted, totals, missingRates } = await convertedTotals(db, {
    budgetId,
    budgetCurrency,
    display: display ?? budgetCurrency,
    today,
    accounts: accounts.map((a) => ({
      id: a.id,
      type: a.type,
      currency: a.currency,
      closed: a.closed,
      starredSortOrder: a.starredOrder,
      balances: {
        cleared: BigInt(a.balances.cleared),
        uncleared: BigInt(a.balances.uncleared),
        working: BigInt(a.balances.working),
      },
    })),
  });
  return {
    accounts: accounts.map((a) => {
      const c = converted.get(a.id);
      return {
        ...a,
        converted: c
          ? {
              currency: c.currency,
              cleared: c.cleared.toString(),
              uncleared: c.uncleared.toString(),
              working: c.working.toString(),
            }
          : null,
      };
    }),
    totals: Object.fromEntries(
      TOTAL_IDS.map((id) => [id, { ...totals[id], amount: totals[id].amount.toString() }]),
    ) as Record<TotalId, Omit<Total, "amount"> & { amount: string }>,
    missingRates,
  };
}

export async function accountJson(
  db: Db,
  budgetId: string,
  accountId: string,
  today = serverToday(),
) {
  const found = (await listAccountJson(db, budgetId, today)).find((a) => a.id === accountId);
  if (!found) throw new AppError(404, "NOT_FOUND", "Account not found");
  return found;
}

async function findAccount(db: Db, budgetId: string, accountId: string) {
  const [row] = await db
    .select()
    .from(budgetAccount)
    .where(and(eq(budgetAccount.id, accountId), eq(budgetAccount.budgetId, budgetId)));
  if (!row) throw new AppError(404, "NOT_FOUND", "Account not found");
  return row;
}

function assertLoanFields(
  type: AccountRow["type"],
  fields: { interestRate?: unknown; minimumPayment?: unknown; escrowAmount?: unknown },
) {
  const given = [fields.interestRate, fields.minimumPayment, fields.escrowAmount].some(
    (v) => v !== undefined && v !== null,
  );
  if (given && accountFamily(type) !== "loan") {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Interest rate, minimum payment and escrow only apply to loan accounts",
    );
  }
}

/**
 * Pairs `categoryId` with the loan, moving it from any other loan. Any other target on the
 * category is removed, and a Monthly Debt Payment target starts again from the loan's minimum.
 * Unpairing leaves the target as it is.
 */
async function pairCategory(tx: Db, account: AccountRow, categoryId: string | null) {
  if (categoryId !== null) {
    if (accountFamily(account.type) !== "loan") {
      throw new AppError(400, "BAD_REQUEST", "Only loan accounts are paired with a category");
    }
    const [row] = await tx
      .select({
        internalKind: category.internalKind,
        linked: category.linkedAccountId,
        kind: categoryGroup.kind,
      })
      .from(category)
      .innerJoin(categoryGroup, eq(categoryGroup.id, category.groupId))
      .where(and(eq(category.id, categoryId), eq(category.budgetId, account.budgetId)));
    if (!row) throw new AppError(400, "BAD_REQUEST", "No such category in this budget");
    if (row.internalKind || row.linked || row.kind) {
      throw new AppError(400, "BAD_REQUEST", "A loan can't be paired with that category");
    }
    await tx
      .update(budgetAccount)
      .set({ pairedCategoryId: null })
      .where(and(eq(budgetAccount.pairedCategoryId, categoryId), ne(budgetAccount.id, account.id)));
    if (account.pairedCategoryId !== categoryId) {
      const [target] = await tx
        .select({ id: categoryTarget.id, cadence: categoryTarget.cadence })
        .from(categoryTarget)
        .where(eq(categoryTarget.categoryId, categoryId));
      if (target && target.cadence !== "debt_monthly") {
        await tx.delete(categoryTarget).where(eq(categoryTarget.id, target.id));
      } else if (target && account.minimumPayment && account.minimumPayment > 0n) {
        await tx
          .update(categoryTarget)
          .set({ amount: account.minimumPayment })
          .where(eq(categoryTarget.id, target.id));
      }
    }
  }
  await tx
    .update(budgetAccount)
    .set({ pairedCategoryId: categoryId })
    .where(eq(budgetAccount.id, account.id));
}

/**
 * Which currencies an account of `type` may use. Loans stay in the budget's currency: their
 * interest, escrow and paired category are budget amounts.
 */
function assertAccountCurrency(
  type: AccountRow["type"],
  currency: AccountRow["currency"],
  budgetCurrency: AccountRow["currency"],
) {
  if (currency === budgetCurrency) return;
  if (accountFamily(type) === "loan") {
    throw new AppError(
      422,
      "LOAN_CURRENCY",
      `Loan accounts use the budget's currency (${budgetCurrency})`,
    );
  }
}

const hasEscrow = (type: AccountRow["type"]) => type === "mortgage";

const optionalBigInt = (v: string | null | undefined) =>
  v === undefined ? undefined : v === null ? null : BigInt(v);

export const listAccountsHandler: RouteHandler<typeof listAccounts, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const query = c.req.valid("query");
  const today = query.today ?? serverToday();
  await loadBudgetAccess(c, budgetId);
  if (query.today)
    await enterDueScheduled(
      c.var.deps.db,
      c.var.deps,
      budgetId,
      entryDate(c.var.deps, query.today),
    );
  const display = query.displayCurrency ?? (await displayCurrencyOf(c.var.deps.db, c.var.user.id));
  return c.json(await accountListJson(c.var.deps.db, budgetId, today, display), 200);
};

type NewAccount = {
  name: string;
  type: AccountRow["type"];
  balance: string;
  date: string;
  interestRate?: string;
  minimumPayment?: string;
  escrowAmount?: string;
  pairedCategoryId?: string;
};

async function insertAccount(
  tx: Db,
  fx: FxDeps,
  budgetId: string,
  currency: AccountRow["currency"],
  body: NewAccount,
) {
  const accountId = newId();
  const [last] = await tx
    .select({ value: max(budgetAccount.sortOrder) })
    .from(budgetAccount)
    .where(eq(budgetAccount.budgetId, budgetId));
  const [created] = await tx
    .insert(budgetAccount)
    .values({
      id: accountId,
      budgetId,
      name: body.name,
      type: body.type,
      sortOrder: (last?.value ?? -1) + 1,
      currency,
      interestRate: body.interestRate ?? null,
      minimumPayment: optionalBigInt(body.minimumPayment) ?? null,
      // Only mortgages have escrow; other loans would be charged it unseen.
      escrowAmount: hasEscrow(body.type) ? (optionalBigInt(body.escrowAmount) ?? null) : null,
    })
    .returning();
  if (created && accountFamily(created.type) === "loan") {
    await saveLoanTerms(tx, created, body.date);
    if (body.pairedCategoryId) await pairCategory(tx, created, body.pairedCategoryId);
  }
  if (hasPaymentCategory(body.type)) {
    await createPaymentCategory(tx, budgetId, accountId, body.name);
  }
  await transferPayeeId(tx, { id: accountId, budgetId, name: body.name });
  await insertStartingBalance(tx, {
    budgetId,
    accountId,
    type: body.type,
    amount: BigInt(body.balance),
    currency,
    date: body.date,
    fx,
  });
  return accountId;
}

export const createAccountHandler: RouteHandler<typeof createAccount, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const body = c.req.valid("json");
  const { db } = c.var.deps;
  const { budget } = await loadBudgetAccess(c, budgetId, { account: ["create"] });
  const currency = body.currency ?? budget.currency;
  assertAccountCurrency(body.type, currency, budget.currency);
  assertLoanFields(body.type, body);

  if (body.pairedCategoryId !== undefined && accountFamily(body.type) !== "loan") {
    throw new AppError(400, "BAD_REQUEST", "Only loan accounts are paired with a category");
  }
  const accountId = await db.transaction((tx) =>
    insertAccount(tx, c.var.deps, budgetId, currency, body),
  );
  return c.json(await accountJson(db, budgetId, accountId, body.date), 201);
};

/**
 * Update to a Loan Account: a new loan whose only transaction is a cleared Starting Balance dated
 * today, its terms and paired category; the tracking liability keeps its history but is closed
 * with a cleared "Closed Account" Manual Balance Adjustment of its working balance, renamed
 * "… (Original)", and its scheduled transactions (including ones transferring into it) are gone.
 * Ready to Assign doesn't move: both accounts are off budget.
 */
export const updateToLoanAccountHandler: RouteHandler<typeof updateToLoanAccount, Env> = async (
  c,
) => {
  const { budgetId, accountId } = c.req.valid("param");
  const body = c.req.valid("json");
  const { db } = c.var.deps;
  const { budget } = await loadBudgetAccess(c, budgetId, {
    account: ["create", "update"],
    transaction: ["create"],
  });
  if (accountFamily(body.type) !== "loan") {
    throw new AppError(400, "BAD_REQUEST", "Choose a loan type");
  }
  const loanId = await db.transaction(async (tx) => {
    const [original] = await tx
      .select()
      .from(budgetAccount)
      .where(and(eq(budgetAccount.id, accountId), eq(budgetAccount.budgetId, budgetId)))
      .for("update");
    if (!original) throw new AppError(404, "NOT_FOUND", "Account not found");
    // Tracking liabilities only (not assets or budget accounts).
    if (original.type !== "liability") {
      throw new AppError(400, "BAD_REQUEST", "Only tracking liabilities can be updated to a loan");
    }
    if (original.migratedToAccountId) {
      throw new AppError(400, "BAD_REQUEST", "This account was already updated to a loan account");
    }
    if (original.closed) {
      throw new AppError(400, "ACCOUNT_CLOSED", "Reopen the account to update it");
    }
    assertAccountCurrency(body.type, original.currency, budget.currency);
    // Rename first, so the loan can take the original's name and the payees stay distinct.
    const originalName = `${original.name} (Original)`.slice(0, 100);
    await tx
      .update(budgetAccount)
      .set({ name: originalName })
      .where(eq(budgetAccount.id, original.id));
    await tx
      .update(payee)
      .set({ name: transferPayeeName(originalName) })
      .where(eq(payee.transferAccountId, original.id));

    // The loan keeps the original's currency (the budget's: loans can't be in another one).
    const loanId = await insertAccount(tx, c.var.deps, budgetId, original.currency, body);

    const working =
      (await accountBalances(tx, budgetId, body.date)).get(original.id)?.working ?? 0n;
    if (working !== 0n) {
      await insertAdjustment(tx, c.var.deps, original, {
        date: body.date,
        amount: -working,
        kind: "manual_balance_adjustment",
        memo: "Closed Account",
        cleared: "cleared",
      });
    }
    // "Cancel all Scheduled Transactions tied to the tracking account": its own, and those
    // transferring into it (a split line included).
    const transferPayees = tx
      .select({ id: payee.id })
      .from(payee)
      .where(eq(payee.transferAccountId, original.id));
    await tx
      .delete(scheduledTransaction)
      .where(
        or(
          eq(scheduledTransaction.accountId, original.id),
          inArray(scheduledTransaction.payeeId, transferPayees),
          inArray(
            scheduledTransaction.id,
            tx
              .select({ id: scheduledSubTransaction.scheduledTransactionId })
              .from(scheduledSubTransaction)
              .where(inArray(scheduledSubTransaction.payeeId, transferPayees)),
          ),
        ),
      );
    await tx
      .update(budgetAccount)
      .set({ closed: true, migratedToAccountId: loanId })
      .where(eq(budgetAccount.id, original.id));
    return loanId;
  });
  const [loan, original] = await Promise.all([
    accountJson(db, budgetId, loanId, body.date),
    accountJson(db, budgetId, accountId, body.date),
  ]);
  return c.json({ loan, original }, 201);
};

export const updateAccountHandler: RouteHandler<typeof updateAccount, Env> = async (c) => {
  const { budgetId, accountId } = c.req.valid("param");
  const { today } = c.req.valid("query");
  const { workingBalance, date = today ?? serverToday(), starred, ...body } = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(
    c,
    budgetId,
    workingBalance === undefined
      ? { account: ["update"] }
      : { account: ["update"], transaction: ["create"] },
  );
  const account = await findAccount(db, budgetId, accountId);
  if (workingBalance !== undefined) {
    // A closed account's Edit Account has no Working Balance.
    if (account.closed) {
      throw new AppError(400, "ACCOUNT_CLOSED", "Reopen the account to change its balance");
    }
  }

  // Only open cash and credit accounts can be starred.
  if (starred && (account.closed || !isOnBudget(account.type))) {
    throw new AppError(400, "BAD_REQUEST", "Only open cash and credit accounts can be starred");
  }

  const type = body.type ?? account.type;
  if (accountFamily(type) !== accountFamily(account.type)) {
    // Cross-family changes would move money in or out of the budget.
    throw new AppError(
      400,
      "BAD_REQUEST",
      "An account's type can only change within its family (cash, credit, loan or tracking)",
    );
  }
  assertLoanFields(type, body);
  // Only mortgages have escrow: a loan that isn't one (or stops being one) has none.
  const escrowAmount =
    accountFamily(type) === "loan" && !hasEscrow(type) ? null : optionalBigInt(body.escrowAmount);
  // Edit Account sends every field; only a real change starts new terms.
  const rate = (v: string | null) => (v === null ? null : rateThousandths(v));
  const termsChanged =
    (body.interestRate !== undefined && rate(body.interestRate) !== rate(account.interestRate)) ||
    (body.minimumPayment !== undefined &&
      optionalBigInt(body.minimumPayment) !== account.minimumPayment) ||
    (escrowAmount !== undefined && escrowAmount !== account.escrowAmount);

  await db.transaction(async (tx) => {
    const fields = {
      name: body.name,
      note: body.note,
      type: body.type,
      interestRate: body.interestRate,
      minimumPayment: optionalBigInt(body.minimumPayment),
      escrowAmount,
    };
    // Drizzle refuses an update with nothing to set (a working balance alone).
    if (Object.values(fields).some((v) => v !== undefined)) {
      const [updated] = await tx
        .update(budgetAccount)
        .set(fields)
        .where(eq(budgetAccount.id, accountId))
        .returning();
      // A loan's terms are kept per month: a change applies from this month on.
      if (updated && termsChanged && accountFamily(updated.type) === "loan") {
        await keepEarlierTerms(tx, account);
        await saveLoanTerms(tx, updated, date);
      }
    }
    if (body.pairedCategoryId !== undefined) {
      await pairCategory(tx, account, body.pairedCategoryId);
    }
    if (starred !== undefined && starred !== (account.starredSortOrder !== null)) {
      await setStarred(tx, account, starred);
    }
    // A payment category and the transfer payee are named after their account.
    if (body.name !== undefined) {
      await tx
        .update(category)
        .set({ name: body.name })
        .where(eq(category.linkedAccountId, accountId));
      await tx
        .update(payee)
        .set({ name: transferPayeeName(body.name) })
        .where(eq(payee.transferAccountId, accountId));
    }
    if (workingBalance !== undefined) {
      const working = (await accountBalances(tx, budgetId, date)).get(accountId)?.working ?? 0n;
      const difference = BigInt(workingBalance) - working;
      if (difference !== 0n) {
        // A cleared Manual Balance Adjustment with no memo, from Ready to Assign on budget
        // accounts, cards included.
        await insertAdjustment(tx, c.var.deps, account, {
          date,
          amount: difference,
          kind: "manual_balance_adjustment",
          memo: "",
          cleared: "cleared",
        });
      }
    }
  });
  return c.json(await accountJson(db, budgetId, accountId, today ?? date), 200);
};

/** A balance adjustment in `account`; budget accounts take it from Ready to Assign. */
async function insertAdjustment(
  tx: Db,
  fx: FxDeps,
  account: AccountRow,
  input: {
    date: string;
    amount: bigint;
    kind: "manual_balance_adjustment" | "reconciliation_balance_adjustment";
    memo: string;
    cleared: "cleared" | "reconciled";
  },
) {
  await insertTransaction(tx, {
    budgetId: account.budgetId,
    accountId: account.id,
    date: input.date,
    amount: input.amount,
    currency: account.currency,
    fx,
    payeeId: await internalPayeeId(tx, account.budgetId, input.kind),
    memo: input.memo,
    categoryId: isOnBudget(account.type)
      ? await internalCategoryId(tx, account.budgetId, "ready_to_assign")
      : null,
    cleared: input.cleared,
  });
}

type ReconcileBody = {
  balance: string;
  date: string;
  loanTerms?: {
    interestRate?: { rate: string | null; keepGoingForward: boolean };
    escrowAmount?: { amount: string | null; keepGoingForward: boolean };
  };
};

/** What a reconcile would do: the adjustment, and for a loan the terms check. */
async function planReconcile(db: Db, account: AccountRow, body: ReconcileBody) {
  const { balance, date, loanTerms } = body;
  const loan = accountFamily(account.type) === "loan";
  if (loanTerms && !loan) {
    throw new AppError(400, "BAD_REQUEST", "Only loans have an interest rate and escrow check");
  }
  if (loanTerms?.escrowAmount && !hasEscrow(account.type)) {
    throw new AppError(400, "BAD_REQUEST", "Only mortgages have escrow");
  }
  const { interestRate, escrowAmount } = loanTerms ?? {};
  const check = loanTerms
    ? await checkLoanTerms(db, account, date, {
        interestRate: interestRate && {
          value: interestRate.rate,
          keep: interestRate.keepGoingForward,
        },
        escrowAmount: escrowAmount && {
          value: escrowAmount.amount === null ? null : BigInt(escrowAmount.amount),
          keep: escrowAmount.keepGoingForward,
        },
      })
    : null;
  const balances =
    (await accountBalances(db, account.budgetId, date)).get(account.id) ?? ZERO_BALANCES;
  // A loan's Update Balance asks about the whole balance, interest and escrow included, and after
  // its check step counts this month's charges on the new terms.
  const current = loan ? balances.working - (check?.extraCharges ?? 0n) : balances.cleared;
  return { loan, check, adjustment: BigInt(balance) - current };
}

export const previewReconcileAccountHandler: RouteHandler<
  typeof previewReconcileAccount,
  Env
> = async (c) => {
  const { budgetId, accountId } = c.req.valid("param");
  const body = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId);
  const account = await findAccount(db, budgetId, accountId);
  const { adjustment } = await planReconcile(db, account, body);
  return c.json({ adjustment: adjustment.toString() }, 200);
};

export const reconcileAccountHandler: RouteHandler<typeof reconcileAccount, Env> = async (c) => {
  const { budgetId, accountId } = c.req.valid("param");
  const body = c.req.valid("json");
  const { date } = body;
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { transaction: ["create", "update"] });
  await db.transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(budgetAccount)
      .where(and(eq(budgetAccount.id, accountId), eq(budgetAccount.budgetId, budgetId)))
      .for("update");
    if (!account) throw new AppError(404, "NOT_FOUND", "Account not found");
    const { loan, check, adjustment: difference } = await planReconcile(tx, account, body);
    if (check) await applyLoanTerms(tx, account, date, check);
    if (difference !== 0n) {
      // Dated today, reconciled, Inflow: Ready to Assign on budget accounts (a card's too), none on
      // tracking accounts.
      await insertAdjustment(tx, c.var.deps, account, {
        date,
        amount: difference,
        kind: "reconciliation_balance_adjustment",
        memo: "Entered automatically by strictbudget",
        cleared: "reconciled",
      });
    }
    // Future-dated transactions aren't in the cleared balance yet, so they stay unlocked. A
    // loan's are all reconciled, uncleared ones too, and its months' interest and escrow are fixed.
    await tx
      .update(transaction)
      .set({ cleared: "reconciled" })
      .where(
        and(
          eq(transaction.accountId, accountId),
          loan ? ne(transaction.cleared, "reconciled") : eq(transaction.cleared, "cleared"),
          lte(transaction.date, date),
        ),
      );
    // The months are fixed at what they had before the check step's new terms, so the balance can
    // end slightly off the amount entered.
    if (loan) await freezeLoanCharges(tx, account, date, check?.before);
    await tx
      .update(budgetAccount)
      .set({ lastReconciledAt: sql`now()` })
      .where(eq(budgetAccount.id, accountId));
  });
  return c.json(await accountJson(db, budgetId, accountId, date), 200);
};

/** Stars an account at the end of the Starred group, or unstars it. */
async function setStarred(tx: Db, account: AccountRow, starred: boolean) {
  let order: number | null = null;
  if (starred) {
    // Locks the budget's accounts (as a move does) so two stars at once can't share a place.
    const rows = await tx
      .select({ order: budgetAccount.starredSortOrder })
      .from(budgetAccount)
      .where(eq(budgetAccount.budgetId, account.budgetId))
      .for("update");
    order = Math.max(-1, ...rows.map((r) => r.order ?? -1)) + 1;
  }
  await tx
    .update(budgetAccount)
    .set({ starredSortOrder: order })
    .where(eq(budgetAccount.id, account.id));
}

export const moveAccountHandler: RouteHandler<typeof moveAccount, Env> = async (c) => {
  const { budgetId, accountId } = c.req.valid("param");
  const { beforeAccountId, starred } = c.req.valid("json");
  const { today = serverToday() } = c.req.valid("query");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { account: ["update"] });
  await db.transaction(async (tx) => {
    const account = await findAccount(tx, budgetId, accountId);
    if (starred) {
      if (account.starredSortOrder === null) {
        throw new AppError(400, "BAD_REQUEST", "That account isn't starred");
      }
      const rows = await tx
        .select({ id: budgetAccount.id })
        .from(budgetAccount)
        .where(and(eq(budgetAccount.budgetId, budgetId), isNotNull(budgetAccount.starredSortOrder)))
        .orderBy(asc(budgetAccount.starredSortOrder), asc(budgetAccount.id))
        .for("update");
      await writeOrder(
        tx,
        budgetAccount,
        reorder(
          rows.map((r) => r.id),
          accountId,
          beforeAccountId,
        ),
        "starred_sort_order",
      );
      return;
    }
    const rows = await tx
      .select({ id: budgetAccount.id })
      .from(budgetAccount)
      .where(eq(budgetAccount.budgetId, budgetId))
      .orderBy(asc(budgetAccount.sortOrder), asc(budgetAccount.id))
      .for("update");
    await writeOrder(
      tx,
      budgetAccount,
      reorder(
        rows.map((r) => r.id),
        accountId,
        beforeAccountId,
      ),
    );
  });
  return c.json(
    await accountListJson(db, budgetId, today, await displayCurrencyOf(db, c.var.user.id)),
    200,
  );
};

export const closeAccountHandler: RouteHandler<typeof closeAccount, Env> = async (c) => {
  const { budgetId, accountId } = c.req.valid("param");
  const { date } = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { account: ["update"] });
  await db.transaction(async (tx) => {
    const account = await findAccount(tx, budgetId, accountId);
    if (account.closed) return;
    const working = (await accountBalances(tx, budgetId, date)).get(accountId)?.working ?? 0n;
    // In the budget's currency the account then holds nothing either: a foreign account's
    // adjustment takes out what its transactions were booked at, not today's value.
    const baseWorking =
      (await accountBalances(tx, budgetId, date, "base")).get(accountId)?.working ?? 0n;
    if (working !== 0n || baseWorking !== 0n) {
      const budgetCurrency = await budgetCurrencyOf(tx, budgetId);
      await insertTransaction(tx, {
        budgetId,
        accountId,
        date,
        amount: -working,
        currency: account.currency,
        baseAmount: -baseWorking,
        fxRate:
          account.currency === budgetCurrency
            ? null
            : impliedRate(money(-working, account.currency), money(-baseWorking, budgetCurrency)),
        payeeId: await internalPayeeId(tx, budgetId, "manual_balance_adjustment"),
        memo: "Closed Account",
        categoryId: isOnBudget(account.type)
          ? await internalCategoryId(tx, budgetId, "ready_to_assign")
          : null,
        cleared: "cleared",
      });
    }
    // The payment category stays visible with whatever is set aside; hiding it is up to the user.
    // A loan's paired category is unpaired. Closing also drops the star: reopened, it isn't
    // starred.
    await tx
      .update(budgetAccount)
      .set({ closed: true, pairedCategoryId: null, starredSortOrder: null })
      .where(eq(budgetAccount.id, accountId));
  });
  return c.json(await accountJson(db, budgetId, accountId, date), 200);
};

export const reopenAccountHandler: RouteHandler<typeof reopenAccount, Env> = async (c) => {
  const { budgetId, accountId } = c.req.valid("param");
  const { today } = c.req.valid("query");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { account: ["update"] });
  await findAccount(db, budgetId, accountId);
  // Reopening an updated tracking account erases the information migrated to its loan, so it can
  // be updated again.
  await db
    .update(budgetAccount)
    .set({ closed: false, migratedToAccountId: null })
    .where(eq(budgetAccount.id, accountId));
  return c.json(await accountJson(db, budgetId, accountId, today), 200);
};

export const deleteAccountHandler: RouteHandler<typeof deleteAccount, Env> = async (c) => {
  const { budgetId, accountId } = c.req.valid("param");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { account: ["delete"] });
  await findAccount(db, budgetId, accountId);
  const startingBalancePayee = await internalPayeeId(db, budgetId, "starting_balance");
  const [history] = await db
    .select({ id: transaction.id })
    .from(transaction)
    .where(
      and(
        eq(transaction.accountId, accountId),
        or(isNull(transaction.payeeId), ne(transaction.payeeId, startingBalancePayee)),
      ),
    )
    .limit(1);
  if (history) {
    throw new AppError(
      409,
      "ACCOUNT_HAS_HISTORY",
      "This account has transactions beyond its starting balance. Close it instead.",
    );
  }
  await db.transaction(async (tx) => {
    // Schedules that transfer to it would turn into payments to nobody, so they go too.
    // Transactions, its own schedules and the payment category cascade.
    await tx
      .delete(scheduledTransaction)
      .where(
        inArray(
          scheduledTransaction.payeeId,
          tx.select({ id: payee.id }).from(payee).where(eq(payee.transferAccountId, accountId)),
        ),
      );
    await tx.delete(budgetAccount).where(eq(budgetAccount.id, accountId));
  });
  return c.body(null, 204);
};
