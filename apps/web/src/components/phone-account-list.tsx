import { money } from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@strictbudget/ui/components/empty";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { cn } from "@strictbudget/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Landmark, Layers, Plus } from "lucide-react";
import { useState } from "react";
import {
  type Account,
  accountsQueryOptions,
  type SidebarSection,
  sidebarSections,
  totalHint,
} from "@/lib/accounts";
import { useBudget } from "@/lib/budget-context";
import { inCurrency } from "@/lib/money-input";
import { AccountLogo } from "./accounts-nav";
import { AddAccountDialog } from "./add-account-dialog";
import { PageHeader } from "./page-header";
import { PageTitle } from "./page-title";

/** A tappable row's shared look: a thumb's height, the name left, the figure and a chevron right. */
const ROW =
  "flex min-h-14 items-center gap-3 px-4 py-2.5 outline-none transition-colors active:bg-accent focus-visible:bg-accent [@media(hover:hover)]:hover:bg-accent";

/** A phone's accounts: All Accounts, then each group with its total and its accounts' balances. */
export function PhoneAccountList() {
  const { budget, readOnly, formatAmount } = useBudget();
  const accounts = useQuery(accountsQueryOptions(budget.id));
  const [adding, setAdding] = useState(false);
  const format = (minorUnits: bigint, currency?: string) =>
    formatAmount(money(minorUnits, inCurrency(budget, currency).currency));

  const list = accounts.data?.accounts ?? [];
  // Starred accounts are already in their own groups; the sidebar's shortcut isn't needed here.
  const sections = sidebarSections(list, budget.currency, accounts.data?.totals).filter(
    (s) => s.id !== "starred",
  );
  const open = list.filter((a) => !a.closed);
  const toReview = list.reduce((sum, a) => sum + a.toReview, 0);
  const netWorth = accounts.data?.totals.netWorth;

  return (
    <div className="grid gap-5">
      <PageTitle name="Accounts" />
      <PageHeader title="Accounts" />
      {accounts.isPending ? (
        <div className="grid gap-3" aria-busy>
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
      ) : accounts.isError ? (
        <p role="alert" className="text-destructive text-sm">
          Couldn't load the accounts.
        </p>
      ) : list.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Landmark />
            </EmptyMedia>
            <EmptyTitle>No accounts yet</EmptyTitle>
            <EmptyDescription>
              {readOnly
                ? "Accounts show up here once the budget has one."
                : "Add a checking, savings or credit card account to start recording transactions."}
            </EmptyDescription>
          </EmptyHeader>
          {!readOnly && (
            <EmptyContent>
              <Button onClick={() => setAdding(true)}>
                <Plus /> Add account
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border bg-card">
            {netWorth && (
              <div className="flex items-baseline justify-between gap-3 border-b px-4 py-3">
                <span className="font-medium text-muted-foreground text-xs">Net worth</span>
                <span
                  className={cn(
                    "font-semibold text-lg tabular-nums",
                    BigInt(netWorth.amount) < 0n && "text-destructive",
                  )}
                  title={totalHint({ ...netWorth, excluded: [] }) ?? undefined}
                >
                  {netWorth.converted && <span aria-hidden>≈</span>}
                  {format(BigInt(netWorth.amount), netWorth.currency)}
                </span>
              </div>
            )}
            <Link
              to="/budgets/$budgetId/accounts"
              params={{ budgetId: budget.id }}
              search={{ all: true }}
              className={ROW}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-text">
                <Layers className="size-4" aria-hidden />
              </span>
              <span className="grid min-w-0 flex-1">
                <span className="truncate font-medium">All accounts</span>
                <span className="truncate text-muted-foreground text-xs">
                  {open.length} open {open.length === 1 ? "account" : "accounts"}
                  {toReview > 0 && (
                    <span className="text-primary-text"> · {toReview} to review</span>
                  )}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </div>

          {sections.map((section) =>
            section.id === "closed" ? (
              <ClosedGroup key={section.id} section={section} budgetId={budget.id} />
            ) : (
              <AccountGroup
                key={section.id}
                section={section}
                budgetId={budget.id}
                format={format}
              />
            ),
          )}

          {!readOnly && (
            <Button variant="outline" className="h-11" onClick={() => setAdding(true)}>
              <Plus /> Add account
            </Button>
          )}
        </>
      )}
      <AddAccountDialog budget={budget} open={adding} onOpenChange={setAdding} />
    </div>
  );
}

function AccountGroup({
  section,
  budgetId,
  format,
}: {
  section: SidebarSection;
  budgetId: string;
  format: (minorUnits: bigint, currency?: string) => string;
}) {
  const hint = totalHint(section);
  const headingId = `accounts-${section.id}`;
  return (
    <section aria-labelledby={headingId} className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 id={headingId} className="font-semibold text-muted-foreground text-xs">
          {section.title}
        </h2>
        <span
          className={cn(
            "font-medium text-muted-foreground text-xs tabular-nums",
            section.total < 0n && "text-destructive",
          )}
          title={hint ?? undefined}
        >
          {section.converted && <span aria-hidden>≈</span>}
          {format(section.total, section.currency)}
          {section.excluded.length > 0 && <span aria-hidden>*</span>}
          {hint && <span className="sr-only">, {hint}</span>}
        </span>
      </div>
      <ul className="overflow-hidden rounded-xl border bg-card">
        {section.accounts.map((account) => (
          <li key={account.id} className="not-last:border-b">
            <AccountRow account={account} budgetId={budgetId} format={format} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Closed accounts, folded away under their heading. */
function ClosedGroup({ section, budgetId }: { section: SidebarSection; budgetId: string }) {
  return (
    <details className="group grid gap-2">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-1 font-semibold text-muted-foreground text-xs outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
        Closed
        <span className="font-normal tabular-nums">{section.accounts.length}</span>
      </summary>
      <ul className="overflow-hidden rounded-xl border bg-card">
        {section.accounts.map((account) => (
          <li key={account.id} className="not-last:border-b">
            <AccountRow account={account} budgetId={budgetId} />
          </li>
        ))}
      </ul>
    </details>
  );
}

function AccountRow({
  account,
  budgetId,
  format,
}: {
  account: Account;
  budgetId: string;
  /** Left out for closed accounts, whose balance is always zero. */
  format?: (minorUnits: bigint, currency?: string) => string;
}) {
  const working = BigInt(account.balances.working);
  return (
    <Link
      to="/budgets/$budgetId/accounts/$accountId"
      params={{ budgetId, accountId: account.id }}
      className={ROW}
    >
      {account.logo && (
        <AccountLogo name={account.name} logo={account.logo} className="size-8 rounded-lg" />
      )}
      <span className="grid min-w-0 flex-1">
        <span className={cn("truncate font-medium", account.closed && "text-muted-foreground")}>
          {account.name}
        </span>
        {account.toReview > 0 && (
          <span className="truncate text-primary-text text-xs">{account.toReview} to review</span>
        )}
      </span>
      {format && (
        <span
          className={cn(
            "shrink-0 font-medium tabular-nums",
            working < 0n ? "text-destructive" : "text-foreground",
          )}
        >
          {format(working, account.currency)}
        </span>
      )}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
