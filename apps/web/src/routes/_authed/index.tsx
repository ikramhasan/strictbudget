import { createFileRoute, redirect } from "@tanstack/react-router";
import { budgetsQueryOptions, pickBudgetRedirect } from "@/lib/budgets";
import { pendingInvitation } from "@/lib/pending-invitation";
import { preferencesQueryOptions } from "@/lib/preferences";

/**
 * "/" opens an invitation opened before signing in, else the last-used budget (the budget list
 * when that option is off), else the first one, else the create form.
 */
export const Route = createFileRoute("/_authed/")({
  beforeLoad: async ({ context }) => {
    if (pendingInvitation()) throw redirect({ to: "/invitation", replace: true });
    const [list, preferences] = await Promise.all([
      context.queryClient.fetchQuery({ ...budgetsQueryOptions(), staleTime: 0 }),
      context.queryClient.fetchQuery({ ...preferencesQueryOptions(), staleTime: 0 }),
    ]);
    // "Open last used budget by default" off: the budget list instead.
    if (!preferences.openLastBudget && list.budgets.length > 0) {
      throw redirect({ to: "/budgets", replace: true });
    }
    const budgetId = pickBudgetRedirect(list);
    if (budgetId) throw redirect({ to: "/budgets/$budgetId", params: { budgetId }, replace: true });
    throw redirect({ to: "/budgets/new", replace: true });
  },
});
