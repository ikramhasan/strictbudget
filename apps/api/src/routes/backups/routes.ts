import { createRoute, z } from "@hono/zod-openapi";
import { BackupSchema } from "../../lib/backup/schema";
import { jsonError } from "../../lib/errors";
import {
  authSecurity,
  requireAuth,
  requireSession,
  sessionSecurity,
} from "../../middleware/require-auth";
import { BudgetSchema } from "../budgets/routes";

const BudgetParams = z.object({
  budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
});

export const exportBackup = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/backup",
  operationId: "exportBackup",
  tags: ["Export"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "The whole budget as strictbudget's versioned JSON backup (streamed)",
  description:
    "Every table that belongs to the budget, in the " +
    "`BudgetBackup` layout: ids are only references inside the file, money is an integer " +
    "string of minor units next to its currency. Members, invitations and the change history " +
    "aren't included. Import it with `importBackup`.",
  request: { params: BudgetParams },
  responses: {
    200: {
      description: "The backup",
      content: { "application/json": { schema: BackupSchema } },
    },
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});

const ImportCountsSchema = z
  .record(z.string(), z.number().int())
  .describe("How many rows of each backup section were imported");

export const importBackup = createRoute({
  method: "post",
  path: "/budgets/import",
  operationId: "importBackup",
  tags: ["Budgets"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "Restore a backup as a new budget, owned by the caller",
  description:
    "Every row gets a new id and every reference is remapped, so the same backup can be " +
    "imported again (another copy) and the original budget is untouched. The budget is named " +
    "`name`, or the backup's name. The whole import succeeds or nothing is kept.",
  request: {
    query: z.object({
      name: z.string().trim().min(1).max(100).optional().describe("The new budget's name"),
    }),
    body: { required: true, content: { "application/json": { schema: BackupSchema } } },
  },
  responses: {
    201: {
      description: "The new budget and what it holds",
      content: {
        "application/json": {
          schema: z
            .object({ budget: BudgetSchema, counts: ImportCountsSchema })
            .openapi("ImportedBackup"),
        },
      },
    },
    400: jsonError(
      "Invalid input, or a backup that doesn't hold together (INVALID_BACKUP: e.g. a row that " +
        "refers to a missing account)",
    ),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
  },
});
