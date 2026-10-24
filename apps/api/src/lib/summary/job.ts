import {
  budget,
  budgetEmailPreference,
  budgetMember,
  budgetMonthlySummary,
  user,
  userPreference,
} from "@strictbudget/db/schema";
import { addMonths, monthBounds, monthOf } from "@strictbudget/engine";
import { and, eq, isNull, lt, notExists, sql } from "drizzle-orm";
import { anthropicAdapter } from "../ai/assistant";
import { aiSettings } from "../ai/settings";
import { enqueueEmail } from "../email/queue";
import type { JobHandler } from "../jobs";
import { serverToday } from "../ledger";
import { enterDueScheduled } from "../scheduled";
import { summaryOverview } from "./ai";
import { isEmptySummary, monthlySummary } from "./data";
import { monthlySummaryEmail } from "./email";
import { unsubscribeToken } from "./unsubscribe";

/**
 * The `summaries.monthly` job, on the 1st: one `summaries.budget` job for each
 * budget that existed before the month just ended and hasn't had its summary. A fresh start's old
 * budget (archived) gets none.
 */
export const queueMonthlySummaries: JobHandler<"summaries.monthly"> = async (deps, data) => {
  if (!deps.email) return;
  const month = data?.month ?? addMonths(monthOf(serverToday()), -1);
  const { start } = monthBounds(addMonths(month, 1));
  const due = await deps.db
    .select({ id: budget.id })
    .from(budget)
    .where(
      and(
        isNull(budget.archivedAt),
        lt(budget.createdAt, new Date(`${start}T00:00:00Z`)),
        notExists(
          deps.db
            .select({ one: sql`1` })
            .from(budgetMonthlySummary)
            .where(
              and(
                eq(budgetMonthlySummary.budgetId, budget.id),
                eq(budgetMonthlySummary.month, `${month}-01`),
              ),
            ),
        ),
      ),
    );
  for (const { id } of due) {
    await deps.jobs.send(
      deps.db,
      "summaries.budget",
      { budgetId: id, month },
      { singletonKey: `${id}:${month}` },
    );
  }
};

/**
 * The `summaries.budget` job: works out one budget's month, writes its AI overview when the budget
 * has AI on and a recipient wants it, and queues an email to each member who gets summaries. A
 * month with no money in, out or assigned sends nothing. The claim and the emails go in one
 * transaction, so a retry or a second run can't send them twice.
 */
export const sendBudgetSummary: JobHandler<"summaries.budget"> = async (
  deps,
  { budgetId, month },
) => {
  const { db, env } = deps;
  if (!deps.email) return;
  const [b] = await db.select().from(budget).where(eq(budget.id, budgetId));
  if (!b || b.archivedAt) return;
  const recipients = await db
    .select({
      userId: user.id,
      email: user.email,
      ai: sql<boolean>`coalesce(${userPreference.monthlySummaryAi}, true)`,
    })
    .from(budgetMember)
    .innerJoin(user, eq(user.id, budgetMember.userId))
    .leftJoin(userPreference, eq(userPreference.userId, user.id))
    .leftJoin(
      budgetEmailPreference,
      and(eq(budgetEmailPreference.userId, user.id), eq(budgetEmailPreference.budgetId, budgetId)),
    )
    .where(
      and(
        eq(budgetMember.budgetId, budgetId),
        eq(user.emailVerified, true),
        sql`coalesce(${userPreference.monthlySummaryEmail}, true)`,
        sql`coalesce(${budgetEmailPreference.monthlySummary}, true)`,
      ),
    );
  if (recipients.length === 0) return;

  const { end } = monthBounds(month);
  // Scheduled transactions dated in the month count, though nobody opened the budget since.
  await enterDueScheduled(db, deps, budgetId, end);
  const summary = await monthlySummary(db, deps, b, month);
  if (isEmptySummary(summary)) return;

  const adapter = deps.aiAdapter ?? anthropicAdapter(env);
  const overview =
    adapter && aiSettings(env, b).enabled && recipients.some((r) => r.ai)
      ? await summaryOverview(adapter, b, summary)
      : null;

  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .insert(budgetMonthlySummary)
      .values({ budgetId, month: `${month}-01` })
      .onConflictDoNothing()
      .returning({ budgetId: budgetMonthlySummary.budgetId });
    if (!claimed) return;
    for (const r of recipients) {
      const token = unsubscribeToken(r.userId, env.BETTER_AUTH_SECRET);
      const message = monthlySummaryEmail({
        to: r.email,
        webOrigin: env.WEB_ORIGIN,
        budget: b,
        summary,
        overview: r.ai ? overview : null,
        unsubscribeUrl: `${env.WEB_ORIGIN}/unsubscribe#${new URLSearchParams({ token })}`,
        oneClickUrl: `${env.BETTER_AUTH_URL}/v1/email/unsubscribe?${new URLSearchParams({ token })}`,
      });
      await enqueueEmail(deps.jobs, tx, env, message);
    }
  });
};
