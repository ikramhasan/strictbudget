import type { BudgetRole } from "@strictbudget/db/schema";
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

/**
 * Budget roles: the owner (creator) manages sharing, deletion and fresh start; everyone the budget
 * is shared with can do everything else, but a viewer can't change anything (and `viewerGuard`
 * refuses their writes before any route sees them). The plugin checks `organization` permissions
 * on its own endpoints, so budget-level actions use that resource name.
 */
export const budgetAc = createAccessControl({
  ...defaultStatements,
  category: ["create", "update", "delete"],
  account: ["create", "update", "delete"],
  transaction: ["create", "update", "delete"],
  budget: ["fresh_start", "assign"],
} as const);

export const budgetRoles = {
  owner: budgetAc.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    category: ["create", "update", "delete"],
    account: ["create", "update", "delete"],
    transaction: ["create", "update", "delete"],
    budget: ["fresh_start", "assign"],
  }),
  editor: budgetAc.newRole({
    organization: ["update"],
    category: ["create", "update", "delete"],
    account: ["create", "update", "delete"],
    transaction: ["create", "update", "delete"],
    budget: ["assign"],
  }),
  viewer: budgetAc.newRole({}),
} satisfies Record<BudgetRole, unknown>;

export type BudgetPermission = Parameters<(typeof budgetRoles)["owner"]["authorize"]>[0];
