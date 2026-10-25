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
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Budget } from "@/lib/budgets";
import { exportPlan } from "@/lib/exports";
import { DisplayOptionsDialog } from "./display-options-dialog";
import { EditFlagsDialog } from "./edit-flags-dialog";
import { SidebarDropdownContent } from "./sidebar-dropdown-content";

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
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton size="lg">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Wallet className="size-4 text-primary-foreground" />
            </div>
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
            <DropdownMenuItem key={b.id} asChild>
              {/* No preload: opening a budget records it as last-used. */}
              <Link to="/budgets/$budgetId" params={{ budgetId: b.id }} preload={false}>
                <span className="truncate">{b.name}</span>
                {b.id === currentBudgetId && <CheckIcon className="ml-auto" />}
              </Link>
            </DropdownMenuItem>
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
                <Bookmark /> Edit Flags
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDisplayOptions(true)}>
                <Palette /> Display Options
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  exportPlan(current).catch(() => toast.error("Couldn't export the budget."));
                }}
              >
                <FileDown /> Export Plan
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
