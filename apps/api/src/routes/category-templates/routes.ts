import { createRoute, z } from "@hono/zod-openapi";
import { BUDGET_MONTH_PATTERN, zMinorUnits } from "@strictbudget/engine";
import { jsonError } from "../../lib/errors";
import { authSecurity, requireAuth } from "../../middleware/require-auth";
import { CategoryListSchema } from "../categories/routes";

const TemplateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    categoryCount: z.number().int(),
    groups: z
      .array(
        z.object({
          name: z.string(),
          categories: z.array(
            z.object({
              id: z.string().describe("The category's id within the template"),
              name: z.string(),
              amount: zMinorUnits.describe(
                "The example amount in the budget's currency, which becomes a 'Have a balance " +
                  "of' target; 0 for none",
              ),
            }),
          ),
        }),
      )
      .describe("In the template's order"),
  })
  .openapi("CategoryTemplate");

const BudgetParams = z.object({
  budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
});

const notFound = jsonError("No such budget or template, or the caller isn't a member");

export const listCategoryTemplates = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/category-templates",
  operationId: "listCategoryTemplates",
  tags: ["Categories"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "The category template gallery, with amounts in the budget's currency",
  request: { params: BudgetParams },
  responses: {
    200: {
      description: "Every template, by name",
      content: {
        "application/json": {
          schema: z.object({ templates: z.array(TemplateSchema) }).openapi("CategoryTemplateList"),
        },
      },
    },
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: notFound,
  },
});

export const importCategoryTemplate = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/category-templates/{templateId}/import",
  operationId: "importCategoryTemplate",
  tags: ["Categories"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Add a template's picked categories to the budget",
  description:
    "Nothing already there changes: a group the budget has (by name) takes the categories it's " +
    "missing at its top; the rest become new groups at the bottom. Categories the group already " +
    "has (by name) are skipped. Each new category with an example amount gets a 'Have a balance " +
    "of' target, due eventually, from `month` on.",
  request: {
    params: BudgetParams.extend({
      templateId: z.string().openapi({ param: { name: "templateId", in: "path" } }),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              categoryIds: z
                .array(z.string())
                .max(1000)
                .describe("The template categories to add (ids from the template list)"),
              month: z
                .string()
                .regex(BUDGET_MONTH_PATTERN, "Expected a month as YYYY-MM")
                .describe("The user's current month, YYYY-MM: when the new targets start"),
            })
            .openapi("ImportCategoryTemplate"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "How many categories were added, and the budget's categories now",
      content: {
        "application/json": {
          schema: z
            .object({ added: z.number().int(), categories: CategoryListSchema })
            .openapi("ImportCategoryTemplateResult"),
        },
      },
    },
    400: jsonError("Invalid input, or a category id that isn't in the template"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't edit categories, or the account's email address isn't confirmed",
    ),
    404: notFound,
  },
});
