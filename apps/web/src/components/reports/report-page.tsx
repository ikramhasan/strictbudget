import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@strictbudget/ui/components/dropdown-menu";
import { cn } from "@strictbudget/ui/lib/utils";
import { Link, useRouterState } from "@tanstack/react-router";
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
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
  { to: "/budgets/$budgetId/reports/category-history", label: "Category History" },
  { to: "/budgets/$budgetId/reports/spending-pace", label: "Spending Pace" },
  { to: "/budgets/$budgetId/reports/credit-card-health", label: "Credit Card Health" },
  { to: "/budgets/$budgetId/reports/spending-by-flag", label: "Spending by Flag" },
] as const;

/** How far the strip fades at an edge with more tabs past it. */
const FADE_PX = 48;

const TAB_CLASS =
  "block whitespace-nowrap border-transparent border-b-2 py-2.5 text-muted-foreground text-sm transition-colors duration-150 hover:text-foreground focus-visible:border-ring focus-visible:text-foreground focus-visible:outline-none data-active:border-primary data-active:text-foreground";

/**
 * The reports' tabs: the overview and the main reports, the rest under "More" (which takes the
 * name of the one that's open). On a narrow screen the strip scrolls sideways without a
 * scrollbar: faded edges and arrows show there's more, and the active tab is scrolled into view.
 */
export function ReportsNav() {
  const { budget } = useBudget();
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ start: false, end: false });
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setMore((m) => (m.start === start && m.end === end ? m : { start, end }));
  }, []);

  // The active tab, centred when it's out of sight or under a faded edge.
  const reveal = useCallback(() => {
    const el = scroller.current;
    const active = el?.querySelector<HTMLElement>("[data-active]");
    if (!el || !active) return;
    const left = active.offsetLeft;
    const right = left + active.offsetWidth;
    const atStart = el.scrollLeft <= 1;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    if (
      left < el.scrollLeft + (atStart ? 0 : FADE_PX) ||
      right > el.scrollLeft + el.clientWidth - (atEnd ? 0 : FADE_PX)
    ) {
      el.scrollTo({ left: left - (el.clientWidth - active.offsetWidth) / 2 });
    }
    measure();
  }, [measure]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    measure();
    // The strip or its tabs changing width (the page settling, fonts) can hide the active tab.
    const observer = new ResizeObserver(reveal);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [measure, reveal]);

  // Again on every report change.
  useEffect(reveal, [pathname, reveal]);

  const page = (direction: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.7, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <nav
      aria-label="Reports"
      // The divider is an inset shadow under the strip, so the active tab's underline paints over it.
      className="relative min-w-0 shadow-[inset_0_-1px_0_var(--border)]"
    >
      <div
        ref={scroller}
        // relative: the tabs' offsetLeft is measured from the strip's own content.
        className="no-scrollbar relative overflow-x-auto"
        style={{
          // Fade whichever edge has more tabs past it.
          maskImage: `linear-gradient(to right, ${more.start ? `transparent, #000 ${FADE_PX}px` : "#000"}, ${more.end ? `#000 calc(100% - ${FADE_PX}px), transparent` : "#000"})`,
        }}
      >
        <ul className="flex w-max gap-5">
          <li>
            <Link
              to="/budgets/$budgetId/reports"
              params={{ budgetId: budget.id }}
              activeOptions={{ exact: true }}
              className={TAB_CLASS}
              activeProps={{ "data-active": true, "aria-current": "page" }}
            >
              Overview
            </Link>
          </li>
          {PARITY_REPORTS.map((r) => (
            <li key={r.to}>
              <Link
                to={r.to}
                params={{ budgetId: budget.id }}
                className={TAB_CLASS}
                activeProps={{ "data-active": true, "aria-current": "page" }}
              >
                {r.label}
              </Link>
            </li>
          ))}
          <li>
            <MoreReports pathname={pathname} />
          </li>
        </ul>
      </div>
      {more.start && <ScrollButton side="start" onClick={() => page(-1)} />}
      {more.end && <ScrollButton side="end" onClick={() => page(1)} />}
    </nav>
  );
}

function MoreReports({ pathname }: { pathname: string }) {
  const { budget } = useBudget();
  const open = EXTRA_REPORTS.find((r) =>
    pathname.endsWith(r.to.slice("/budgets/$budgetId".length)),
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(TAB_CLASS, "flex items-center gap-1 data-[state=open]:text-foreground")}
        data-active={open ? true : undefined}
        aria-current={open ? "page" : undefined}
      >
        {open?.label ?? "More"}
        <ChevronDown aria-hidden className="size-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        {EXTRA_REPORTS.map((r) => (
          <DropdownMenuItem key={r.to} asChild>
            <Link to={r.to} params={{ budgetId: budget.id }}>
              <span className="flex-1">{r.label}</span>
              {r === open && <Check aria-hidden className="size-4" />}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ScrollButton({ side, onClick }: { side: "start" | "end"; onClick: () => void }) {
  const Icon = side === "start" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      // Mouse users get the arrows; keyboard users tab through the links, which scroll themselves.
      tabIndex={-1}
      aria-label={side === "start" ? "Earlier reports" : "More reports"}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full border bg-background text-muted-foreground shadow-xs transition-colors duration-150 hover:bg-muted hover:text-foreground",
        side === "start" ? "left-0" : "right-0",
      )}
    >
      <Icon aria-hidden className="size-4" />
    </button>
  );
}

/**
 * A report's frame: "Reports" with the report's actions (Export) in the top bar, the tabs (which
 * name the report), one toolbar row of filters, then its content.
 */
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
      <PageHeader title="Reports" actions={actions} />
      <ReportsNav />
      {filters && (
        // One row: on a phone it scrolls sideways (edge to edge) rather than stacking three deep.
        <div className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&>*]:shrink-0">
          {filters}
        </div>
      )}
      {children}
    </div>
  );
}
