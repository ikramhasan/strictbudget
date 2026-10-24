import { type BudgetMonth, money } from "@strictbudget/engine";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@strictbudget/ui/components/table";
import { cn } from "@strictbudget/ui/lib/utils";
import { Fragment } from "react";
import { useBudget } from "@/lib/budget-context";
import {
  type BudgetVsActual,
  type HeatCell,
  overMonthsLabel,
  type PlanStatus,
  percentOfPlan,
  type VarianceRow,
} from "@/lib/budget-vs-actual";
import { monthLabel } from "@/lib/reports";

/** Under, on and over plan: blue, green and vermillion from the report palette (both themes). */
export const STATUS_COLOR: Record<PlanStatus, string> = {
  under: "var(--report-1)",
  on: "var(--report-3)",
  over: "var(--report-4)",
};

export const STATUS_LABEL: Record<PlanStatus, string> = {
  under: "Under plan",
  on: "On plan",
  over: "Over plan",
};

/** What a click on a category (and maybe one month of it) opens. */
export type OnCategory = (row: VarianceRow, month?: BudgetMonth) => void;

function useFormat() {
  const { budget, formatAmount } = useBudget();
  return (amount: bigint) => formatAmount(money(amount, budget.currency));
}

/** "$12.00 left" / "$5.00 over" / "On plan". */
function differenceLabel(assigned: bigint, spent: bigint, format: (a: bigint) => string) {
  const left = assigned - spent;
  if (left === 0n) return "On plan";
  return left > 0n ? `${format(left)} left` : `${format(-left)} over`;
}

export function StatusLegend({ target = true }: { target?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
      <li className="flex items-center gap-1.5">
        <span className="h-3 w-5 rounded-sm bg-muted-foreground/25" />
        Assigned
      </li>
      {(Object.keys(STATUS_LABEL) as PlanStatus[]).map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <span className="h-1.5 w-5 rounded-sm" style={{ background: STATUS_COLOR[s] }} />
          Spent, {STATUS_LABEL[s].toLowerCase()}
        </li>
      ))}
      {target && (
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-0.5 bg-foreground" />
          Target
        </li>
      )}
    </ul>
  );
}

/**
 * The bullet chart: per category a light band for what was assigned, a thick bar
 * for what was spent coloured by under / on / over plan, and a tick for what its target asked.
 * Plain elements rather than a chart library: each row is three positioned boxes on one scale,
 * and the rows are buttons that open the category's transactions.
 */
export function BulletChart({
  report,
  onCategory,
}: {
  report: BudgetVsActual;
  onCategory: OnCategory;
}) {
  const format = useFormat();
  const rows = report.groups.flatMap((g) => g.rows);
  // One scale for every row: the largest of what was assigned, spent or targeted.
  const scale = rows.reduce((max, r) => {
    for (const v of [r.assigned, r.spent, r.target ?? 0n]) if (v > max) max = v;
    return max;
  }, 0n);
  const width = (amount: bigint) =>
    scale > 0n && amount > 0n ? `${Number((amount * 10000n) / scale) / 100}%` : "0%";
  return (
    <div className="grid gap-4">
      <StatusLegend />
      {report.groups.map((g) => (
        <section key={g.groupId} aria-label={g.name} className="grid gap-1.5">
          <h3 className="flex flex-wrap items-baseline justify-between gap-x-3 border-b pb-1 font-medium text-sm">
            <span>{g.name}</span>
            <span className="text-muted-foreground text-xs tabular-nums">
              {format(g.spent)} of {format(g.assigned)} ·{" "}
              <span style={{ color: STATUS_COLOR[g.status] }}>
                {differenceLabel(g.assigned, g.spent, format)}
              </span>
            </span>
          </h3>
          <ul className="grid gap-1">
            {g.rows.map((r) => (
              <li key={r.categoryId}>
                <button
                  type="button"
                  onClick={() => onCategory(r)}
                  aria-label={`${r.name}: spent ${format(r.spent)} of ${format(r.assigned)} assigned${r.target === null ? "" : `, target ${format(r.target)}`}, ${STATUS_LABEL[r.status].toLowerCase()}`}
                  className="grid w-full grid-cols-1 items-center gap-x-3 gap-y-1 rounded-md px-1 py-1 text-left text-sm hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-[minmax(8rem,14rem)_1fr_minmax(9rem,auto)]"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{r.name}</span>
                    {r.hidden && <HiddenBadge />}
                  </span>
                  <span className="relative h-5 rounded-sm" aria-hidden>
                    <span
                      className="absolute inset-y-0 left-0 rounded-sm bg-muted-foreground/20"
                      style={{ width: width(r.assigned) }}
                    />
                    <span
                      className="absolute inset-y-1.5 left-0 rounded-sm"
                      style={{ width: width(r.spent), background: STATUS_COLOR[r.status] }}
                    />
                    {r.target !== null && (
                      <span
                        className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground"
                        style={{ left: width(r.target) }}
                      />
                    )}
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums sm:text-right">
                    {format(r.spent)} of {format(r.assigned)} ·{" "}
                    <span style={{ color: STATUS_COLOR[r.status] }}>
                      {differenceLabel(r.assigned, r.spent, format)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function HiddenBadge() {
  return (
    <span className="shrink-0 rounded border px-1 text-[10px] text-muted-foreground uppercase">
      Hidden
    </span>
  );
}

const percentLabel = (spent: bigint, assigned: bigint) => {
  const p = percentOfPlan(spent, assigned);
  return p === null ? "—" : `${p.toFixed(1)}%`;
};

/**
 * The variance table (the bullet chart's table view): Assigned, Spent, the difference, spending as
 * a % of the plan, the target and how many of the last 12 months were over plan.
 */
export function VarianceTable({
  report,
  onCategory,
}: {
  report: BudgetVsActual;
  onCategory: OnCategory;
}) {
  const format = useFormat();
  const amounts = (assigned: bigint, spent: bigint) => (
    <>
      <TableCell className="text-right tabular-nums">{format(assigned)}</TableCell>
      <TableCell className="text-right tabular-nums">{format(spent)}</TableCell>
      <TableCell className="text-right tabular-nums">{format(assigned - spent)}</TableCell>
      <TableCell className="text-right tabular-nums">{percentLabel(spent, assigned)}</TableCell>
    </>
  );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Category</TableHead>
          <TableHead className="text-right">Assigned</TableHead>
          <TableHead className="text-right">Spent</TableHead>
          <TableHead className="text-right">Difference</TableHead>
          <TableHead className="text-right">% of Plan</TableHead>
          <TableHead className="text-right">Target</TableHead>
          <TableHead className="text-right" title="Months spending more than was assigned">
            Over Plan (12 mo)
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.groups.map((g) => (
          <Fragment key={g.groupId}>
            <TableRow className="bg-muted/40 font-medium hover:bg-muted/40">
              <TableCell>{g.name}</TableCell>
              {amounts(g.assigned, g.spent)}
              <TableCell />
              <TableCell />
            </TableRow>
            {g.rows.map((r) => (
              <TableRow key={r.categoryId}>
                <TableCell className="pl-6">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: STATUS_COLOR[r.status] }}
                      title={STATUS_LABEL[r.status]}
                    />
                    <button
                      type="button"
                      className="truncate text-left hover:underline"
                      onClick={() => onCategory(r)}
                    >
                      {r.name}
                    </button>
                    {r.hidden && <HiddenBadge />}
                  </span>
                </TableCell>
                {amounts(r.assigned, r.spent)}
                <TableCell className="text-right tabular-nums">
                  {r.target === null ? "—" : format(r.target)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{overMonthsLabel(r)}</TableCell>
              </TableRow>
            ))}
          </Fragment>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Total</TableCell>
          {amounts(report.assigned, report.spent)}
          <TableCell />
          <TableCell />
        </TableRow>
      </TableFooter>
    </Table>
  );
}

/** The overspending marks, as the plan screen colours them: red for cash, yellow for credit. */
const OVERSPENT_RING = {
  cash: "ring-2 ring-destructive ring-inset",
  credit: "ring-2 ring-yellow-500 ring-inset dark:ring-yellow-300",
} as const;

/**
 * The overspending heatmap: categories × months, each cell spent − assigned on a
 * diverging scale (under plan blue, over plan vermillion, deeper the further off), and a red
 * (cash) or yellow (credit) ring on months the category ended overspent. Cells open that month's
 * transactions.
 */
export function Heatmap({
  report,
  onCategory,
}: {
  report: BudgetVsActual;
  onCategory: OnCategory;
}) {
  const format = useFormat();
  const rows = report.groups.flatMap((g) => g.rows);
  const largest = rows
    .flatMap((r) => r.cells)
    .reduce((max, c) => {
      const v = c.variance < 0n ? -c.variance : c.variance;
      return v > max ? v : max;
    }, 0n);
  const fill = (c: HeatCell) => {
    if (c.variance === 0n || largest === 0n) return undefined;
    const size = c.variance < 0n ? -c.variance : c.variance;
    // 15–90% of the hue, by the cell's share of the largest difference on the map.
    const share = 15 + Number((size * 75n) / largest);
    const hue = c.variance > 0n ? STATUS_COLOR.over : STATUS_COLOR.under;
    return `color-mix(in oklab, ${hue} ${share}%, transparent)`;
  };
  const describe = (r: VarianceRow, c: HeatCell) =>
    `${r.name}, ${monthLabel(c.month, "long")}: ${
      c.variance === 0n
        ? "on plan"
        : c.variance > 0n
          ? `${format(c.variance)} over plan`
          : `${format(-c.variance)} under plan`
    }${c.overspent ? `, overspent (${c.overspent})` : ""}`;
  return (
    <div className="grid gap-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
        <li className="flex items-center gap-1.5">
          <span
            className="h-3 w-8 rounded-sm"
            style={{
              background: `linear-gradient(to right, ${STATUS_COLOR.under}, transparent)`,
            }}
          />
          Under plan
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="h-3 w-8 rounded-sm"
            style={{
              background: `linear-gradient(to right, transparent, ${STATUS_COLOR.over})`,
            }}
          />
          Over plan
        </li>
        <li className="flex items-center gap-1.5">
          <span className={cn("size-3 rounded-sm", OVERSPENT_RING.cash)} />
          Overspent (cash)
        </li>
        <li className="flex items-center gap-1.5">
          <span className={cn("size-3 rounded-sm", OVERSPENT_RING.credit)} />
          Overspent (credit)
        </li>
      </ul>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0.5 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-background" />
              {report.months.map((m) => (
                <th
                  key={m}
                  scope="col"
                  className="min-w-9 px-0.5 font-normal text-muted-foreground"
                >
                  {monthLabel(m, "axis")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.categoryId}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 max-w-36 truncate bg-background pr-2 text-left font-normal"
                >
                  {r.name}
                </th>
                {r.cells.map((c) => (
                  <td key={c.month} className="p-0">
                    <button
                      type="button"
                      aria-label={describe(r, c)}
                      title={describe(r, c)}
                      onClick={() => onCategory(r, c.month)}
                      className={cn(
                        "block h-7 w-full min-w-9 rounded-sm bg-muted/40 hover:outline-2 hover:outline-foreground/40 focus-visible:outline-2 focus-visible:outline-ring",
                        c.overspent && OVERSPENT_RING[c.overspent],
                      )}
                      style={{ background: fill(c) }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The heatmap's table view: each category's spent − assigned per month (positive: over plan). */
export function HeatmapTable({ report }: { report: BudgetVsActual }) {
  const format = useFormat();
  const rows = report.groups.flatMap((g) => g.rows);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Category</TableHead>
          {report.months.map((m) => (
            <TableHead key={m} className="text-right">
              {monthLabel(m)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.categoryId}>
            <TableCell>{r.name}</TableCell>
            {r.cells.map((c) => (
              <TableCell
                key={c.month}
                className={cn(
                  "text-right tabular-nums",
                  c.overspent === "cash" && "text-destructive",
                  c.overspent === "credit" && "text-yellow-800 dark:text-yellow-200",
                )}
              >
                {format(c.variance)}
                {c.overspent && <span className="sr-only"> (overspent, {c.overspent})</span>}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
