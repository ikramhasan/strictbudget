import type { RouteHandler } from "@hono/zod-openapi";
import { budgetAccount, budget as budgetTable, transaction } from "@strictbudget/db/schema";
import {
  accountFamily,
  isOnBudget,
  monthEndBalances,
  monthOf,
  occurrencesBetween,
} from "@strictbudget/engine";
import { and, eq } from "drizzle-orm";
import { loadBudgetAccess } from "../../lib/budget-access";
import { latestTransactionDate } from "../../lib/dates";
import { AppError } from "../../lib/errors";
import { type Db, insertTransaction, internalCategoryId, transferPayeeId } from "../../lib/ledger";
import { type LoanState, loanStates, setLoanCharge } from "../../lib/loans";
import { scheduledRows, userToday, writeSchedule } from "../../lib/scheduled";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import { assertSameCurrency, insertOtherSide } from "../transactions/rules";
import { accountJson } from "./handlers";
import type {
  dismissLoanBanner,
  getLoanActivity,
  recordLoanPayment,
  setLoanCharge as setLoanChargeRoute,
} from "./routes";

type Env = AppEnv & AuthedEnv;
type AccountRow = typeof budgetAccount.$inferSelect;

async function findLoan(db: Db, budgetId: string, accountId: string) {
  const [account] = await db
    .select()
    .from(budgetAccount)
    .where(and(eq(budgetAccount.id, accountId), eq(budgetAccount.budgetId, budgetId)));
  if (!account) throw new AppError(404, "NOT_FOUND", "Account not found");
  if (accountFamily(account.type) !== "loan") {
    throw new AppError(400, "BAD_REQUEST", "Not a loan account");
  }
  return account;
}

async function loanState(db: Db, account: AccountRow, today: string) {
  const state = (await loanStates(db, [account], today)).get(account.id);
  if (!state) throw new Error(`Loan state missing for ${account.id}`);
  return state;
}

/** The tracking liability `loan` was made from, as month-end balances (or null). */
async function originalHistory(db: Db, loan: AccountRow) {
  const [original] = await db
    .select({ id: budgetAccount.id })
    .from(budgetAccount)
    .where(eq(budgetAccount.migratedToAccountId, loan.id));
  if (!original) return null;
  const entries = await db
    .select({ date: transaction.date, amount: transaction.amount })
    .from(transaction)
    .where(eq(transaction.accountId, original.id));
  return {
    accountId: original.id,
    months: monthEndBalances(entries).map((m) => ({
      month: m.month,
      endBalance: m.endBalance.toString(),
    })),
  };
}

/** The loan page's banners: the simulator one is dismissed budget-wide, the paid-off one per loan. */
function bannersJson(budget: { loanSimulatorBannerDismissed: boolean }, account: AccountRow) {
  return {
    simulatorDismissed: budget.loanSimulatorBannerDismissed,
    paidOffDismissed: account.paidOffBannerDismissed,
  };
}

/**
 * The loan's scheduled payments still to come this month, as the Payments row lists them ("2
 * Upcoming Transactions for $50.00"): every occurrence dated after today in today's month (a
 * weekly one twice), none from later months, newest first. A payment is a transfer into the loan,
 * as for entered ones. Each is shown as entered, from the schedule's own account and payee.
 */
async function upcomingPayments(db: Db, loan: AccountRow, today: string) {
  const month = monthOf(today);
  const rows = (await scheduledRows(db, loan.budgetId, loan.id)).filter(
    (r) => r.transferAccountId !== null && BigInt(r.amount) > 0n,
  );
  const names = new Map(
    (
      await db
        .select({ id: budgetAccount.id, name: budgetAccount.name })
        .from(budgetAccount)
        .where(eq(budgetAccount.budgetId, loan.budgetId))
    ).map((a) => [a.id, a.name]),
  );
  const out = [];
  for (const r of rows) {
    const paying = r.transferAccountId as string;
    // The loan's row is the schedule itself only when it was entered in the loan.
    const own = r.kind === "schedule";
    const dates = occurrencesBetween(r, today, `${month}-31`).filter((d) => monthOf(d) === month);
    for (const date of dates) {
      out.push({
        scheduleId: r.scheduledTransactionId,
        date,
        accountId: own ? loan.id : paying,
        accountName: own ? loan.name : (names.get(paying) ?? ""),
        payeeName: own ? (r.payeeName ?? "") : `Transfer : ${loan.name}`,
        memo: r.memo,
        amount: r.amount,
        payingAccountId: paying,
        payingRowId: own ? `${r.scheduledTransactionId}~${paying}` : r.scheduledTransactionId,
      });
    }
  }
  return out.sort(
    (a, b) => b.date.localeCompare(a.date) || a.scheduleId.localeCompare(b.scheduleId),
  );
}

async function loanActivity(
  db: Db,
  budget: { loanSimulatorBannerDismissed: boolean },
  account: AccountRow,
  today: string,
) {
  return {
    ...activityJson(await loanState(db, account, today)),
    upcoming: await upcomingPayments(db, account, today),
    banners: bannersJson(budget, account),
    originalHistory: await originalHistory(db, account),
  };
}

function activityJson(state: LoanState) {
  const charge = (
    month: string,
    kind: "interest" | "escrow",
    c: LoanState["months"][0]["interest"],
  ) => ({
    total: c.total.toString(),
    applied: c.applied.toString(),
    status: c.status,
    editedAt: state.editedAt.get(`${month}:${kind}`)?.toISOString() ?? null,
  });
  return {
    months: state.months.map((m) => ({
      month: m.month,
      startBalance: m.startBalance.toString(),
      endBalance: m.endBalance.toString(),
      payments: m.payments.toString(),
      interest: charge(m.month, "interest", m.interest),
      escrow: charge(m.month, "escrow", m.escrow),
      transactions: state.transactions
        .filter((t) => monthOf(t.date) === m.month)
        .map((t) => ({ ...t, amount: t.amount.toString() })),
    })),
    terms: [...state.terms]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((t) => ({
        month: t.month,
        interestRate: t.interestRate,
        minimumPayment: t.minimumPayment?.toString() ?? null,
        escrowAmount: t.escrowAmount?.toString() ?? null,
      })),
  };
}

export const getLoanActivityHandler: RouteHandler<typeof getLoanActivity, Env> = async (c) => {
  const { budgetId, accountId } = c.req.valid("param");
  const today = userToday(c.var.deps, c.req.valid("query").today);
  const { db } = c.var.deps;
  const { budget } = await loadBudgetAccess(c, budgetId);
  const account = await findLoan(db, budgetId, accountId);
  return c.json(await loanActivity(db, budget, account, today), 200);
};

export const dismissLoanBannerHandler: RouteHandler<typeof dismissLoanBanner, Env> = async (c) => {
  const { budgetId, accountId } = c.req.valid("param");
  const { banner } = c.req.valid("json");
  const { db } = c.var.deps;
  // Anyone on the budget can dismiss them, as anyone sees them (a viewer can't).
  const { budget } = await loadBudgetAccess(c, budgetId, { account: ["update"] });
  const account = await findLoan(db, budgetId, accountId);
  if (banner === "simulator") {
    await db
      .update(budgetTable)
      .set({ loanSimulatorBannerDismissed: true })
      .where(eq(budgetTable.id, budgetId));
  } else {
    await db
      .update(budgetAccount)
      .set({ paidOffBannerDismissed: true })
      .where(eq(budgetAccount.id, account.id));
  }
  return c.json(
    {
      simulatorDismissed: budget.loanSimulatorBannerDismissed || banner === "simulator",
      paidOffDismissed: account.paidOffBannerDismissed || banner === "paidOff",
    },
    200,
  );
};

export const setLoanChargeHandler: RouteHandler<typeof setLoanChargeRoute, Env> = async (c) => {
  const { budgetId, accountId } = c.req.valid("param");
  const { month, kind, amount, today: rawToday } = c.req.valid("json");
  const today = userToday(c.var.deps, rawToday);
  const { db } = c.var.deps;
  const { budget } = await loadBudgetAccess(c, budgetId, { transaction: ["update"] });
  const account = await findLoan(db, budgetId, accountId);
  const value = BigInt(amount);
  if (value < 0n) throw new AppError(400, "BAD_REQUEST", "Enter a charge of zero or more");
  const months = (await loanState(db, account, today)).months;
  // Add Interest offers the loan's first month through this month.
  if (!months.some((m) => m.month === month)) {
    throw new AppError(400, "BAD_REQUEST", "That month is outside the loan's activity");
  }
  await setLoanCharge(db, account, { month, kind, amount: value, status: "edited" });
  return c.json(await loanActivity(db, budget, account, today), 200);
};

export const recordLoanPaymentHandler: RouteHandler<typeof recordLoanPayment, Env> = async (c) => {
  const { budgetId, accountId } = c.req.valid("param");
  const { fromAccountId, amount, date, memo } = c.req.valid("json");
  const query = c.req.valid("query");
  const today = userToday(c.var.deps, query.today);
  const latest = latestTransactionDate(c.var.deps, query.today);
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { transaction: ["create"] });
  const value = BigInt(amount);
  if (value <= 0n) throw new AppError(400, "BAD_REQUEST", "Enter a payment amount");
  await db.transaction(async (tx) => {
    const loan = await findLoan(tx, budgetId, accountId);
    const [from] = await tx
      .select()
      .from(budgetAccount)
      .where(and(eq(budgetAccount.id, fromAccountId), eq(budgetAccount.budgetId, budgetId)));
    if (!from || !isOnBudget(from.type)) {
      throw new AppError(400, "BAD_REQUEST", "Pay from a cash or credit account in this budget");
    }
    if (loan.closed || from.closed) {
      throw new AppError(400, "ACCOUNT_CLOSED", "Reopen the account to record a payment");
    }
    // The payment's amount is the loan's; paying from another currency isn't built yet.
    assertSameCurrency(from, loan, "transfer");
    if (latest !== null && date > latest) {
      // A payment dated after today becomes a one-time scheduled transfer on the loan, out of the
      // same category as an entered one.
      await writeSchedule(tx, budgetId, {
        accountId: loan.id,
        frequency: "never",
        date,
        dateFirst: date,
        amount: value,
        payee: { transferAccountId: from.id },
        categoryId: loan.pairedCategoryId,
        memo,
        flag: null,
        lines: null,
      });
      return;
    }
    // The paying side is uncleared and comes out of the paired category, or Uncategorized; the
    // loan's side, entered from the loan, is cleared.
    const payingId = await insertTransaction(tx, {
      budgetId,
      accountId: from.id,
      date,
      amount: -value,
      currency: from.currency,
      payeeId: await transferPayeeId(tx, loan),
      categoryId:
        loan.pairedCategoryId ?? (await internalCategoryId(tx, budgetId, "uncategorized")),
      memo,
      cleared: "uncleared",
    });
    await insertOtherSide(tx, { id: payingId, budgetId, date, amount: -value, memo }, from, loan, {
      cleared: "cleared",
    });
  });
  // Balances as of the user's today, not the payment's date (which may be back-dated).
  return c.json(await accountJson(db, budgetId, accountId, today, c.var.deps), 201);
};
