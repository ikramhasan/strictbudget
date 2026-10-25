import { createRoute, z } from "@hono/zod-openapi";
import { FLAG_COLORS } from "@strictbudget/db/schema";
import { jsonError } from "../../lib/errors";
import { authSecurity, requireAuth } from "../../middleware/require-auth";

const FlagSchema = z
  .object({
    color: z.enum(FLAG_COLORS),
    name: z.string().describe("Empty when the color has no name"),
  })
  .openapi("Flag");

const FlagListSchema = z
  .object({ flags: z.array(FlagSchema).describe("All six colors, in display order") })
  .openapi("FlagList");

const BudgetParams = z.object({
  budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
});
const FlagParams = BudgetParams.extend({
  color: z.enum(FLAG_COLORS).openapi({ param: { name: "color", in: "path" } }),
});

const notFound = jsonError("No such budget, or the caller isn't a member");

export const listFlags = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/flags",
  operationId: "listFlags",
  tags: ["Transactions"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "The six flag colors and the budget's names for them",
  request: { params: BudgetParams },
  responses: {
    200: { description: "Flags", content: { "application/json": { schema: FlagListSchema } } },
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: notFound,
  },
});

export const renameFlag = createRoute({
  method: "put",
  path: "/budgets/{budgetId}/flags/{color}",
  operationId: "renameFlag",
  tags: ["Transactions"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Name a flag color for everyone on the budget (an empty name clears it)",
  request: {
    params: FlagParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ name: z.string().trim().max(50) }).openapi("RenameFlag"),
        },
      },
    },
  },
  responses: {
    200: { description: "Renamed", content: { "application/json": { schema: FlagSchema } } },
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't change transactions, or the account's email address isn't confirmed",
    ),
    404: notFound,
  },
});
