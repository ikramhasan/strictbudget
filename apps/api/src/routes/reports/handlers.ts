import type { RouteHandler } from "@hono/zod-openapi";
import { type FlagColor, payee, transaction } from "@strictbudget/db/schema";
import { type BudgetMonth, monthBounds } from "@strictbudget/engine";
import { eq, inArray, sql } from "drizzle-orm";
import { loadBudgetAccess } from "../../lib/budget-access";
import { AppError } from "../../lib/errors";
import { serverToday } from "../../lib/ledger";
import { type ReportFilter, type ReportKind, reportLines, reportSums } from "../../lib/reports";
import { enterDueScheduled, entryDate } from "../../lib/scheduled";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppDeps, AppEnv } from "../../types";
import type { getReportActivity, listReportTransactions } from "./routes";

type Env = AppEnv & AuthedEnv;

interface ReportQuery {
  from: string;
  to: string;
  kind: ReportKind;
  accountIds?: string[];
  groupIds?: string[];
  categoryIds?: string[];
  payeeIds?: string[];
  flags?: string[];
  fromDate?: string;
  toDate?: string;
  today?: string;
}

/**
 * The filter a report query asks for, from the range's first day up to the user's today (entering
 * scheduled transactions due by then, as every read with a today does).
 */
async function reportFilter(
  deps: AppDeps,
  budgetId: string,
  query: ReportQuery,
): Promise<ReportFilter> {
  if (query.from > query.to) throw new AppError(400, "BAD_REQUEST", "`from` is after `to`");
  const today = query.today ?? serverToday();
  if (query.today) {
    await enterDueScheduled(deps.db, deps, budgetId, entryDate(deps, query.today));
  }
  const monthEnd = monthBounds(query.to as BudgetMonth).end;
  const monthStart = monthBounds(query.from as BudgetMonth).start;
  const start = query.fromDate && query.fromDate > monthStart ? query.fromDate : monthStart;
  const end = query.toDate && query.toDate < monthEnd ? query.toDate : monthEnd;
  const none = <T extends string>(values?: T[]) =>
    values?.map((v) => (v === "none" ? null : v)) as Exclude<T, "none">[] | undefined;
  return {
    kind: query.kind,
    start,
    end: end < today ? end : today,
    accountIds: query.accountIds,
    groupIds: query.groupIds,
    categoryIds: query.categoryIds,
    payeeIds: none(query.payeeIds),
    flags: none(query.flags) as ReportFilter["flags"],
  };
}

export const getReportActivityHandler: RouteHandler<typeof getReportActivity, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { groupBy = [], ...query } = c.req.valid("query");
  const { db } = c.var.deps;
  const { budget } = await loadBudgetAccess(c, budgetId);
  const filter = await reportFilter(c.var.deps, budgetId, query);
  const [sums, [first]] = await Promise.all([
    reportSums(db, budgetId, filter, groupBy),
    db
      .select({ month: sql<string | null>`to_char(min(${transaction.date}), 'YYYY-MM')` })
      .from(transaction)
      .where(eq(transaction.budgetId, budgetId)),
  ]);
  const payeeIds = [...new Set(sums.flatMap((s) => (s.keys.payee ? [s.keys.payee] : [])))];
  const payees = payeeIds.length
    ? await db
        .select({ id: payee.id, name: payee.name })
        .from(payee)
        .where(inArray(payee.id, payeeIds))
    : [];
  return c.json(
    {
      currency: budget.currency,
      payees,
      firstMonth: first?.month ?? null,
      rows: sums.map((s) => ({
        ...("month" in s.keys && { month: s.keys.month }),
        ...("day" in s.keys && { day: s.keys.day }),
        ...("group" in s.keys && { groupId: s.keys.group }),
        ...("category" in s.keys && { categoryId: s.keys.category }),
        ...("payee" in s.keys && { payeeId: s.keys.payee }),
        ...("account" in s.keys && { accountId: s.keys.account }),
        ...("flag" in s.keys && { flag: s.keys.flag as FlagColor | null }),
        outflow: s.outflow.toString(),
        inflow: s.inflow.toString(),
        net: s.net.toString(),
        count: s.count,
      })),
    },
    200,
  );
};

export const listReportTransactionsHandler: RouteHandler<
  typeof listReportTransactions,
  Env
> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { order, limit, ...query } = c.req.valid("query");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId);
  const filter = await reportFilter(c.var.deps, budgetId, query);
  // Total and count cover every match; only the listed lines are cut to `limit`.
  const [lines, [sum]] = await Promise.all([
    reportLines(db, budgetId, filter, order, limit),
    reportSums(db, budgetId, filter, []),
  ]);
  return c.json(
    {
      total: (sum?.net ?? 0n).toString(),
      count: sum?.count ?? 0,
      transactions: lines.map(({ createdAt: _, ...l }) => ({
        ...l,
        amount: l.amount.toString(),
        nativeAmount: l.nativeAmount.toString(),
      })),
    },
    200,
  );
};
