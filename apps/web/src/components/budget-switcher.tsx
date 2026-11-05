import { formatDate } from "@strictbudget/engine";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@strictbudget/ui/components/dropdown-menu";
import { SidebarMenuButton } from "@strictbudget/ui/components/sidebar";
import { Link } from "@tanstack/react-router";
import {
  Bookmark,
  CheckIcon,
  ChevronsUpDown,
  FileDown,
  LayoutGrid,
  Palette,
  Plus,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { $api } from "@/lib/api";
import { type Budget, lastUsedLabel } from "@/lib/budgets";
import { exportPlan } from "@/lib/exports";
import { BrandMark } from "./brand";
import { DisplayOptionsDialog } from "./display-options-dialog";
import { EditFlagsDialog } from "./edit-flags-dialog";
import { SidebarDropdownContent } from "./sidebar-dropdown-content";

/**
 * How many people share `budgetId` (the signed-in user included), once loaded; asked only when
 * `enabled`, so a closed switcher costs nothing.
 */
export function useMemberCount(budgetId: string, enabled = true): number | undefined {
  const members = $api.useQuery(
    "get",
    "/v1/budgets/{budgetId}/members",
    { params: { path: { budgetId } } },
    { enabled, staleTime: 60_000 },
  );
  return members.data?.members.length;
}

/** "2 members", for a budget shared with others; nothing for one only you use. */
export function membersLabel(count: number | undefined) {
  return count !== undefined && count > 1 ? `${count} members` : null;
}

/** When the budget was last opened, or else made: what tells two same-named budgets apart. */
export function budgetWhenLabel(b: Budget) {
  return b.lastUsedAt
    ? lastUsedLabel(b.lastUsedAt)
    : `Created ${formatDate(b.createdAt.slice(0, 10), b.dateFormat)}`;
}

function BudgetOption({
  budget: b,
  current,
  open,
}: {
  budget: Budget;
  current: boolean;
  open: boolean;
}) {
  const members = membersLabel(useMemberCount(b.id, open));
  return (
    <DropdownMenuItem asChild>
      {/* No preload: opening a budget records it as last-used. */}
      <Link to="/budgets/$budgetId" params={{ budgetId: b.id }} preload={false}>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate">{b.name}</span>{" "}
          <span className="truncate text-muted-foreground text-xs">
            {[budgetWhenLabel(b), members].filter(Boolean).join(" · ")}
          </span>
        </span>
        {current && <CheckIcon className="ml-auto" />}
      </Link>
    </DropdownMenuItem>
  );
}

export function BudgetSwitcher({
  budgets,
  currentBudgetId,
}: {
  budgets: readonly Budget[];
  currentBudgetId: string | undefined;
}) {
  const current = budgets.find((b) => b.id === currentBudgetId);
  const [editingFlags, setEditingFlags] = useState(false);
  const [displayOptions, setDisplayOptions] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton size="lg">
            <BrandMark className="size-8!" />
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">{current?.name ?? "Select a budget"}</span>
              <span className="truncate text-muted-foreground text-xs">
                {current ? current.currency : "strictbudget"}
              </span>
            </div>
            <ChevronsUpDown className="ml-auto size-4" aria-hidden />
            {/* After the name, so the visible text starts the button's name (WCAG 2.5.3). */}
            <span className="sr-only">Switch budget</span>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <SidebarDropdownContent align="start">
          <DropdownMenuLabel className="text-muted-foreground text-xs">Budgets</DropdownMenuLabel>
          {budgets.map((b) => (
            <BudgetOption key={b.id} budget={b} current={b.id === currentBudgetId} open={open} />
          ))}
          {budgets.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem asChild>
            <Link to="/budgets/new">
              <Plus /> New budget
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/budgets">
              <LayoutGrid /> View all budgets
            </Link>
          </DropdownMenuItem>
          {current && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-muted-foreground text-xs">
                Current budget
              </DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setEditingFlags(true)}>
                <Bookmark /> Edit flags
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDisplayOptions(true)}>
                <Palette /> Display options
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  exportPlan(current).catch(() => toast.error("Couldn't export the budget."));
                }}
              >
                <FileDown /> Export budget
              </DropdownMenuItem>
            </>
          )}
        </SidebarDropdownContent>
      </DropdownMenu>
      {current && (
        <EditFlagsDialog budgetId={current.id} open={editingFlags} onOpenChange={setEditingFlags} />
      )}
      <DisplayOptionsDialog open={displayOptions} onOpenChange={setDisplayOptions} />
    </>
  );
}
