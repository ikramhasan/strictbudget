import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { cn } from "@strictbudget/ui/lib/utils";
import { REGISTER_TRAY } from "./register-table";

// What the register looks like while it loads: its toolbar, the table's tray and header, and rows
// whose bars sit where a row's date, payee, category and amounts will, so nothing jumps when the
// rows arrive. The widths vary row to row as real names do.

/** Each row's payee, category and memo widths (% of their column), and which side its amount is on. */
const ROWS: readonly { payee: number; category: number; memo: number; inflow?: boolean }[] = [
  { payee: 62, category: 48, memo: 30 },
  { payee: 44, category: 66, memo: 0 },
  { payee: 74, category: 40, memo: 45, inflow: true },
  { payee: 38, category: 58, memo: 0 },
  { payee: 56, category: 46, memo: 22 },
  { payee: 68, category: 70, memo: 0 },
  { payee: 48, category: 52, memo: 38 },
  { payee: 70, category: 36, memo: 0, inflow: true },
  { payee: 42, category: 62, memo: 26 },
  { payee: 58, category: 44, memo: 0 },
];

/**
 * The columns of a single account's register at a desktop width: select, date, payee, category,
 * memo (from lg), outflow, inflow, balance, cleared, actions.
 */
const GRID =
  "grid grid-cols-[1.75rem_6rem_minmax(0,1.3fr)_minmax(0,1.2fr)_5.75rem_5.75rem_6.25rem_2.25rem_2.25rem] items-center lg:grid-cols-[1.75rem_6rem_minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1fr)_5.75rem_5.75rem_6.25rem_2.25rem_2.25rem]";
const CELL = "flex min-w-0 items-center px-2";
const MEMO = "max-lg:hidden";

function Bar({ className, width }: { className?: string; width?: number }) {
  return (
    <Skeleton
      className={cn("h-3 rounded-sm", className)}
      style={width === undefined ? undefined : { width: `${width}%` }}
    />
  );
}

/** The register's toolbar: add and import on the left; undo, view and search on the right. */
function ToolbarSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Skeleton className="h-8 w-36" />
      <Skeleton className="h-8 w-24 max-sm:hidden" />
      <div className="ml-auto flex items-center gap-1 max-md:w-full">
        <Skeleton className="size-8" />
        <Skeleton className="size-8" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-56 max-md:flex-1" />
      </div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl px-[5px] pb-[5px] ring-1 ring-border",
        REGISTER_TRAY,
      )}
    >
      <div className={cn(GRID, "h-9")}>
        <span className={cn(CELL, "justify-center pr-0")}>
          <Skeleton className="size-4 rounded-[4px] opacity-70" />
        </span>
        <span className={CELL}>
          <Bar className="w-8 opacity-70" />
        </span>
        <span className={CELL}>
          <Bar className="w-11 opacity-70" />
        </span>
        <span className={CELL}>
          <Bar className="w-16 opacity-70" />
        </span>
        <span className={cn(CELL, MEMO)}>
          <Bar className="w-10 opacity-70" />
        </span>
        <span className={cn(CELL, "justify-end")}>
          <Bar className="w-12 opacity-70" />
        </span>
        <span className={cn(CELL, "justify-end")}>
          <Bar className="w-10 opacity-70" />
        </span>
        <span className={cn(CELL, "justify-end")}>
          <Bar className="w-12 opacity-70" />
        </span>
        <span />
        <span />
      </div>
      <div className="rounded-[10px] border bg-background shadow-[0_1px_2px_rgb(0_0_0/0.04)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.4)]">
        {ROWS.map((row, i) => (
          <div key={i} className={cn(GRID, "h-9 border-b last:border-b-0")}>
            <span className={cn(CELL, "justify-center pr-0")}>
              <Skeleton className="size-4 rounded-[4px]" />
            </span>
            <span className={CELL}>
              <Bar className="w-[4.5rem]" />
            </span>
            <span className={CELL}>
              <Bar width={row.payee} />
            </span>
            <span className={CELL}>
              <Bar width={row.category} className="opacity-70" />
            </span>
            <span className={cn(CELL, MEMO)}>
              {row.memo > 0 && <Bar width={row.memo} className="opacity-60" />}
            </span>
            <span className={cn(CELL, "justify-end")}>
              {!row.inflow && <Bar className="w-14" />}
            </span>
            <span className={cn(CELL, "justify-end")}>
              {row.inflow && <Bar className="w-14" />}
            </span>
            <span className={cn(CELL, "justify-end")}>
              <Bar className="w-16 opacity-60" />
            </span>
            <span className="flex justify-center">
              <Skeleton className="size-[18px] rounded-full" />
            </span>
            <span />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A phone's register: cards with the payee and amount on top, the date and category under them. */
function CardsSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border">
      {ROWS.slice(0, 8).map((row, i) => (
        <div
          key={i}
          className="flex min-h-[3.75rem] items-center gap-3 border-b py-2 pr-1 pl-3 last:border-b-0"
        >
          <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2">
            <Bar width={row.payee} className="h-3.5" />
            <Bar className="h-3.5 w-16" />
            <Bar width={row.category + 10} className="col-span-2 h-2.5 opacity-60" />
          </div>
          <span className="flex size-11 shrink-0 items-center justify-center">
            <Skeleton className="size-[18px] rounded-full" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** The register while its rows load: toolbar and table (cards on a phone). */
export function RegisterSkeleton({ phone = false }: { phone?: boolean }) {
  return (
    <div role="status" className="grid gap-3" aria-busy="true" aria-label="Loading transactions">
      <ToolbarSkeleton />
      {phone ? <CardsSkeleton /> : <TableSkeleton />}
    </div>
  );
}

/** An account's page while it loads: its header, balances and register. */
export function AccountPageSkeleton({ phone = false }: { phone?: boolean }) {
  return (
    <div role="status" className="grid gap-6" aria-busy="true" aria-label="Loading account">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-20 rounded-full max-md:hidden" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-8 w-28 max-md:hidden" />
          <Skeleton className="h-8 w-24 max-md:size-8" />
        </div>
      </div>
      <div className="flex items-end gap-x-6 rounded-lg border px-4 py-3 sm:gap-x-8">
        {["w-24", "w-24", "w-28"].map((width, i) => (
          <div key={width + String(i)} className="grid gap-2">
            <Bar className="h-2.5 w-16 opacity-70 sm:w-24" />
            <Skeleton className={cn("h-5", i === 2 ? "h-6" : "", width)} />
          </div>
        ))}
        <Skeleton className="ml-auto h-7 w-36 self-center max-sm:w-8" />
      </div>
      <RegisterSkeleton phone={phone} />
    </div>
  );
}
