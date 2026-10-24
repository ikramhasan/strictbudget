import { suggestFormatSettings } from "@strictbudget/engine";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@strictbudget/ui/components/card";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { BudgetForm, type BudgetFormValues } from "@/components/budget-form";
import { PageTitle } from "@/components/page-title";
import { $api } from "@/lib/api";
import { apiErrorMessage, budgetsQueryOptions, invalidateBudgets } from "@/lib/budgets";

export const Route = createFileRoute("/_authed/budgets/new")({
  // A category template to start the budget from: the new budget opens with its import dialog.
  validateSearch: z.object({ template: z.string().optional().catch(undefined) }),
  component: NewBudgetPage,
});

function NewBudgetPage() {
  const navigate = useNavigate();
  const { template } = Route.useSearch();
  const queryClient = useQueryClient();
  const budgets = useQuery(budgetsQueryOptions());
  const create = $api.useMutation("post", "/v1/budgets");
  const [defaults] = useState<BudgetFormValues>(() => ({
    name: "",
    ...suggestFormatSettings(navigator.language),
  }));
  const isFirst = budgets.data?.budgets.length === 0;

  async function handleSubmit(values: BudgetFormValues) {
    try {
      const created = await create.mutateAsync({ body: values });
      await invalidateBudgets(queryClient);
      await (template
        ? navigate({
            to: "/budgets/$budgetId",
            params: { budgetId: created.id },
            search: { template },
          })
        : navigate({ to: "/budgets/$budgetId/setup", params: { budgetId: created.id } }));
      return null;
    } catch (error) {
      return apiErrorMessage(error, "Couldn't create the budget. Try again.");
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle name="New budget" />
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            {isFirst ? "Create your first budget" : "New budget"}
          </CardTitle>
          <CardDescription>
            Pick the currency you budget in and how amounts and dates should look. You can change
            the formats later, but not the currency.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BudgetForm
            defaultValues={defaults}
            submitLabel="Create budget"
            pendingLabel="Creating…"
            onSubmit={handleSubmit}
          />
        </CardContent>
      </Card>
    </div>
  );
}
