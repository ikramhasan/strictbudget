import { Button } from "@strictbudget/ui/components/button";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, Outlet } from "@tanstack/react-router";
import { Eye, House } from "lucide-react";
import { AiAssistant } from "@/components/ai-assistant";
import { StatusLayout } from "@/components/error-screen";
import { FileDropImport } from "@/components/file-import";
import { ManagePayeesProvider } from "@/components/manage-payees";
import { NotFound } from "@/components/not-found";
import { apiBaseUrl } from "@/lib/api";
import { BudgetProvider } from "@/lib/budget-context";
import { apiErrorCode, budgetQueryOptions } from "@/lib/budgets";
import { useBudgetEvents } from "@/lib/live-updates";
import { UndoProvider } from "@/lib/undo";

export const Route = createFileRoute("/_authed/budgets/$budgetId")({
  loader: async ({ context, params, preload }) => {
    // Fetching a budget records it as the user's last-used one, so hover preloads must not.
    if (preload) return;
    try {
      await context.queryClient.fetchQuery({
        ...budgetQueryOptions(params.budgetId),
        staleTime: 0,
      });
    } catch (error) {
      if (apiErrorCode(error) === "NOT_FOUND") throw notFound();
      throw error;
    }
  },
  component: BudgetLayout,
  notFoundComponent: BudgetNotFound,
});

function BudgetLayout() {
  const { budgetId } = Route.useParams();
  const { data: budget } = useSuspenseQuery(budgetQueryOptions(budgetId));
  useBudgetEvents(budgetId, apiBaseUrl);
  return (
    <BudgetProvider budget={budget}>
      <UndoProvider>
        <ManagePayeesProvider>
          {budget.role === "viewer" && (
            <p
              role="status"
              className="flex items-center justify-center gap-2 border-b bg-muted px-4 py-2 text-muted-foreground text-sm"
            >
              <Eye className="size-4" /> View only: you can see this budget but not change it.
            </p>
          )}
          <Outlet />
          {budget.role !== "viewer" && <FileDropImport />}
          <AiAssistant />
        </ManagePayeesProvider>
      </UndoProvider>
    </BudgetProvider>
  );
}

function BudgetNotFound() {
  const { budgetId } = Route.useParams();
  const queryClient = useQueryClient();
  // The budget loaded, so it's a page inside it that doesn't exist.
  if (queryClient.getQueryData(budgetQueryOptions(budgetId).queryKey)) return <NotFound />;
  return (
    <StatusLayout fullPage={false} title="Budget not found">
      <div className="grid justify-items-center gap-1.5 text-center">
        <h1 className="font-semibold text-2xl tracking-tight">We can't find that budget</h1>
        <p className="text-pretty text-muted-foreground">
          It may have been deleted, or it isn't shared with you.
        </p>
      </div>
      <Button asChild>
        <Link to="/budgets">
          <House /> Go to my budgets
        </Link>
      </Button>
    </StatusLayout>
  );
}
