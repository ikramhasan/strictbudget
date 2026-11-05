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
import { OnboardingSteps } from "@/components/onboarding-steps";
import { PageHeader } from "@/components/page-header";
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
    // As wide as setup's steps, so the step bar keeps its size from one page to the next.
    <div className="mx-auto grid w-full max-w-3xl content-start gap-8 pb-10">
      <PageTitle name="New budget" />
      <PageHeader title="New budget" />
      {/* With a template the budget opens straight away, without setup. */}
      {!template && <OnboardingSteps current={0} />}
      <Card className="gap-6">
        <CardHeader className="gap-1.5">
          <CardTitle className="font-semibold text-xl tracking-tight">
            {isFirst ? "Create your first budget" : "Create a budget"}
          </CardTitle>
          <CardDescription className="text-pretty">
            Name it and choose the currency you budget in. You can change how amounts and dates look
            later, but not the currency.
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
