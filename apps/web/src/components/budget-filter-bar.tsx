import { ToggleGroup, ToggleGroupItem } from "@strictbudget/ui/components/toggle-group";
import { cn } from "@strictbudget/ui/lib/utils";
import type { ReactNode } from "react";
import { type BudgetFilter, fitsViewsBar, isPresetFilter } from "@/lib/budget-view";

/** A view that didn't fit the bar, for the Views Menu. */
export interface OverflowView {
  key: string;
  label: string;
}

/** A view as a text tab; the trigger of the Views Menu ("More") matches it. */
export const TAB =
  "h-9 rounded-none before:hidden border-transparent border-b-2 bg-transparent px-2 font-medium text-muted-foreground text-sm transition-colors duration-150 hover:bg-transparent hover:text-foreground data-[state=on]:border-current data-[state=on]:bg-transparent data-[state=on]:text-foreground";

/** How many views the bar shows before the rest go into "More". */
const BAR_VIEWS = 4;

/** The views Manage Views can't move: always first, in this order. */
const FIXED: readonly BudgetFilter[] = ["all", "overspent"];

/**
 * The views above the budget list: All, Overspent (with its count), then Underfunded, Overfunded,
 * Money Available, Snoozed and the custom views in the plan's order. The bar shows at most four
 * (`BAR_VIEWS`), fewer when the window is narrow (`fitsViewsBar`); the rest go into a "More" tab
 * (the Views Menu), except the selected one.
 */
export function BudgetFilterBar({
  filter,
  overspent,
  onlyCredit = false,
  onChange,
  order = ["underfunded", "overfunded", "available", "snoozed"],
  custom = [],
  viewportWidth = Number.POSITIVE_INFINITY,
  menu,
}: {
  filter: string;
  overspent: number;
  /** All of it is credit overspending: the view is drawn yellow instead of red. */
  onlyCredit?: boolean;
  onChange: (filter: string) => void;
  /** The rearrangeable views in order: preset keys and custom view ids. */
  order?: readonly string[];
  custom?: readonly { id: string; name: string }[];
  /** The window's width in CSS pixels, which decides how many views fit the bar. */
  viewportWidth?: number;
  /** The Views Menu (the views that didn't fit, Manage Views, New View). */
  menu?: (overflow: readonly OverflowView[]) => ReactNode;
}) {
  const labels: Record<BudgetFilter, string> = {
    all: "All",
    overspent: `${overspent} Overspent`,
    underfunded: "Underfunded",
    overfunded: "Overfunded",
    available: "Money Available",
    snoozed: "Snoozed",
  };
  const names = new Map(custom.map((v) => [v.id, v.name]));
  // Overspent is left out when nothing is, unless that view is on ("0 Overspent").
  const keys = [...FIXED, ...order].filter(
    (key) =>
      (isPresetFilter(key) || names.has(key)) &&
      (key !== "overspent" || overspent > 0 || filter === key),
  );
  const label = (key: string) => (isPresetFilter(key) ? labels[key] : (names.get(key) ?? key));
  const onBar = keys.filter(
    (key, i) => key === filter || (i < BAR_VIEWS && fitsViewsBar(i, viewportWidth)),
  );
  const overflow = keys
    .filter((key) => !onBar.includes(key))
    .map((key) => ({ key, label: label(key) }));
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <ToggleGroup
        type="single"
        size="sm"
        spacing={1}
        aria-label="Budget view"
        value={filter}
        onValueChange={(value) => {
          if (keys.includes(value)) onChange(value);
        }}
        className="flex-wrap justify-start"
      >
        {onBar.map((f) => (
          <ToggleGroupItem
            key={f}
            value={f}
            className={cn(
              TAB,
              f === "overspent" && overspent > 0
                ? onlyCredit
                  ? "text-yellow-700 hover:text-yellow-700 data-[state=on]:text-yellow-700 dark:text-yellow-400 dark:data-[state=on]:text-yellow-400"
                  : "text-destructive hover:text-destructive data-[state=on]:text-destructive"
                : undefined,
            )}
          >
            {label(f)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {menu?.(overflow)}
    </div>
  );
}
