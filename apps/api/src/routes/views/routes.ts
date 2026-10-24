import { createRoute, z } from "@hono/zod-openapi";
import { MAX_CUSTOM_VIEWS, PRESET_BUDGET_VIEWS } from "@strictbudget/db/schema";
import { jsonError } from "../../lib/errors";
import { authSecurity, requireAuth } from "../../middleware/require-auth";

const ViewSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    categoryIds: z
      .array(z.string())
      .describe("The categories in the view, hidden ones included (a view leaves them out)"),
  })
  .openapi("BudgetView");

const ViewListSchema = z
  .object({
    order: z
      .array(z.string())
      .describe(
        `The rearrangeable views in order: preset keys (${PRESET_BUDGET_VIEWS.join(", ")}) and ` +
          "custom view ids. All and Overspent always come first.",
      ),
    views: z.array(ViewSchema).describe(`The custom views (at most ${MAX_CUSTOM_VIEWS})`),
  })
  .openapi("BudgetViewList");

const Name = z.string().trim().min(1, "The view name is required.").max(50);
const CategoryIds = z
  .array(z.string())
  .max(10_000)
  .describe("Categories of this budget; Ready to Assign and Uncategorized can't be in a view");

const BudgetParams = z.object({
  budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
});
const ViewParams = BudgetParams.extend({
  viewId: z.string().openapi({ param: { name: "viewId", in: "path" } }),
});

function json<T extends z.ZodType>(schema: T) {
  return { required: true, content: { "application/json": { schema } } } as const;
}

const forbidden = jsonError(
  "The caller's role can't change views, or the account's email address isn't confirmed",
);
const listResponse = {
  description: "The budget's views",
  content: { "application/json": { schema: ViewListSchema } },
};

export const listViews = createRoute({
  tags: ["Views"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  method: "get",
  path: "/budgets/{budgetId}/views",
  operationId: "listViews",
  summary: "The budget's custom views and the order of the rearrangeable views",
  request: { params: BudgetParams },
  responses: {
    200: listResponse,
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});

export const createView = createRoute({
  tags: ["Views"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  method: "post",
  path: "/budgets/{budgetId}/views",
  operationId: "createView",
  summary: "Add a custom view; it goes after the existing views",
  request: {
    params: BudgetParams,
    body: json(z.object({ name: Name, categoryIds: CategoryIds }).openapi("CreateBudgetView")),
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: ViewSchema } } },
    400: jsonError("Invalid input, or a category that isn't the budget's"),
    401: jsonError("Not signed in"),
    403: forbidden,
    404: jsonError("No such budget, or the caller isn't a member"),
    409: jsonError(
      `The name is taken (VIEW_NAME_TAKEN) or the budget has ${MAX_CUSTOM_VIEWS} custom views ` +
        "(VIEW_LIMIT)",
    ),
  },
});

export const updateView = createRoute({
  tags: ["Views"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  method: "patch",
  path: "/budgets/{budgetId}/views/{viewId}",
  operationId: "updateView",
  summary: "Rename a custom view or change its categories",
  request: {
    params: ViewParams,
    body: json(
      z
        .object({ name: Name.optional(), categoryIds: CategoryIds.optional() })
        .openapi("UpdateBudgetView"),
    ),
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: ViewSchema } } },
    400: jsonError("Invalid input, or a category that isn't the budget's"),
    401: jsonError("Not signed in"),
    403: forbidden,
    404: jsonError("No such budget or view, or the caller isn't a member"),
    409: jsonError("The name is taken (VIEW_NAME_TAKEN)"),
  },
});

export const deleteView = createRoute({
  tags: ["Views"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  method: "delete",
  path: "/budgets/{budgetId}/views/{viewId}",
  operationId: "deleteView",
  summary: "Delete a custom view (preset views can't be deleted)",
  request: { params: ViewParams },
  responses: {
    204: { description: "Deleted" },
    401: jsonError("Not signed in"),
    403: forbidden,
    404: jsonError("No such budget or view, or the caller isn't a member"),
  },
});

export const reorderViews = createRoute({
  tags: ["Views"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  method: "put",
  path: "/budgets/{budgetId}/views/order",
  operationId: "reorderViews",
  summary: "Rearrange the preset and custom views (Manage Views)",
  request: {
    params: BudgetParams,
    body: json(
      z
        .object({
          order: z
            .array(z.string())
            .max(PRESET_BUDGET_VIEWS.length + MAX_CUSTOM_VIEWS)
            .describe("Every preset key and custom view id, once each, in the new order"),
        })
        .openapi("ReorderBudgetViews"),
    ),
  },
  responses: {
    200: listResponse,
    400: jsonError("The order isn't exactly the budget's rearrangeable views"),
    401: jsonError("Not signed in"),
    403: forbidden,
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});
