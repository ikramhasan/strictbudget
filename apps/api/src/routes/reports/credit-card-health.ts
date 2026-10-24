import { createRoute, type RouteHandler, z } from "@hono/zod-openapi";
import { budgetAccount } from "@strictbudget/db/schema";
import {
  addMonths,
  BUDGET_MONTH_PATTERN,
  type BudgetMonth,
  CARD_COVERAGE,
  cardHealth,
  coverAmount,
  monthOf,
  zCurrencyCode,
  zMinorUnits,
} from "@strictbudget/engine";
import { and, asc, eq } from "drizzle-orm";
import { loadBudgetAccess } from "../../lib/budget-access";
import { AppError, jsonError } from "../../lib/errors";
import { serverToday } from "../../lib/ledger";
import { enterDueScheduled, entryDate } from "../../lib/scheduled";
import { type AuthedEnv, authSecurity, requireAuth } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import { monthRange, monthState } from "../months/handlers";

type Env = AppEnv & AuthedEnv;

const Month = z.string().regex(BUDGET_MONTH_PATTERN, "Expected a month as YYYY-MM");

const MAX_MONTHS = 12;

const BudgetParams = z.object({
  budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
});

export const getCreditCardHealth = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/reports/credit-card-health",
  operationId: "getCreditCardHealth",
  tags: ["Reports"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary:
    "Credit card health: each card's balance against what its payment category has set aside",
  description:
    "Per open credit card or line of credit: the balance owed, the payment " +
    "category's Available, and the gap between them, which is the plan screen's Underfunded for " +
    "the card (so the numbers equal it). `status` is covered (nothing lacks), partial or unfunded " +
    "(none of the balance is set aside). The gap is split into this month's credit overspending " +
    "and everything else. `series` has each month's spending, payments, balance and Available, " +
    "oldest first, from the month the card opened. `float` is what all cards' payment categories " +
    "lacked at each month's end: debt carried on money still to come. `cover` is what Ready to " +
    "Assign could put toward a card's gap: Ready to Assign shared out across the cards in order, " +
    "so doing every card's cover never takes it below zero. A month before the plan's first is a 400.",
  request: {
    params: BudgetParams,
    query: z.object({
      month: Month.optional().describe("The last month shown, YYYY-MM; defaults to today's"),
      months: z.coerce
        .number()
        .int()
        .min(1)
        .max(MAX_MONTHS)
        .optional()
        .describe(`How many months the series covers, ending at \`month\`; default 6`),
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
      description: "Every card's health",
      content: {
        "application/json": {
          schema: z
            .object({
              month: Month,
              currency: zCurrencyCode,
              asOf: z.iso.date().describe("The user's today"),
              firstMonth: Month.describe("The oldest month the plan shows"),
              readyToAssign: zMinorUnits.describe("Ready to Assign for `month`"),
              totals: z.object({
                balance: zMinorUnits.describe("Owed across all cards"),
                covered: zMinorUnits,
                unfunded: zMinorUnits.describe("The cards' gaps added up"),
              }),
              float: z
                .array(z.object({ month: Month, carried: zMinorUnits }))
                .describe("Oldest first; what the cards' payment categories lacked at month end"),
              cards: z.array(
                z.object({
                  accountId: z.string(),
                  name: z.string(),
                  type: z.enum(["credit_card", "line_of_credit"]),
                  categoryId: z.string().describe("The card's payment category"),
                  balance: zMinorUnits.describe("Owed at the end of `month`, never negative"),
                  available: zMinorUnits.describe("The payment category's Available"),
                  status: z.enum(CARD_COVERAGE),
                  covered: zMinorUnits,
                  gap: zMinorUnits,
                  fromCreditOverspending: zMinorUnits,
                  other: zMinorUnits,
                  cover: zMinorUnits.describe(
                    "What Ready to Assign could assign to close the gap, after the cards before it",
                  ),
                  series: z.array(
                    z.object({
                      month: Month,
                      spending: zMinorUnits.describe("Outflows on the card that month, positive"),
                      payments: zMinorUnits.describe("Inflows (payments, returns), positive"),
                      balance: zMinorUnits.describe("Owed at the month's end, never negative"),
                      available: zMinorUnits,
                    }),
                  ),
                }),
              ),
            })
            .openapi("CreditCardHealth"),
        },
      },
    },
    400: jsonError("A future month, or one before the plan's first"),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});

export const getCreditCardHealthHandler: RouteHandler<typeof getCreditCardHealth, Env> = async (
  c,
) => {
  const { budgetId } = c.req.valid("param");
  const query = c.req.valid("query");
  const deps = c.var.deps;
  const { budget } = await loadBudgetAccess(c, budgetId);
  const today = entryDate(deps, query.today ?? serverToday());
  const month = (query.month ?? monthOf(today)) as BudgetMonth;
  if (month > monthOf(today)) {
    throw new AppError(400, "BAD_REQUEST", "A future month has no card health yet");
  }
  if (query.today) await enterDueScheduled(deps.db, deps, budgetId, today);
  const range = await monthRange(deps.db, budgetId, today);
  if (month < range.first) {
    throw new AppError(400, "BAD_REQUEST", "That month is before the plan's first");
  }

  const accounts = await deps.db
    .select({ id: budgetAccount.id, name: budgetAccount.name, type: budgetAccount.type })
    .from(budgetAccount)
    .where(and(eq(budgetAccount.budgetId, budgetId), eq(budgetAccount.closed, false)))
    .orderBy(asc(budgetAccount.sortOrder), asc(budgetAccount.id));
  const cards = accounts.flatMap((a) =>
    a.type === "credit_card" || a.type === "line_of_credit" ? [{ ...a, type: a.type }] : [],
  );

  const count = query.months ?? 6;
  const states = [];
  for (let i = count - 1; i >= 0; i--) {
    const m = addMonths(month, -i);
    states.push({ month: m, state: await monthState(deps.db, deps, budget, m, today) });
  }
  const shown = states.filter((s) => s.month >= range.first);
  const last = shown[shown.length - 1]?.state;
  const readyToAssign = last?.rta.readyToAssign ?? 0n;

  let unassigned = readyToAssign;
  const rows = cards.flatMap((card) => {
    const series = shown.flatMap(({ month: m, state }) => {
      const l = state.listed.find((x) => x.payment?.accountId === card.id);
      if (!l?.payment || l.beforeOpening) return [];
      const reg = state.register.get(card.id);
      return [
        {
          month: m,
          spending: -BigInt(reg?.outflows ?? "0"),
          payments: BigInt(reg?.inflows ?? "0"),
          balance: l.payment.owed,
          available: l.figures.available,
          underfunded: l.payment.underfunded,
          fromOverspending: l.payment.fromOverspending,
          categoryId: l.categoryId,
        },
      ];
    });
    const latest = series[series.length - 1];
    if (!latest || latest.month !== month) return [];
    const health = cardHealth(latest.balance, latest.underfunded, latest.fromOverspending);
    // Ready to Assign is shared out in card order, so every cover together stays within it.
    const cover = coverAmount(health.gap, unassigned);
    unassigned -= cover;
    return [{ card, latest, health, series, cover }];
  });

  const float = shown.map(({ month: m, state }) => ({
    month: m,
    carried: state.listed.reduce((sum, l) => sum + (l.payment?.underfunded ?? 0n), 0n),
  }));

  return c.json(
    {
      month,
      currency: budget.currency,
      asOf: today,
      firstMonth: range.first,
      readyToAssign: readyToAssign.toString(),
      totals: {
        balance: rows.reduce((sum, r) => sum + r.latest.balance, 0n).toString(),
        covered: rows.reduce((sum, r) => sum + r.health.covered, 0n).toString(),
        unfunded: rows.reduce((sum, r) => sum + r.health.gap, 0n).toString(),
      },
      float: float.map((f) => ({ month: f.month, carried: f.carried.toString() })),
      cards: rows.map(({ card, latest, health, series, cover }) => ({
        accountId: card.id,
        name: card.name,
        type: card.type,
        categoryId: latest.categoryId,
        balance: latest.balance.toString(),
        available: latest.available.toString(),
        status: health.status,
        covered: health.covered.toString(),
        gap: health.gap.toString(),
        fromCreditOverspending: health.fromCreditOverspending.toString(),
        other: health.other.toString(),
        cover: cover.toString(),
        series: series.map((s) => ({
          month: s.month,
          spending: s.spending.toString(),
          payments: s.payments.toString(),
          balance: s.balance.toString(),
          available: s.available.toString(),
        })),
      })),
    },
    200,
  );
};
