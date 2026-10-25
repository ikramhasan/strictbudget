import { budgetAccount, payee, subTransaction, transaction } from "@strictbudget/db/schema";
import {
  ACCOUNT_TYPES,
  type AgeOfMoneyPart,
  accountFamily,
  countedAmount,
  type MoneyFlow,
} from "@strictbudget/engine";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "./ledger";

const CASH_TYPES = ACCOUNT_TYPES.filter((t) => accountFamily(t) === "cash");

/**
 * The money moving in and out of the budget's cash accounts up to `today`, in the order it was
 * entered within a day: what Age of Money reads (rules in the engine's `age-of-money.ts`). Amounts
 * are base amounts (the budget's currency); FX revaluations move no money and are left out.
 */
export async function ageOfMoneyFlows(
  db: Db,
  budgetId: string,
  today: string,
): Promise<MoneyFlow[]> {
  const other = alias(budgetAccount, "other_account");
  const rows = await db
    .select({
      id: transaction.id,
      date: transaction.date,
      amount: transaction.baseAmount,
      internalKind: payee.internalKind,
      otherType: other.type,
    })
    .from(transaction)
    .innerJoin(budgetAccount, eq(budgetAccount.id, transaction.accountId))
    .leftJoin(payee, eq(payee.id, transaction.payeeId))
    .leftJoin(other, eq(other.id, payee.transferAccountId))
    .where(
      and(
        eq(transaction.budgetId, budgetId),
        lte(transaction.date, today),
        inArray(budgetAccount.type, CASH_TYPES),
      ),
    )
    .orderBy(asc(transaction.date), asc(transaction.createdAt), asc(transaction.id));

  const lineOther = alias(budgetAccount, "line_other_account");
  const linePayee = alias(payee, "line_payee");
  const lines = await db
    .select({
      transactionId: subTransaction.transactionId,
      amount: subTransaction.baseAmount,
      otherType: lineOther.type,
    })
    .from(subTransaction)
    .innerJoin(transaction, eq(transaction.id, subTransaction.transactionId))
    .innerJoin(budgetAccount, eq(budgetAccount.id, transaction.accountId))
    .leftJoin(linePayee, eq(linePayee.id, subTransaction.payeeId))
    .leftJoin(lineOther, eq(lineOther.id, linePayee.transferAccountId))
    .where(
      and(
        eq(transaction.budgetId, budgetId),
        lte(transaction.date, today),
        inArray(budgetAccount.type, CASH_TYPES),
      ),
    );
  const splits = new Map<string, AgeOfMoneyPart[]>();
  for (const line of lines) {
    const parts = splits.get(line.transactionId) ?? [];
    parts.push({
      amount: line.amount,
      transferFamily: line.otherType ? accountFamily(line.otherType) : null,
    });
    splits.set(line.transactionId, parts);
  }

  const flows: MoneyFlow[] = [];
  for (const row of rows) {
    if (row.internalKind === "fx_revaluation") continue;
    const parts = splits.get(row.id) ?? [
      {
        amount: row.amount,
        transferFamily: row.otherType ? accountFamily(row.otherType) : null,
        startingBalance: row.internalKind === "starting_balance",
      },
    ];
    const amount = countedAmount(parts);
    if (amount !== 0n) flows.push({ date: row.date, amount });
  }
  return flows;
}
