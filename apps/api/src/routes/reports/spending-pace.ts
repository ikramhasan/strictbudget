import { createRoute, type RouteHandler, z } from "@hono/zod-openapi";
import {
  category,
  categoryGroup,
  categoryTarget,
  PACE_SETTINGS,
  scheduledSubTransaction,
  scheduledTransaction,
} from "@strictbudget/db/schema";
import {
  addActivity,
  BUDGET_MONTH_PATTERN,
  type BudgetMonth,
  monthBounds,
  monthOf,
  PACE_STATUSES,
  type Pace,
  spendingPace,
  zCurrencyCode,
  zMinorUnits,
} from "@strictbudget/engine";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { loadBudgetAccess } from "../../lib/budget-access";
import { AppError, jsonError } from "../../lib/errors";
import type { Db } from "../../lib/ledger";
import { reportSums } from "../../lib/reports";
import { enterDueScheduled, entryDate, userToday } from "../../lib/scheduled";
import { type AuthedEnv, authSecurity, requireAuth } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import { budgetMonthJson } from "../months/handlers";

type Env = AppEnv & AuthedEnv;

const Month = z.string().regex(BUDGET_MONTH_PATTERN, "Expected a month as YYYY-MM");

/** Why the automatic rule leaves a category out of pace. */
const PACE_REASONS = ["bill", "saving", "scheduled", "hidden"] as const;
type PaceReason = (typeof PACE_REASONS)[number];

const PaceSummarySchema = z.object({
  start: zMinorUnits.describe("Available carried in plus this month's Assigned"),
  spent: zMinorUnits.describe("Net spending so far; negative when refunds outweigh it"),
  remaining: zMinorUnits,
  usedPercent: z.number().nullable().describe("`spent` of `start`; null when `start` ≤ 0"),
  status: z.enum(PACE_STATUSES).nullable(),
  safePerDay: zMinorUnits
    .nullable()
    .describe("Per day for the rest of the month, today included, rounded down; null when past"),
  projectedEnd: zMinorUnits.describe("Left at the month's end at the pace so far"),
  runOutDate: z.iso
    .date()
    .nullable()
    .describe("When the money went (or at this pace will go) below zero; null if it lasts"),
});

const PaceSchema = PaceSummarySchema.extend({
  points: z.array(
    z.object({
      date: z.iso.date(),
      remaining: zMinorUnits.nullable().describe("Left at the day's end; null for days to come"),
      ideal: zMinorUnits.describe("Left at the day's end at an even pace to zero"),
    }),
  ),
}).openapi("SpendingPaceLine");

const BudgetParams = z.object({
  budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
});

export const getSpendingPace = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/reports/spending-pace",
  operationId: "getSpendingPace",
  tags: ["Reports"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "A month's spending pace: money left to spend day by day against an even pace",
  description:
    "Money to spend is each category's Available carried in plus the month's " +
    "Assigned; spending is its net activity. The plan's line adds up the categories in pace: " +
    "card payment categories never are; by default bills (a monthly target due on a set day, a " +
    'dated yearly or custom target, a debt target), savings (marked "Counts as saving", or a ' +
    '"Have a balance of" target), ' +
    "categories with a scheduled transaction and hidden ones aren't either, and a category's own setting overrides that. `groupId` or " +
    "`categoryId` picks the line instead. A past month is finished; a future one is a 400.",
  request: {
    params: BudgetParams,
    query: z.object({
      month: Month.optional().describe("The month, YYYY-MM; defaults to today's"),
      groupId: z.string().optional().describe("The line for this group's categories in pace"),
      categoryId: z.string().optional().describe("The line for this one category"),
      today: z.iso
        .date()
        .optional()
        .describe(
          "The user's today; later transactions don't count. Defaults to the server's UTC date.",
        ),
    }),
  },
  responses: {
    200: {
      description: "The month's pace",
      content: {
        "application/json": {
          schema: z
            .object({
              month: Month,
              currency: zCurrencyCode,
              asOf: z.iso.date().describe("The user's today"),
              days: z.number().int(),
              elapsed: z.number().int().describe("Days passed, today included"),
              finished: z.boolean(),
              line: PaceSchema.describe("The plan's line, or the group's or category's asked for"),
              categories: z.array(
                z.object({
                  categoryId: z.string(),
                  name: z.string(),
                  groupId: z.string(),
                  groupName: z.string(),
                  included: z.boolean().describe("Counted in the plan's line"),
                  setting: z.enum(PACE_SETTINGS).nullable().describe("Null follows `reason`"),
                  reason: z
                    .enum(PACE_REASONS)
                    .nullable()
                    .describe("Why the automatic rule leaves it out; null when it keeps it"),
                  pace: PaceSummarySchema,
                }),
              ),
            })
            .openapi("SpendingPace"),
        },
      },
    },
    400: jsonError("A future month, or a group or category that isn't in pace's list"),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});

export const setCategoryPace = createRoute({
  method: "put",
  path: "/budgets/{budgetId}/reports/spending-pace/categories/{categoryId}",
  operationId: "setCategoryPace",
  tags: ["Reports"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Keep a category in or out of spending pace",
  description:
    "Null goes back to the automatic rule (bills, savings, scheduled and hidden out; savings are " +
    'categories marked "Counts as saving" and ones with a "Have a balance of" target).',
  request: {
    params: BudgetParams.extend({
      categoryId: z.string().openapi({ param: { name: "categoryId", in: "path" } }),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ pace: z.enum(PACE_SETTINGS).nullable() }).openapi("SetCategoryPace"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The category's setting",
      content: {
        "application/json": {
          schema: z
            .object({ categoryId: z.string(), pace: z.enum(PACE_SETTINGS).nullable() })
            .openapi("CategoryPace"),
        },
      },
    },
    400: jsonError("Invalid setting, or a category pace doesn't list (card payments, internal)"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't change categories, or the account's email address isn't confirmed",
    ),
    404: jsonError("No such budget or category, or the caller isn't a member"),
  },
});

/** The categories pace lists: everything a person spends from (no internal or card payment ones). */
async function paceCategories(db: Db, budgetId: string) {
  return db
    .select({
      id: category.id,
      name: category.name,
      hidden: category.hidden,
      pace: category.pace,
      countsAsSaving: category.countsAsSaving,
      groupId: categoryGroup.id,
      groupName: categoryGroup.name,
      groupHidden: categoryGroup.hidden,
    })
    .from(category)
    .innerJoin(categoryGroup, eq(categoryGroup.id, category.groupId))
    .where(
      and(
        eq(category.budgetId, budgetId),
        eq(categoryGroup.internal, false),
        // Card payment categories sit in their own group, each linked to its account.
        isNull(categoryGroup.kind),
        isNull(category.linkedAccountId),
      ),
    )
    .orderBy(asc(categoryGroup.sortOrder), asc(category.sortOrder), asc(category.id));
}

/** Bills and lump sums: what the automatic rule leaves out, per category. */
async function automaticReasons(db: Db, budgetId: string): Promise<Map<string, PaceReason>> {
  const reasons = new Map<string, PaceReason>();
  const [targets, scheduled, scheduledLines] = await Promise.all([
    db.select().from(categoryTarget).where(eq(categoryTarget.budgetId, budgetId)),
    db
      .selectDistinct({ categoryId: scheduledTransaction.categoryId })
      .from(scheduledTransaction)
      .where(
        and(
          eq(scheduledTransaction.budgetId, budgetId),
          isNotNull(scheduledTransaction.categoryId),
        ),
      ),
    db
      .selectDistinct({ categoryId: scheduledSubTransaction.categoryId })
      .from(scheduledSubTransaction)
      .innerJoin(
        scheduledTransaction,
        eq(scheduledTransaction.id, scheduledSubTransaction.scheduledTransactionId),
      )
      .where(
        and(
          eq(scheduledTransaction.budgetId, budgetId),
          isNotNull(scheduledSubTransaction.categoryId),
        ),
      ),
  ]);
  for (const s of [...scheduled, ...scheduledLines]) {
    if (s.categoryId) reasons.set(s.categoryId, "scheduled");
  }
  for (const t of targets) {
    // "Have a balance of…" is saving up, not spending (as is a category marked "Counts as saving",
    // checked in the handler).
    if (t.behavior === "balance") {
      reasons.set(t.categoryId, "saving");
      continue;
    }
    const dated =
      (t.cadence === "monthly" && t.dueDay !== null) ||
      ((t.cadence === "yearly" || t.cadence === "custom") && t.dueDate !== null) ||
      t.cadence === "debt_monthly";
    if (dated) reasons.set(t.categoryId, "bill");
  }
  return reasons;
}

const summaryJson = (p: Pace) => ({
  start: p.start.toString(),
  spent: p.spent.toString(),
  remaining: p.remaining.toString(),
  usedPercent: p.usedPercent,
  status: p.status,
  safePerDay: p.safePerDay?.toString() ?? null,
  projectedEnd: p.projectedEnd.toString(),
  runOutDate: p.runOutDate,
});

export const getSpendingPaceHandler: RouteHandler<typeof getSpendingPace, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const query = c.req.valid("query");
  const deps = c.var.deps;
  const { budget } = await loadBudgetAccess(c, budgetId);
  const today = userToday(deps, query.today);
  const month = (query.month ?? monthOf(today)) as BudgetMonth;
  if (month > monthOf(today)) {
    throw new AppError(400, "BAD_REQUEST", "A future month has no spending pace yet");
  }
  if (query.today) await enterDueScheduled(deps.db, deps, budgetId, entryDate(deps, query.today));

  const { start, end } = monthBounds(month);
  const [plan, categories, reasons, sums] = await Promise.all([
    budgetMonthJson(deps.db, deps, budget, month, today),
    paceCategories(deps.db, budgetId),
    automaticReasons(deps.db, budgetId),
    reportSums(deps.db, budgetId, { kind: "spending", start, end: end < today ? end : today }, [
      "category",
      "day",
    ]),
  ]);
  const figures = new Map(plan.categories.map((f) => [f.categoryId, f]));
  const activity = new Map<string, Map<string, bigint>>();
  for (const s of sums) {
    const id = s.keys.category;
    const day = s.keys.day;
    if (!id || !day) continue;
    const days = activity.get(id) ?? new Map<string, bigint>();
    days.set(day, (days.get(day) ?? 0n) + s.net);
    activity.set(id, days);
  }

  const listed = categories.flatMap((cat) => {
    const f = figures.get(cat.id);
    if (!f) return [];
    // Hidden first, then "Counts as saving" (savings rate's setting), then targets and schedules:
    // an investment category with a scheduled transfer is saving, not a scheduled bill.
    const reason: PaceReason | null =
      cat.hidden || cat.groupHidden
        ? "hidden"
        : cat.countsAsSaving
          ? "saving"
          : (reasons.get(cat.id) ?? null);
    const included = cat.pace ? cat.pace === "include" : reason === null;
    const input = {
      month,
      today,
      start: BigInt(f.available) - BigInt(f.activity),
      activity: activity.get(cat.id) ?? new Map<string, bigint>(),
    };
    return [{ cat, reason, included, input }];
  });

  const subject = query.categoryId
    ? listed.filter((l) => l.cat.id === query.categoryId)
    : listed.filter((l) => l.included && (!query.groupId || l.cat.groupId === query.groupId));
  const known = query.categoryId
    ? subject.length > 0
    : !query.groupId || listed.some((l) => l.cat.groupId === query.groupId);
  if (!known)
    throw new AppError(400, "BAD_REQUEST", "That group or category isn't in spending pace");
  const line = spendingPace({
    month,
    today,
    start: subject.reduce((sum, l) => sum + l.input.start, 0n),
    activity: addActivity(subject.map((l) => l.input.activity)),
  });
  if (!line) throw new AppError(400, "BAD_REQUEST", "A future month has no spending pace yet");

  return c.json(
    {
      month,
      currency: budget.currency,
      asOf: today,
      days: line.days,
      elapsed: line.elapsed,
      finished: line.finished,
      line: {
        ...summaryJson(line),
        points: line.points.map((p) => ({
          date: p.date,
          remaining: p.remaining?.toString() ?? null,
          ideal: p.ideal.toString(),
        })),
      },
      categories: listed.map((l) => {
        // spendingPace only returns null for a future month, refused above.
        const pace = spendingPace(l.input) as Pace;
        return {
          categoryId: l.cat.id,
          name: l.cat.name,
          groupId: l.cat.groupId,
          groupName: l.cat.groupName,
          included: l.included,
          setting: l.cat.pace,
          reason: l.reason,
          pace: summaryJson(pace),
        };
      }),
    },
    200,
  );
};

export const setCategoryPaceHandler: RouteHandler<typeof setCategoryPace, Env> = async (c) => {
  const { budgetId, categoryId } = c.req.valid("param");
  const { pace } = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { category: ["update"] });
  const [row] = await db
    .select({
      internalKind: category.internalKind,
      linkedAccountId: category.linkedAccountId,
      groupKind: categoryGroup.kind,
    })
    .from(category)
    .innerJoin(categoryGroup, eq(categoryGroup.id, category.groupId))
    .where(and(eq(category.id, categoryId), eq(category.budgetId, budgetId)));
  if (!row) throw new AppError(404, "NOT_FOUND", "Category not found");
  if (row.internalKind || row.linkedAccountId || row.groupKind) {
    throw new AppError(400, "BAD_REQUEST", "Spending pace doesn't list this category");
  }
  await db.update(category).set({ pace }).where(eq(category.id, categoryId));
  return c.json({ categoryId, pace }, 200);
};
