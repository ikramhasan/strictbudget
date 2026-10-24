import {
  budgetAccount,
  category,
  categoryGroup,
  payee,
  scheduledTransaction,
} from "@strictbudget/db/schema";
import {
  addMonths,
  type BudgetFormatSettings,
  type BudgetMonth,
  type CurrencyCode,
  monthBounds,
  occurrencesBetween,
} from "@strictbudget/engine";
import { and, eq, lte } from "drizzle-orm";
import { budgetMonthJson } from "../../routes/months/handlers";
import type { FxDeps } from "../base-amount";
import type { Db } from "../ledger";
import { reportLines, reportSums } from "../reports";

const TOP_GROUPS = 5;
const TOP_TARGETS = 3;
const TOP_TRANSACTIONS = 3;
const TOP_UPCOMING = 5;

export interface SummaryBudget extends BudgetFormatSettings {
  id: string;
  name: string;
  currency: CurrencyCode;
  expectedIncome?: bigint | null;
  createdAt?: Date;
}

/**
 * One budget's month in numbers, for the monthly summary email. Amounts are in the
 * budget's currency except an upcoming transaction's, which is in its account's. `spent` is the
 * Spending report's total for the month (category Activity), positive when money went out.
 */
export interface MonthlySummary {
  month: BudgetMonth;
  currency: CurrencyCode;
  income: bigint;
  spent: bigint;
  /** Last month's figures; null when the budget has no last month. */
  previous: { income: bigint; spent: bigint } | null;
  assigned: bigint;
  /** Ready to Assign at the end of the month. */
  readyToAssign: bigint;
  /** By spending, largest first; groups that spent nothing are left out. */
  groups: { name: string; spent: bigint }[];
  /** Categories that ended the month below zero, most overspent first. */
  overspent: {
    name: string;
    assigned: bigint;
    /** Positive when money went out. */
    spent: bigint;
    available: bigint;
    /** Overspent on a credit card (it doesn't come out of next month's Ready to Assign). */
    credit: boolean;
  }[];
  targets: {
    /** Targets asking something of the month (not snoozed, not hidden). */
    total: number;
    funded: number;
    partly: number;
    /** The ones still short, the largest shortfall first. */
    short: { name: string; funded: bigint; needed: bigint; dueDate: string | null }[];
  };
  largest: {
    payee: string | null;
    date: string;
    category: string | null;
    account: string;
    amount: bigint;
  }[];
  /**
   * Every visible category the month touched, with its spending in the three months before, in
   * list order. Not shown in the email: what the AI overview reads.
   */
  categories: {
    group: string;
    name: string;
    assigned: bigint;
    spent: bigint;
    available: bigint;
    target: { needed: bigint; funded: bigint; dueDate: string | null } | null;
    /** Spending in each of the three months before, oldest first. */
    spentBefore: bigint[];
  }[];
  /** Scheduled transactions dated in the next month, soonest first. */
  upcoming: {
    count: number;
    items: {
      payee: string | null;
      date: string;
      category: string | null;
      amount: bigint;
      currency: CurrencyCode;
    }[];
  };
}

export const isEmptySummary = (s: MonthlySummary) =>
  s.income === 0n && s.spent === 0n && s.assigned === 0n;

/** The budget's `month` as the summary shows it, read once the month is over. */
export async function monthlySummary(
  db: Db,
  fx: FxDeps,
  budget: SummaryBudget,
  month: BudgetMonth,
): Promise<MonthlySummary> {
  const { start, end } = monthBounds(month);
  const json = await budgetMonthJson(db, fx, budget, month, end);
  const previousMonth = addMonths(month, -1);
  const hasPrevious = previousMonth >= json.firstMonth;

  const categories = await db
    .select({
      id: category.id,
      name: category.name,
      groupName: categoryGroup.name,
      hidden: category.hidden,
      groupHidden: categoryGroup.hidden,
      internalKind: category.internalKind,
    })
    .from(category)
    .innerJoin(categoryGroup, eq(categoryGroup.id, category.groupId))
    .where(eq(category.budgetId, budget.id));
  const byId = new Map(categories.map((c) => [c.id, c]));
  const shown = (id: string) => {
    const c = byId.get(id);
    return c && !c.hidden && !c.groupHidden && c.internalKind === null ? c : undefined;
  };

  const total = async (kind: "spending" | "income", m: BudgetMonth) => {
    const bounds = monthBounds(m);
    const [sum] = await reportSums(
      db,
      budget.id,
      { kind, start: bounds.start, end: bounds.end },
      [],
    );
    return sum?.net ?? 0n;
  };
  const historyMonths = [-3, -2, -1].map((n) => addMonths(month, n));
  const [income, spending, previousIncome, previousSpending, groupSums, lines, history] =
    await Promise.all([
      total("income", month),
      total("spending", month),
      hasPrevious ? total("income", previousMonth) : null,
      hasPrevious ? total("spending", previousMonth) : null,
      reportSums(db, budget.id, { kind: "spending", start, end }, ["group"]),
      reportLines(
        db,
        budget.id,
        { kind: "spending", start, end },
        "largest_outflow",
        TOP_TRANSACTIONS,
      ),
      reportSums(
        db,
        budget.id,
        {
          kind: "spending",
          start: monthBounds(historyMonths[0] as BudgetMonth).start,
          end: monthBounds(previousMonth).end,
        },
        ["month", "category"],
      ),
    ]);
  const spentIn = new Map(
    history.map((h) => [`${h.keys.month}|${h.keys.category}`, -h.net] as const),
  );
  const groupNames = new Map(
    (
      await db
        .select({ id: categoryGroup.id, name: categoryGroup.name })
        .from(categoryGroup)
        .where(eq(categoryGroup.budgetId, budget.id))
    ).map((g) => [g.id, g.name]),
  );

  const details: MonthlySummary["categories"] = [];
  const overspent: MonthlySummary["overspent"] = [];
  const short: MonthlySummary["targets"]["short"] = [];
  let targets = 0;
  let funded = 0;
  let partly = 0;
  for (const c of json.categories) {
    const meta = shown(c.categoryId);
    if (!meta) continue;
    const available = BigInt(c.available);
    const spentBefore = historyMonths.map((m) => spentIn.get(`${m}|${c.categoryId}`) ?? 0n);
    const detail = {
      group: meta.groupName,
      name: meta.name,
      assigned: BigInt(c.assigned),
      spent: -BigInt(c.activity),
      available,
      target: c.target && {
        needed: BigInt(c.target.needed),
        funded: BigInt(c.target.funded),
        dueDate: c.target.dueDate,
      },
      spentBefore,
    };
    if (
      detail.assigned !== 0n ||
      detail.spent !== 0n ||
      detail.available !== 0n ||
      detail.target ||
      spentBefore.some((v) => v !== 0n)
    ) {
      details.push(detail);
    }
    if (available < 0n) {
      overspent.push({
        name: meta.name,
        assigned: BigInt(c.assigned),
        spent: -BigInt(c.activity),
        available,
        credit: BigInt(c.cashOverspent) === 0n && BigInt(c.creditOverspent) !== 0n,
      });
    }
    const t = c.target;
    if (!t || t.snoozed || t.beforeOpening || BigInt(t.needed) === 0n) continue;
    targets++;
    const underfunded = BigInt(t.underfunded);
    if (underfunded === 0n) {
      funded++;
      continue;
    }
    if (BigInt(t.funded) > 0n) partly++;
    short.push({
      name: meta.name,
      funded: BigInt(t.funded),
      needed: BigInt(t.needed),
      dueDate: t.dueDate,
    });
  }
  overspent.sort((a, b) => (a.available < b.available ? -1 : a.available > b.available ? 1 : 0));
  const gap = (s: (typeof short)[number]) => s.needed - s.funded;
  short.sort((a, b) => (gap(a) > gap(b) ? -1 : gap(a) < gap(b) ? 1 : 0));

  const groups = groupSums
    .map((g) => ({ name: groupNames.get(g.keys.group ?? "") ?? "Uncategorized", spent: -g.net }))
    .filter((g) => g.spent > 0n)
    .sort((a, b) => (a.spent > b.spent ? -1 : a.spent < b.spent ? 1 : 0))
    .slice(0, TOP_GROUPS);

  return {
    month,
    currency: budget.currency,
    income,
    spent: -spending,
    previous:
      previousIncome === null || previousSpending === null
        ? null
        : { income: previousIncome, spent: -previousSpending },
    assigned: -BigInt(json.readyToAssignBreakdown.assigned),
    readyToAssign: BigInt(json.readyToAssign),
    groups,
    overspent,
    targets: { total: targets, funded, partly, short: short.slice(0, TOP_TARGETS) },
    largest: lines
      .filter((l) => l.amount < 0n)
      .map((l) => ({
        payee: l.payeeName,
        date: l.date,
        category: l.categoryName,
        account: l.accountName,
        amount: -l.amount,
      })),
    categories: details,
    upcoming: await upcomingNextMonth(db, budget.id, month, byId),
  };
}

/** The scheduled transactions that fall in the month after `month`, in their accounts' currency. */
async function upcomingNextMonth(
  db: Db,
  budgetId: string,
  month: BudgetMonth,
  categories: ReadonlyMap<string, { name: string; internalKind: string | null }>,
): Promise<MonthlySummary["upcoming"]> {
  const after = monthBounds(month).end;
  const { end } = monthBounds(addMonths(month, 1));
  const schedules = await db
    .select({
      schedule: scheduledTransaction,
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
  const items: MonthlySummary["upcoming"]["items"] = [];
  for (const { schedule: s, payeeName, transferAccountId } of schedules) {
    const c = s.categoryId ? categories.get(s.categoryId) : undefined;
    const label = c
      ? c.internalKind === "ready_to_assign"
        ? "Ready to Assign"
        : c.internalKind === null
          ? c.name
          : null
      : transferAccountId
        ? "Transfer"
        : null;
    for (const date of occurrencesBetween(s, after, end)) {
      items.push({
        payee: payeeName,
        date,
        category: label,
        amount: s.amount,
        currency: s.currency,
      });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  return { count: items.length, items: items.slice(0, TOP_UPCOMING) };
}
