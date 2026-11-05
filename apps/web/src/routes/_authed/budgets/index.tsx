import { formatDate } from "@strictbudget/engine";
import { Alert, AlertTitle } from "@strictbudget/ui/components/alert";
import { Button } from "@strictbudget/ui/components/button";
import { Card, CardDescription, CardTitle } from "@strictbudget/ui/components/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@strictbudget/ui/components/empty";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Plus, Users, Wallet } from "lucide-react";
import { z } from "zod";
import { currencyName } from "@/components/currency-picker";
import { ImportBudgetMenu } from "@/components/import-budget";
import { PageHeader } from "@/components/page-header";
import { PageTitle } from "@/components/page-title";
import { type Budget, budgetsQueryOptions, lastUsedLabel } from "@/lib/budgets";

export const Route = createFileRoute("/_authed/budgets/")({
  // A category template on its way to a budget (the import dialog's "Choose Another Budget"):
  // the budget opened, or created, next shows its import dialog.
  validateSearch: z.object({ template: z.string().optional().catch(undefined) }),
  component: AllBudgetsPage,
});

function AllBudgetsPage() {
  const budgets = useQuery(budgetsQueryOptions());
  const { template } = Route.useSearch();

  return (
    // The page edge and width match the other pages.
    <div className="mx-auto grid w-full max-w-6xl content-start gap-6">
      <PageTitle name="Budgets" />
      <PageHeader
        title="All budgets"
        actions={
          <div className="flex items-center gap-2">
            <ImportBudgetMenu />
            <Button size="sm" asChild>
              <Link to="/budgets/new" search={{ template }}>
                <Plus /> New budget
              </Link>
            </Button>
          </div>
        }
      />
      {template && (
        <p className="text-muted-foreground text-sm">
          Open a budget, or create a new one, to import the category template into it.
        </p>
      )}
      {budgets.isPending ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      ) : budgets.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn't load your budgets.</AlertTitle>
        </Alert>
      ) : budgets.data.budgets.length === 0 ? (
        <Empty className="border py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Wallet />
            </EmptyMedia>
            <EmptyTitle>No budgets yet</EmptyTitle>
            <EmptyDescription>
              Create one to start giving every dollar a job, or import one you already keep.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button asChild>
              <Link to="/budgets/new" search={{ template }}>
                <Plus /> New budget
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          {/*
           * Your budgets, then those shared with you, most recently used first (the API's order).
           * Archived budgets are among them, their names stamped "(Archived on …)".
           */}
          <section className="grid gap-3">
            <h2 className="font-semibold text-sm">Your budgets</h2>
            <BudgetGrid
              budgets={budgets.data.budgets.filter((b) => b.role === "owner")}
              template={template}
              newBudget
            />
          </section>
          <section className="grid gap-3">
            <h2 className="font-semibold text-sm">Shared with you</h2>
            {budgets.data.budgets.some((b) => b.role !== "owner") ? (
              <BudgetGrid
                budgets={budgets.data.budgets.filter((b) => b.role !== "owner")}
                template={template}
              />
            ) : (
              <p className="flex items-center gap-3 rounded-2xl border border-input border-dashed px-5 py-4 text-muted-foreground text-sm">
                <Users className="size-4 shrink-0" aria-hidden />
                When someone invites you to their budget, it shows up here.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function BudgetGrid({
  budgets,
  template,
  newBudget = false,
}: {
  budgets: Budget[];
  template?: string;
  /** End with a tile that creates a budget. */
  newBudget?: boolean;
}) {
  return (
    // As many cards per row as fit, at least 18rem each.
    <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3">
      {budgets.map((b) => (
        <Link
          key={b.id}
          to="/budgets/$budgetId"
          params={{ budgetId: b.id }}
          search={{ template }}
          preload={false}
          className="group rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Card className="h-full gap-4 transition-colors duration-150 group-hover:bg-muted/40">
            <div className="flex items-center gap-3 px-(--card-spacing)">
              <span
                aria-hidden
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 font-semibold text-base text-primary-text"
              >
                {initial(b.name)}
              </span>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <CardTitle className="truncate font-semibold">{b.name}</CardTitle>
                <CardDescription className="truncate">
                  {currencyName(b.currency)} · {b.currency}
                </CardDescription>
              </div>
              <ChevronRight
                className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5"
                aria-hidden
              />
            </div>
            <div className="flex items-center justify-between gap-3 border-t px-(--card-spacing) pt-3 text-muted-foreground text-xs">
              <span>{b.role === "owner" ? "Owner" : "Shared with you"}</span>
              <span className="truncate">
                {b.lastUsedAt
                  ? lastUsedLabel(b.lastUsedAt)
                  : `Created ${formatDate(b.createdAt.slice(0, 10), b.dateFormat)}`}
              </span>
            </div>
          </Card>
        </Link>
      ))}
      {newBudget && (
        <Link
          to="/budgets/new"
          search={{ template }}
          className="flex min-h-32 items-center justify-center gap-2 rounded-2xl border border-input border-dashed text-muted-foreground text-sm outline-none transition-colors duration-150 hover:bg-muted/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-4" aria-hidden /> New budget
        </Link>
      )}
    </div>
  );
}

/** The budget's first letter or symbol, for its tile. */
function initial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}
