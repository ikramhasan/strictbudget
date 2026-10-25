import { Button } from "@strictbudget/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@strictbudget/ui/components/card";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AddAccountForm } from "@/components/account-forms";
import { AiSettingsFields } from "@/components/ai-settings";
import { CategoryPicker, type CategoryPicks } from "@/components/category-picker";
import { PageTitle } from "@/components/page-title";
import { apiClient } from "@/lib/api";
import { useBudget } from "@/lib/budget-context";
import { categoriesQueryOptions } from "@/lib/categories";
import { useCreateAccount } from "@/lib/use-create-account";

const STEPS = ["categories", "account", "ai", "fund"] as const;

export const Route = createFileRoute("/_authed/budgets/$budgetId/setup")({
  component: SetupPage,
});

/**
 * Onboarding for a new budget: pick categories, add a first account, then fund categories (which
 * just opens the budget to assign). Before funding: the budget's AI settings and how to connect an
 * agent over MCP.
 */
function SetupPage() {
  const { budget } = useBudget();
  const queryClient = useQueryClient();
  const categories = useQuery(categoriesQueryOptions(budget.id));
  const createAccount = useCreateAccount(budget.id);
  const [step, setStep] = useState<(typeof STEPS)[number]>("categories");
  const [saving, setSaving] = useState(false);
  const budgetHome = { to: "/budgets/$budgetId", params: { budgetId: budget.id } } as const;

  async function applyPicks(picks: CategoryPicks) {
    setSaving(true);
    const budgetId = budget.id;
    try {
      // Groups first: deleting a group takes its categories with it.
      for (const groupId of picks.removeGroupIds) {
        const { error } = await apiClient.DELETE(
          "/v1/budgets/{budgetId}/category-groups/{groupId}",
          { params: { path: { budgetId, groupId }, query: {} } },
        );
        if (error) throw error;
      }
      const inRemovedGroups = new Set(
        categories.data?.groups
          .filter((g) => picks.removeGroupIds.includes(g.id))
          .flatMap((g) => g.categories.map((c) => c.id)),
      );
      for (const categoryId of picks.removeCategoryIds) {
        if (inRemovedGroups.has(categoryId)) continue;
        const { error } = await apiClient.DELETE("/v1/budgets/{budgetId}/categories/{categoryId}", {
          params: { path: { budgetId, categoryId }, query: {} },
        });
        if (error) throw error;
      }
      for (const { groupId, name } of picks.add) {
        const { error } = await apiClient.POST("/v1/budgets/{budgetId}/categories", {
          params: { path: { budgetId } },
          body: { groupId, name },
        });
        if (error) throw error;
      }
      setStep("account");
    } catch {
      toast.error("Couldn't save all of your category choices. You can adjust them on the budget.");
      setStep("account");
    } finally {
      await queryClient.invalidateQueries({
        queryKey: categoriesQueryOptions(budget.id).queryKey,
      });
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <PageTitle name="Set up budget" />
      <p className="text-muted-foreground text-sm">
        Step {STEPS.indexOf(step) + 1} of {STEPS.length} · Setting up {budget.name}
      </p>
      {step === "categories" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Pick your categories</CardTitle>
            <CardDescription>
              Keep the ones that fit your life and untick the rest. Add anything that's missing; you
              can always change categories later.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {categories.data ? (
              <CategoryPicker data={categories.data} pending={saving} onContinue={applyPicks} />
            ) : (
              <Skeleton className="h-64" />
            )}
          </CardContent>
        </Card>
      ) : step === "account" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Add your first account</CardTitle>
            <CardDescription>
              Start with the account you spend from most, like checking. Its balance today becomes
              money you can assign.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <AddAccountForm
              settings={budget}
              categories={categories.data}
              onSubmit={async (values) => {
                const result = await createAccount(values);
                if ("error" in result) return result.error;
                setStep("ai");
                return null;
              }}
            />
            <Button
              variant="link"
              className="justify-self-start px-0"
              onClick={() => setStep("ai")}
            >
              Skip for now
            </Button>
          </CardContent>
        </Card>
      ) : step === "ai" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Set up AI</CardTitle>
            <CardDescription>
              Choose whether AI can help with this budget, and connect your own agent if you use
              one. You can change this any time in budget settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <AiSettingsFields budgetId={budget.id} canEdit={budget.role !== "viewer"} />
            <Button className="justify-self-start" onClick={() => setStep("fund")}>
              Continue
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Fund your categories</CardTitle>
            <CardDescription>
              Your account's balance is now Ready to Assign at the top of the budget. Give it jobs:
              assign the money you have right now, not your monthly income, until Ready to Assign
              reaches zero.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link {...budgetHome}>Fund categories</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
