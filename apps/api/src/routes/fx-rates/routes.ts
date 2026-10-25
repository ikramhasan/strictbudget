import { createRoute, z } from "@hono/zod-openapi";
import { zCurrencyCode } from "@strictbudget/engine";
import { IsoDate } from "../../lib/dates";
import { jsonError } from "../../lib/errors";
import { zFxRate } from "../../lib/fx/rate-schema";
import { authSecurity, requireAuth } from "../../middleware/require-auth";

const zRate = zFxRate;

const FxRateSchema = z
  .object({
    from: zCurrencyCode,
    to: zCurrencyCode,
    date: IsoDate.describe("The date looked up (a future date is held back to today)"),
    rate: z.string().describe("1 `from` = `rate` `to`, a decimal string with up to 12 decimals"),
    rateDate: IsoDate.describe(
      "The date the rate is from: an earlier business day when markets were closed, or the " +
        "nearest earlier known rate when no provider could answer",
    ),
    source: z
      .enum(["identity", "override", "market"])
      .describe("`override`: the budget's own rate; `market`: a provider's daily rate"),
  })
  .openapi("FxRate");

const FxRateOverrideSchema = z
  .object({
    id: z.string(),
    date: IsoDate,
    currency: zCurrencyCode.describe("The foreign currency"),
    rate: z.string().describe("1 `currency` = `rate` × the budget's currency"),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("FxRateOverride");

const BudgetParams = z.object({
  budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
});
const OverrideParams = BudgetParams.extend({
  overrideId: z.string().openapi({ param: { name: "overrideId", in: "path" } }),
});

const notFound = jsonError("No such budget, or the caller isn't a member");

export const getFxRate = createRoute({
  tags: ["Exchange rates"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  method: "get",
  path: "/budgets/{budgetId}/fx-rates",
  operationId: "getFxRate",
  summary: "The exchange rate for a currency on a date (the budget's override, else market)",
  request: {
    params: BudgetParams,
    query: z.object({
      from: zCurrencyCode,
      to: zCurrencyCode.optional().describe("Defaults to the budget's currency"),
      date: IsoDate,
      today: IsoDate.optional().describe(
        "The user's today; a later `date` uses today's rate. Defaults to the server's UTC date.",
      ),
    }),
  },
  responses: {
    200: { description: "Rate", content: { "application/json": { schema: FxRateSchema } } },
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: notFound,
    422: jsonError("No rate is available for that currency and date (FX_RATE_UNAVAILABLE)"),
  },
});

export const listFxRateOverrides = createRoute({
  tags: ["Exchange rates"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  method: "get",
  path: "/budgets/{budgetId}/fx-rate-overrides",
  operationId: "listFxRateOverrides",
  summary: "The budget's own exchange rates, newest date first",
  request: { params: BudgetParams },
  responses: {
    200: {
      description: "Overrides",
      content: {
        "application/json": {
          schema: z
            .object({ overrides: z.array(FxRateOverrideSchema) })
            .openapi("FxRateOverrideList"),
        },
      },
    },
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: notFound,
  },
});

export const putFxRateOverride = createRoute({
  tags: ["Exchange rates"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  method: "put",
  path: "/budgets/{budgetId}/fx-rate-overrides",
  operationId: "putFxRateOverride",
  summary: "Set the budget's own rate for a currency on a date (replaces one already set)",
  request: {
    params: BudgetParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              date: IsoDate,
              currency: zCurrencyCode.describe("The foreign currency"),
              rate: zRate.describe("1 `currency` = `rate` × the budget's currency"),
            })
            .openapi("PutFxRateOverride"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Saved",
      content: { "application/json": { schema: FxRateOverrideSchema } },
    },
    400: jsonError("Invalid input, or the currency is the budget's own (SAME_CURRENCY)"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't change budget settings, or the account's email address isn't " +
        "confirmed",
    ),
    404: notFound,
  },
});

export const deleteFxRateOverride = createRoute({
  tags: ["Exchange rates"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  method: "delete",
  path: "/budgets/{budgetId}/fx-rate-overrides/{overrideId}",
  operationId: "deleteFxRateOverride",
  summary: "Remove one of the budget's own exchange rates",
  request: { params: OverrideParams },
  responses: {
    204: { description: "Deleted" },
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't change budget settings, or the account's email address isn't " +
        "confirmed",
    ),
    404: jsonError("No such budget or override, or the caller isn't a member"),
  },
});
