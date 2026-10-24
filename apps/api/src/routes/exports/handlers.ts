import type { RouteHandler } from "@hono/zod-openapi";
import {
  budgetAccount,
  category,
  categoryGroup,
  flagName,
  payee,
  subTransaction,
  transaction,
} from "@strictbudget/db/schema";
import {
  addMonths,
  type BudgetMonth,
  type CurrencyCode,
  EXPORT_BOM,
  EXPORT_NEWLINE,
  type ExportCategory,
  exportCategoryColumns,
  exportCleared,
  exportFlag,
  exportMonthLabel,
  exportQuote,
  exportSeparator,
  exportSplitMemo,
  exportText,
  formatAmount,
  formatDate,
  monthOf,
  PLAN_EXPORT_HEADER,
  REGISTER_EXPORT_FX_HEADER,
  REGISTER_EXPORT_HEADER,
} from "@strictbudget/engine";
import { and, asc, desc, eq, gt, inArray, lt, or, type SQL } from "drizzle-orm";
import type { Context } from "hono";
import { stream } from "hono/streaming";
import { loadBudgetAccess } from "../../lib/budget-access";
import { type Db, serverToday } from "../../lib/ledger";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import { budgetMonthJson } from "../months/handlers";
import { checkFilterAccount, selectedWhere } from "../transactions/bulk";
import { searchSettings } from "../transactions/handlers";
import type { exportPlan, exportRegister, exportSelectedTransactions } from "./routes";

type Env = AppEnv & AuthedEnv;
type BudgetRow = Awaited<ReturnType<typeof loadBudgetAccess>>["budget"];

const PAGE = 500;

const line = (cells: readonly string[], separator: string) => cells.join(separator);

function delimitedResponse(
  // biome-ignore lint/suspicious/noExplicitAny: any route's context
  c: Context<Env, any, any>,
  budget: BudgetRow,
  bom: boolean,
  write: (emit: (cells: readonly string[]) => Promise<void>) => Promise<void>,
) {
  const separator = exportSeparator(budget.numberFormat);
  c.header(
    "Content-Type",
    separator === "," ? "text/csv; charset=utf-8" : "text/tab-separated-values; charset=utf-8",
  );
  c.header("Cache-Control", "no-store");
  return stream(c, async (s) => {
    let first = true;
    await write(async (cells) => {
      const text = line(cells, separator);
      await s.write(first ? `${bom ? EXPORT_BOM : ""}${text}` : `${EXPORT_NEWLINE}${text}`);
      first = false;
    });
  }) as never;
}

const amountCell = (budget: BudgetRow, amount: bigint, currency: CurrencyCode) =>
  formatAmount({ amount, currency }, budget, { grouping: false });

export const exportPlanHandler: RouteHandler<typeof exportPlan, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const today = c.req.valid("query").today ?? serverToday();
  const { db } = c.var.deps;
  const { budget } = await loadBudgetAccess(c, budgetId);

  // Visible categories in list order (Credit Card Payments first), then hidden ones.
  const rows = await db
    .select({
      id: category.id,
      name: category.name,
      hidden: category.hidden,
      internalKind: category.internalKind,
      group: categoryGroup.name,
      groupHidden: categoryGroup.hidden,
      groupInternal: categoryGroup.internal,
    })
    .from(category)
    .innerJoin(categoryGroup, eq(categoryGroup.id, category.groupId))
    .where(eq(category.budgetId, budgetId))
    .orderBy(categoryGroup.sortOrder, category.sortOrder, category.id);
  const listed = rows.filter((r) => !r.groupInternal && !r.internalKind);
  const isHidden = (r: (typeof rows)[number]) => r.hidden || r.groupHidden;
  const ordered = [...listed.filter((r) => !isHidden(r)), ...listed.filter(isHidden)];

  return delimitedResponse(c, budget, true, async (emit) => {
    await emit(PLAN_EXPORT_HEADER.map(exportQuote));
    let month: BudgetMonth = monthOf(today);
    let last: BudgetMonth | null = null;
    for (let first = true; last === null || month <= last; first = false) {
      const json = await budgetMonthJson(db, c.var.deps, budget, month, today);
      if (first) {
        // The first call tells the range; start over from its first month.
        last = json.lastMonth;
        if (json.firstMonth !== month) {
          month = json.firstMonth;
          continue;
        }
      }
      const figures = new Map(json.categories.map((f) => [f.categoryId, f]));
      for (const r of ordered) {
        const f = figures.get(r.id);
        if (!f) continue;
        const [both, group, name] = exportCategoryColumns({
          name: r.name,
          group: r.group,
          hidden: isHidden(r),
          internalKind: null,
        });
        await emit([
          exportQuote(exportMonthLabel(month)),
          exportText(both),
          exportText(group),
          exportText(name),
          amountCell(budget, BigInt(f.assigned), budget.currency),
          amountCell(budget, BigInt(f.activity), budget.currency),
          amountCell(budget, BigInt(f.available), budget.currency),
        ]);
      }
      month = addMonths(month, 1);
    }
  });
};

interface RegisterRow {
  id: string;
  date: string;
  amount: bigint;
  currency: CurrencyCode;
  baseAmount: bigint;
  fxRate: string | null;
  memo: string;
  cleared: "uncleared" | "cleared" | "reconciled";
  flag: string | null;
  accountName: string;
  payeeName: string | null;
  category: ExportCategory | null;
}

const categoryColumns = {
  categoryName: category.name,
  categoryHidden: category.hidden,
  categoryKind: category.internalKind,
  groupName: categoryGroup.name,
  groupHidden: categoryGroup.hidden,
};

function categoryOf(r: {
  categoryName: string | null;
  categoryHidden: boolean | null;
  categoryKind: "ready_to_assign" | "uncategorized" | null;
  groupName: string | null;
  groupHidden: boolean | null;
}): ExportCategory | null {
  if (r.categoryName === null) return null;
  return {
    name: r.categoryName,
    group: r.groupName ?? "",
    hidden: Boolean(r.categoryHidden || r.groupHidden),
    internalKind: r.categoryKind,
  };
}

/**
 * Streams the register file: the budget's transactions (or those `where` picks), newest first,
 * then smallest amount first, a split as one row per line.
 */
async function writeRegister(
  db: Db,
  budget: BudgetRow,
  where: SQL | undefined,
  emit: (cells: readonly string[]) => Promise<void>,
) {
  const accounts = await db
    .select({ currency: budgetAccount.currency })
    .from(budgetAccount)
    .where(eq(budgetAccount.budgetId, budget.id));
  const multiCurrency = accounts.some((a) => a.currency !== budget.currency);
  const flagNames = new Map(
    (
      await db
        .select({ color: flagName.color, name: flagName.name })
        .from(flagName)
        .where(eq(flagName.budgetId, budget.id))
    ).map((f) => [f.color as string, f.name]),
  );

  await emit(
    [...REGISTER_EXPORT_HEADER, ...(multiCurrency ? REGISTER_EXPORT_FX_HEADER : [])].map(
      exportQuote,
    ),
  );

  const cells = (
    r: RegisterRow,
    payeeName: string | null,
    cat: ExportCategory | null,
    memo: string,
    amount: bigint,
    baseAmount: bigint,
  ) => {
    const [both, group, name] = exportCategoryColumns(cat);
    const out = [
      exportText(r.accountName),
      exportQuote(exportFlag(r.flag, r.flag ? flagNames.get(r.flag) : undefined)),
      exportQuote(formatDate(r.date, budget.dateFormat)),
      exportText(payeeName ?? ""),
      exportText(both),
      exportText(group),
      exportText(name),
      exportText(memo),
      amountCell(budget, amount < 0n ? -amount : 0n, r.currency),
      amountCell(budget, amount > 0n ? amount : 0n, r.currency),
      exportQuote(exportCleared(r.cleared)),
    ];
    if (multiCurrency) {
      out.push(
        exportQuote(r.currency),
        exportQuote(r.fxRate ?? ""),
        amountCell(budget, baseAmount < 0n ? -baseAmount : 0n, budget.currency),
        amountCell(budget, baseAmount > 0n ? baseAmount : 0n, budget.currency),
      );
    }
    return out;
  };

  let after: { date: string; amount: bigint; id: string } | null = null;
  for (;;) {
    const page: RegisterRow[] = (
      await db
        .select({
          id: transaction.id,
          date: transaction.date,
          amount: transaction.amount,
          currency: transaction.currency,
          baseAmount: transaction.baseAmount,
          fxRate: transaction.fxRate,
          memo: transaction.memo,
          cleared: transaction.cleared,
          flag: transaction.flag,
          accountName: budgetAccount.name,
          payeeName: payee.name,
          ...categoryColumns,
        })
        .from(transaction)
        .innerJoin(budgetAccount, eq(budgetAccount.id, transaction.accountId))
        .leftJoin(payee, eq(payee.id, transaction.payeeId))
        .leftJoin(category, eq(category.id, transaction.categoryId))
        .leftJoin(categoryGroup, eq(categoryGroup.id, category.groupId))
        .where(
          and(
            eq(transaction.budgetId, budget.id),
            where,
            after
              ? or(
                  lt(transaction.date, after.date),
                  and(eq(transaction.date, after.date), gt(transaction.amount, after.amount)),
                  and(
                    eq(transaction.date, after.date),
                    eq(transaction.amount, after.amount),
                    gt(transaction.id, after.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(transaction.date), asc(transaction.amount), asc(transaction.id))
        .limit(PAGE)
    ).map((r) => ({ ...r, category: categoryOf(r) }));
    if (page.length === 0) break;

    const lines = await db
      .select({
        transactionId: subTransaction.transactionId,
        amount: subTransaction.amount,
        baseAmount: subTransaction.baseAmount,
        memo: subTransaction.memo,
        payeeName: payee.name,
        ...categoryColumns,
      })
      .from(subTransaction)
      .leftJoin(payee, eq(payee.id, subTransaction.payeeId))
      .leftJoin(category, eq(category.id, subTransaction.categoryId))
      .leftJoin(categoryGroup, eq(categoryGroup.id, category.groupId))
      .where(
        inArray(
          subTransaction.transactionId,
          page.map((r) => r.id),
        ),
      )
      .orderBy(asc(subTransaction.sortOrder), asc(subTransaction.id));
    const linesOf = new Map<string, typeof lines>();
    for (const l of lines) {
      const list = linesOf.get(l.transactionId) ?? [];
      list.push(l);
      linesOf.set(l.transactionId, list);
    }

    for (const r of page) {
      const split = linesOf.get(r.id);
      if (split && split.length > 0) {
        for (const [i, l] of split.entries()) {
          await emit(
            cells(
              r,
              l.payeeName ?? r.payeeName,
              categoryOf(l),
              exportSplitMemo(i, split.length, l.memo),
              l.amount,
              l.baseAmount,
            ),
          );
        }
      } else {
        await emit(cells(r, r.payeeName, r.category, r.memo, r.amount, r.baseAmount));
      }
    }
    const tail = page[page.length - 1];
    if (!tail || page.length < PAGE) break;
    after = { date: tail.date, amount: tail.amount, id: tail.id };
  }
}

export const exportRegisterHandler: RouteHandler<typeof exportRegister, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { budget } = await loadBudgetAccess(c, budgetId);
  return delimitedResponse(c, budget, true, (emit) =>
    writeRegister(c.var.deps.db, budget, undefined, emit),
  );
};

export const exportSelectedTransactionsHandler: RouteHandler<
  typeof exportSelectedTransactions,
  Env
> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { selection } = c.req.valid("json");
  const { db } = c.var.deps;
  const { budget } = await loadBudgetAccess(c, budgetId);
  const settings = await searchSettings(
    db,
    budgetId,
    budget,
    await checkFilterAccount(db, budgetId, selection),
  );
  const where = selectedWhere(db, budgetId, selection, settings);
  return delimitedResponse(c, budget, false, (emit) => writeRegister(db, budget, where, emit));
};
