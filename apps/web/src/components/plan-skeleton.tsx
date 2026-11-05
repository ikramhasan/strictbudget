import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { cn } from "@strictbudget/ui/lib/utils";

// The plan while its categories load, in the plan table's own layout: the view tabs, the tinted
// header, groups with their categories (a name, its target bar and three figures, Available as a
// pill), and the inspector card beside it. The column grid and tints match category-list's.

const ROW =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1 px-2 py-1.5 max-md:min-h-12 md:grid-cols-[minmax(9rem,1fr)_6rem_6rem_6.5rem]";
const TINT =
  "bg-[color-mix(in_oklch,var(--muted),var(--background)_35%)] dark:bg-[color-mix(in_oklch,var(--muted),var(--background)_45%)]";
const HEADER_TINT =
  "bg-[color-mix(in_oklch,var(--muted),var(--background)_35%)] dark:bg-[color-mix(in_oklch,var(--muted),var(--background)_50%)]";
const WIDE_ONLY = "max-md:hidden";

/** Each group's name width and its categories' (name width, how full the target bar is). */
const GROUPS: readonly { name: number; categories: readonly [number, number][] }[] = [
  {
    name: 30,
    categories: [
      [38, 100],
      [52, 100],
      [30, 64],
      [44, 100],
    ],
  },
  {
    name: 24,
    categories: [
      [46, 40],
      [34, 100],
      [56, 0],
    ],
  },
  {
    name: 36,
    categories: [
      [42, 82],
      [28, 100],
      [50, 20],
      [36, 100],
    ],
  },
];

function Bar({ className, width }: { className?: string; width?: number }) {
  return (
    <Skeleton
      className={cn("h-3 rounded-sm", className)}
      style={width === undefined ? undefined : { width: `${width}%` }}
    />
  );
}

/** A figure column's placeholder, right-aligned like the figures. */
function Figure({ className, bar }: { className?: string; bar: string }) {
  return (
    <span className={cn("flex justify-end px-2", className)}>
      <Bar className={bar} />
    </span>
  );
}

/** The plan's view tabs and its table of groups and categories. */
export function PlanTableSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("grid content-start gap-3", className)}>
      <div className="flex items-end gap-5 shadow-[inset_0_-1px_0_var(--border)]">
        {["w-6", "w-20", "w-16", "w-24"].map((width, i) => (
          <span
            key={width}
            className={cn("pb-2.5", i === 0 && "shadow-[inset_0_-2px_0_var(--border)]")}
          >
            <Bar className={cn("h-3", width, i > 0 && "opacity-60")} />
          </span>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border bg-background shadow-[0_1px_2px_rgb(0_0_0/0.04)] dark:shadow-none">
        <div className={cn(ROW, "h-9 border-b", HEADER_TINT)}>
          <span className="flex items-center gap-1">
            <Skeleton className="mx-1 size-4 rounded-[4px] opacity-70" />
            <Bar className="w-16 opacity-70" />
          </span>
          <Figure className={WIDE_ONLY} bar="w-14 opacity-70" />
          <Figure className={WIDE_ONLY} bar="w-12 opacity-70" />
          <Figure bar="w-14 opacity-70" />
        </div>
        {GROUPS.map((group, g) => (
          <div key={group.name} className="border-b last:border-b-0">
            <div className={cn(ROW, TINT)}>
              <span className="flex items-center gap-1">
                <Skeleton className="mx-1 size-4 rounded-[4px]" />
                <Bar width={group.name} className="h-3.5" />
              </span>
              <Figure className={WIDE_ONLY} bar="w-16" />
              <Figure className={WIDE_ONLY} bar="w-14" />
              <Figure bar="w-16" />
            </div>
            <div className="min-h-2">
              {group.categories.map(([name, filled], c) => (
                <div key={`${g}-${c}`} className={cn(ROW, "border-t first:border-t-0")}>
                  <span className="grid min-w-0 gap-2">
                    <span className="flex items-center gap-1">
                      <Skeleton className="mx-1 size-4 rounded-[4px] opacity-70" />
                      <Bar width={name} />
                    </span>
                    {/* The target bar, under the name where category-list draws it. */}
                    <span className="mr-1 ml-7 flex h-1 gap-1 overflow-hidden rounded-full md:ml-16">
                      <Skeleton
                        className="h-1 rounded-full"
                        style={{ width: `${Math.max(filled, 4)}%` }}
                      />
                      {filled < 100 && <Skeleton className="h-1 flex-1 rounded-full opacity-50" />}
                    </span>
                  </span>
                  <Figure className={WIDE_ONLY} bar="w-14" />
                  <Figure className={WIDE_ONLY} bar="w-12 opacity-70" />
                  <span className="flex justify-end px-1">
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The inspector card beside the plan: a name, Available, its summary and the target section. */
export function PlanInspectorSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("grid content-start gap-4 rounded-lg border p-4", className)}>
      <div className="grid gap-2">
        <Bar className="h-4 w-36" />
        <Bar className="h-2.5 w-24 opacity-60" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <Bar className="w-28 opacity-70" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <div className="grid gap-2.5">
        {["w-20", "w-24", "w-16", "w-20"].map((width, i) => (
          <div key={width + String(i)} className="flex items-center justify-between gap-2">
            <Bar className={cn("opacity-60", ["w-28", "w-24", "w-32", "w-20"][i])} />
            <Bar className={width} />
          </div>
        ))}
      </div>
      <div className="grid gap-2.5 border-t pt-4">
        <Bar className="h-3.5 w-32" />
        <Skeleton className="h-1 w-full rounded-full opacity-70" />
        <Bar className="w-3/4 opacity-60" />
        <Skeleton className="mt-1 h-8 w-full" />
      </div>
    </div>
  );
}

/** The plan table and, when there's room for it, the inspector beside it. */
export function PlanSkeleton({ inspector = true }: { inspector?: boolean }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading the plan"
      className={cn(
        "grid items-start gap-4",
        inspector && "md:grid-cols-[minmax(0,2fr)_minmax(17.5rem,1fr)]",
      )}
    >
      <PlanTableSkeleton />
      {inspector && <PlanInspectorSkeleton className="max-md:hidden" />}
    </div>
  );
}
