import { cn } from "@strictbudget/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { PageTitle } from "@/components/page-title";
import { useBudget } from "@/lib/budget-context";

export const PARITY_REPORTS = [
  { to: "/budgets/$budgetId/reports/spending-breakdown", label: "Spending Breakdown" },
  { to: "/budgets/$budgetId/reports/spending-trends", label: "Spending Trends" },
  { to: "/budgets/$budgetId/reports/net-worth", label: "Net Worth" },
  { to: "/budgets/$budgetId/reports/income-expense", label: "Income v Expense" },
  { to: "/budgets/$budgetId/reports/age-of-money", label: "Age of Money" },
] as const;

export const EXTRA_REPORTS = [
  { to: "/budgets/$budgetId/reports/budget-vs-actual", label: "Budget vs Actual" },
  { to: "/budgets/$budgetId/reports/spending-pace", label: "Spending Pace" },
  { to: "/budgets/$budgetId/reports/savings-rate", label: "Savings Rate" },
  { to: "/budgets/$budgetId/reports/cash-flow", label: "Cash Flow" },
  { to: "/budgets/$budgetId/reports/credit-card-health", label: "Credit Card Health" },
] as const;

/** Every report's tab, kept reachable from every report. */
export function ReportsNav() {
  const { budget } = useBudget();
  return (
    <nav
      aria-label="Reports"
      // The divider is an inset shadow, so the active tab's underline paints over it while staying
      // inside the nav (a border plus -mb-px tabs overflowed it and showed a scrollbar).
      className="overflow-x-auto shadow-[inset_0_-1px_0_var(--border)]"
    >
      <ul className="flex gap-4">
        <li>
          <Link
            to="/budgets/$budgetId/reports"
            params={{ budgetId: budget.id }}
            activeOptions={{ exact: true }}
            className="block whitespace-nowrap border-transparent border-b-2 py-2 text-muted-foreground text-sm transition-colors duration-150 hover:text-foreground data-active:border-primary data-active:text-foreground"
            activeProps={{ "data-active": true }}
          >
            Overview
          </Link>
        </li>
        {[...PARITY_REPORTS, ...EXTRA_REPORTS].map((r) => (
          <li key={r.to}>
            <Link
              to={r.to}
              params={{ budgetId: budget.id }}
              className="block whitespace-nowrap border-transparent border-b-2 py-2 text-muted-foreground text-sm transition-colors duration-150 hover:text-foreground data-active:border-primary data-active:text-foreground"
              activeProps={{ "data-active": true }}
            >
              {r.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A report's frame: the tabs, its title with actions (Export) and filters, then its content. */
export function ReportPage({
  title,
  actions,
  filters,
  children,
  className,
}: {
  title: string;
  actions?: ReactNode;
  filters?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    // The app shell already pads the page; this only spaces the report. Full width, like the
    // budget and account pages.
    <div className={cn("grid w-full content-start gap-4", className)}>
      <PageTitle name={title} />
      <PageHeader title={title} actions={actions} />
      <ReportsNav />
      {filters}
      {children}
    </div>
  );
}
