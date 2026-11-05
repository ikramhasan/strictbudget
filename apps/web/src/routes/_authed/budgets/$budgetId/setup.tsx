import { type CurrencyCode, currencyExponent, isOnBudget, money } from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@strictbudget/ui/components/card";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { cn } from "@strictbudget/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Landmark } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { AddAccountForm } from "@/components/account-forms";
import { CategoryPicker, type CategoryPicks } from "@/components/category-picker";
import { OnboardingSteps } from "@/components/onboarding-steps";
import { PageHeader } from "@/components/page-header";
import { PageTitle } from "@/components/page-title";
import { ZeroBasedPrimer } from "@/components/zero-based-primer";
import { accountsQueryOptions } from "@/lib/accounts";
import { apiClient } from "@/lib/api";
import { useBudget } from "@/lib/budget-context";
import { categoriesQueryOptions } from "@/lib/categories";
import { currentMonth, monthQueryOptions, toMoney } from "@/lib/months";
import { useCreateAccount } from "@/lib/use-create-account";

/** Setup's steps, after creating the budget (onboarding's step 0). */
const STEPS = ["intro", "categories", "account", "assign"] as const;
type Step = (typeof STEPS)[number];

export const Route = createFileRoute("/_authed/budgets/$budgetId/setup")({
  // In the URL, so a reload stays on the step and Back goes to the one before.
  validateSearch: z.object({ step: z.enum(STEPS).optional().catch(undefined) }),
  component: SetupPage,
});

/**
 * Onboarding for a new budget: how the method works, pick categories, add a first account, then
 * see the money that's ready to assign and go assign it. Every step can be skipped. AI settings
 * aren't here: they're in budget settings.
 */
function SetupPage() {
  const { budget } = useBudget();
  const queryClient = useQueryClient();
  const navigate = Route.useNavigate();
  const step: Step = Route.useSearch().step ?? "intro";
  const categories = useQuery(categoriesQueryOptions(budget.id));
  const createAccount = useCreateAccount(budget.id);
  const [saving, setSaving] = useState(false);
  const example = useExampleAmount();
  const budgetHome = { to: "/budgets/$budgetId", params: { budgetId: budget.id } } as const;
  const goTo = (next: Step) => void navigate({ search: { step: next } });

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
    } catch {
      toast.error("Couldn't save all of your category choices. You can adjust them on the budget.");
    } finally {
      await queryClient.invalidateQueries({
        queryKey: categoriesQueryOptions(budget.id).queryKey,
      });
      setSaving(false);
      goTo("account");
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-3xl content-start gap-8 pb-10">
      <PageTitle name="Set up budget" />
      <PageHeader
        title={`Set up ${budget.name}`}
        actions={
          <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
            <Link {...budgetHome}>Skip setup</Link>
          </Button>
        }
      />
      <OnboardingSteps
        current={STEPS.indexOf(step) + 1}
        onSelect={(index) => goTo(STEPS[index - 1] ?? "intro")}
      />

      {step === "intro" ? (
        <StepCard
          title="How strictbudget works"
          description="One rule: give every dollar a job. Here's the whole method in four moves."
          footer={
            <Button onClick={() => goTo("categories")}>
              Pick my categories <ArrowRight />
            </Button>
          }
        >
          <ZeroBasedPrimer example={example} />
        </StepCard>
      ) : step === "categories" ? (
        <StepCard
          title="Pick your categories"
          description="These are the jobs your money can do. Keep the ones that fit your life, tap the rest to drop them, and add anything that's missing."
        >
          {categories.data ? (
            <CategoryPicker data={categories.data} pending={saving} onContinue={applyPicks} />
          ) : (
            <Skeleton className="h-64" />
          )}
        </StepCard>
      ) : step === "account" ? (
        <StepCard
          title="Add your first account"
          description="Start with the account you spend from most, like checking. Enter today's balance: that's the money you'll give jobs to."
          footer={
            <div className="flex w-full flex-wrap items-center justify-between gap-3 border-t pt-5">
              <p className="text-muted-foreground text-sm">
                No numbers handy? You can add accounts any time from the sidebar.
              </p>
              <Button variant="outline" onClick={() => goTo("assign")}>
                Skip for now
              </Button>
            </div>
          }
        >
          <AddAccountForm
            settings={budget}
            categories={categories.data}
            onSubmit={async (values) => {
              const result = await createAccount(values);
              if ("error" in result) return result.error;
              goTo("assign");
              return null;
            }}
          />
        </StepCard>
      ) : (
        <AssignStep onAddAccount={() => goTo("account")} />
      )}
    </div>
  );
}

function StepCard({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="gap-6">
      <CardHeader className="gap-1.5">
        <CardTitle className="font-semibold text-xl tracking-tight">{title}</CardTitle>
        <CardDescription className="max-w-prose text-pretty">{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
      {footer && <div className="flex justify-end gap-2 px-(--card-spacing)">{footer}</div>}
    </Card>
  );
}

/** Formats a whole number of the budget's currency, for the primer's made-up amounts. */
function useExampleAmount() {
  const { budget, formatAmount } = useBudget();
  const currency = budget.currency as CurrencyCode;
  const unit = 10n ** BigInt(currencyExponent(currency));
  return (units: number) => formatAmount(money(BigInt(units) * unit, currency));
}

/**
 * The last step: the budget's own Ready to Assign, and what to do with it. Without an account
 * there's no money yet, so it says that instead.
 */
function AssignStep({ onAddAccount }: { onAddAccount: () => void }) {
  const { budget, formatAmount } = useBudget();
  const accounts = useQuery(accountsQueryOptions(budget.id));
  const month = useQuery(monthQueryOptions(budget.id, currentMonth()));
  const budgetAccounts = accounts.data?.accounts.filter((a) => !a.closed && isOnBudget(a.type));
  const categories = useQuery(categoriesQueryOptions(budget.id));
  const currency = budget.currency as CurrencyCode;
  // The categories picked in setup (not the built-in groups, like credit card payments).
  const jobs = (categories.data?.groups ?? [])
    .filter((g) => !g.kind && !g.hidden)
    .flatMap((g) => g.categories.filter((c) => !c.hidden));

  if (!budgetAccounts || !month.data) {
    return <Skeleton className="h-80 rounded-2xl" />;
  }
  const readyToAssign = BigInt(month.data.readyToAssign);
  const amount = formatAmount(toMoney(month.data.readyToAssign, currency));
  const homeButton = (label: ReactNode, variant: "default" | "outline") => (
    <Button variant={variant} asChild>
      <Link to="/budgets/$budgetId" params={{ budgetId: budget.id }}>
        {label}
      </Link>
    </Button>
  );

  if (budgetAccounts.length === 0) {
    return (
      <StepCard
        title="Add money to start assigning"
        description="You skipped adding an account, so there's no money in this budget yet. Ready to Assign fills up from your accounts' balances."
        footer={
          <>
            {homeButton("Go to my budget", "outline")}
            <Button onClick={onAddAccount}>
              <Landmark /> Add an account
            </Button>
          </>
        }
      >
        <ReadyToAssignPreview amount={amount} tone="empty" caption="Nothing to assign yet" />
      </StepCard>
    );
  }

  const count = budgetAccounts.length;
  return (
    <StepCard
      title="Give every dollar a job"
      description={
        readyToAssign > 0n
          ? `This is the money in your ${count === 1 ? "account" : `${count} accounts`} right now. Assign it to categories until Ready to Assign reaches ${formatAmount(money(0n, currency))}.`
          : "There's no cash to assign yet. When money comes in, it lands here, ready for you to give it a job."
      }
      footer={homeButton(
        <>
          {readyToAssign > 0n ? "Start assigning" : "Go to my budget"} <ArrowRight />
        </>,
        "default",
      )}
    >
      <ReadyToAssignPreview
        amount={amount}
        tone={readyToAssign > 0n ? "positive" : readyToAssign < 0n ? "negative" : "empty"}
        caption={
          readyToAssign > 0n ? "Ready to Assign: money without a job yet" : "Ready to Assign"
        }
      />
      {readyToAssign > 0n && jobs.length > 0 && (
        <div className="mt-5 grid gap-2.5">
          <h3 className="font-medium text-muted-foreground text-sm">Jobs waiting for money</h3>
          <ul className="flex flex-wrap gap-1.5">
            {jobs.slice(0, JOBS_SHOWN).map((job) => (
              <li
                key={job.id}
                className="inline-flex h-8 items-center rounded-full border bg-background px-3 text-sm"
              >
                {job.name}
              </li>
            ))}
            {jobs.length > JOBS_SHOWN && (
              <li className="inline-flex h-8 items-center px-1 text-muted-foreground text-sm">
                and {jobs.length - JOBS_SHOWN} more
              </li>
            )}
          </ul>
        </div>
      )}
    </StepCard>
  );
}

const JOBS_SHOWN = 8;

function ReadyToAssignPreview({
  amount,
  tone,
  caption,
}: {
  amount: string;
  tone: "positive" | "negative" | "empty";
  caption: string;
}) {
  return (
    <div
      className={cn(
        "grid justify-items-center gap-1 rounded-xl px-6 py-10 text-center",
        tone === "positive" &&
          "bg-green-200 text-green-950 dark:bg-green-900/60 dark:text-green-50",
        tone === "negative" && "bg-red-200 text-red-950 dark:bg-red-900/60 dark:text-red-50",
        tone === "empty" && "border border-dashed bg-muted/40 text-muted-foreground",
      )}
    >
      <span className="font-semibold text-4xl tabular-nums tracking-tight sm:text-5xl">
        {amount}
      </span>
      <span className="text-sm">{caption}</span>
    </div>
  );
}
