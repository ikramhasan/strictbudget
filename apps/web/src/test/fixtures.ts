import type { components } from "@strictbudget/api-client";

/** Auto-Assign amounts of a category without history or target, and nothing assigned. */
export const NO_AUTO_ASSIGN: components["schemas"]["AutoAssignAmounts"] = {
  underfunded: "0",
  reduceOverfunding: "0",
  assignedLastMonth: "0",
  spentLastMonth: "0",
  averageAssigned: "0",
  averageSpent: "0",
  resetAvailable: "0",
  resetAssigned: "0",
};
