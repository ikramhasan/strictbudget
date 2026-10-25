import type { RouteHandler } from "@hono/zod-openapi";
import { budgetAccount } from "@strictbudget/db/schema";
import { isOnBudget } from "@strictbudget/engine";
import { and, eq } from "drizzle-orm";
import { budgetCurrencyOf } from "../../lib/base-amount";
import { loadBudgetAccess } from "../../lib/budget-access";
import { assertNotFuture, latestTransactionDate } from "../../lib/dates";
import { AppError } from "../../lib/errors";
import { prefetchRates, resolveRate } from "../../lib/fx";
import {
  accountBalances,
  insertTransaction,
  internalCategoryId,
  internalPayeeId,
} from "../../lib/ledger";
import { unrealizedGain } from "../../lib/revaluation";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import { accountJson } from "./handlers";
import type { revalueAccount } from "./routes";

type Env = AppEnv & AuthedEnv;

/**
 * Revaluation: a foreign-currency account's unrealized gain or loss is booked into the budget as a
 * 0-native transaction whose base amount is the difference, into Ready to Assign for budget
 * accounts. On a card it goes through the card ledger like any Ready to Assign line: a loss while
 * the card owes adds debt without moving Ready to Assign, so the payment category falls short of
 * the balance (see the card test).
 */
export const revalueAccountHandler: RouteHandler<typeof revalueAccount, Env> = async (c) => {
  const { budgetId, accountId } = c.req.valid("param");
  const { date, today } = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { transaction: ["create"] });
  assertNotFuture(date, latestTransactionDate(c.var.deps, today));
  // Before the account is locked.
  await prefetchRates(db, c.var.deps, { budgetId, accountIds: [accountId], dates: [date], today });
  const posted = await db.transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(budgetAccount)
      .where(and(eq(budgetAccount.id, accountId), eq(budgetAccount.budgetId, budgetId)))
      .for("update");
    if (!account) throw new AppError(404, "NOT_FOUND", "Account not found");
    const budgetCurrency = await budgetCurrencyOf(tx, budgetId);
    if (account.currency === budgetCurrency) {
      throw new AppError(
        400,
        "NOT_FOREIGN_CURRENCY",
        `${account.name} is in the budget's currency (${budgetCurrency}); there's nothing to revalue`,
      );
    }
    if (account.closed) {
      throw new AppError(400, "ACCOUNT_CLOSED", "Reopen the account to revalue it");
    }
    const { rate } = await resolveRate(tx, c.var.deps, {
      budgetId,
      from: account.currency,
      to: budgetCurrency,
      date,
      today,
    });
    const native = (await accountBalances(tx, budgetId, date)).get(account.id)?.working ?? 0n;
    const booked =
      (await accountBalances(tx, budgetId, date, "base")).get(account.id)?.working ?? 0n;
    const delta = unrealizedGain(native, booked, account.currency, rate, budgetCurrency);
    if (delta === 0n) return null;
    const id = await insertTransaction(tx, {
      budgetId,
      accountId,
      date,
      amount: 0n,
      currency: account.currency,
      baseAmount: delta,
      fxRate: rate,
      payeeId: await internalPayeeId(tx, budgetId, "fx_revaluation"),
      categoryId: isOnBudget(account.type)
        ? await internalCategoryId(tx, budgetId, "ready_to_assign")
        : null,
      cleared: "cleared",
    });
    return { id, date, baseAmount: delta.toString(), fxRate: rate };
  });
  return c.json(
    { transaction: posted, account: await accountJson(db, budgetId, accountId, today, c.var.deps) },
    200,
  );
};
