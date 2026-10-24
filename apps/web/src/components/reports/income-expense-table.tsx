import { type BudgetMonth, money } from "@strictbudget/engine";
import { cn } from "@strictbudget/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useBudget } from "@/lib/budget-context";
import {
  heatOf,
  type RowValues,
  type IncomeExpenseTable as Table,
  useIncomeExpenseCollapse,
} from "@/lib/income-expense";
import { monthLabel } from "@/lib/reports";

/** Which cell was clicked: a month, or the whole range (Average and Total). */
export type CellColumn = BudgetMonth | "range";

export type RowTarget =
  | { kind: "income"; payeeId?: string | null }
  | { kind: "spending"; categoryId?: string; groupId?: string };

export interface CellPick {
  title: string;
  target: RowTarget;
  column: CellColumn;
}

const STICKY = "sticky left-0 z-10 bg-background";

/**
 * Sections, All Income Sources and groups fold (remembered by the browser); a folded group shows
 * its totals on its own row. Every amount but Net Income opens its transactions.
 */
export function IncomeExpenseTable({
  table,
  heat,
  onPick,
}: {
  table: Table;
  heat: boolean;
  onPick: (pick: CellPick) => void;
}) {
  const { budget, formatAmount } = useBudget();
  const [collapsed, toggle] = useIncomeExpenseCollapse();
  const format = (amount: bigint) => formatAmount(money(amount, budget.currency));
  const columns = table.months.length + 2;

  const cells = (
    values: RowValues,
    pick?: Omit<CellPick, "column">,
    options: { heat?: boolean; className?: (amount: bigint) => string | undefined } = {},
  ) => {
    const amounts: [CellColumn, bigint, string][] = [
      ...table.months.map((m, i) => [m, values.months[i] ?? 0n, m] as [CellColumn, bigint, string]),
      ["range", values.average, "average"],
      ["range", values.total, "total"],
    ];
    return amounts.map(([column, amount, key], i) => {
      const shade =
        options.heat && i < table.months.length ? heatStyle(heatOf(amount, values.average)) : {};
      const text = format(amount);
      return (
        <td
          key={key}
          style={shade}
          className={cn("px-2 py-1.5 text-right tabular-nums", options.className?.(amount))}
        >
          {pick ? (
            <button
              type="button"
              onClick={() => onPick({ ...pick, column })}
              className="rounded-sm px-1 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              aria-label={`${pick.title}, ${key === "average" ? "Average" : key === "total" ? "Total" : monthLabel(column as BudgetMonth, "long")}: ${text}`}
            >
              {text}
            </button>
          ) : (
            <span className="px-1">{text}</span>
          )}
        </td>
      );
    });
  };

  const caret = (key: string, label: string) => (
    <button
      type="button"
      onClick={() => toggle(key)}
      aria-expanded={!collapsed[key]}
      aria-label={`${collapsed[key] ? "Expand" : "Collapse"} ${label}`}
      className="rounded-sm text-muted-foreground hover:text-foreground"
    >
      <ChevronDown className={cn("size-4 transition-transform", collapsed[key] && "-rotate-90")} />
    </button>
  );

  const section = (key: string, label: string, className: string) => (
    <tr key={key}>
      <th scope="rowgroup" colSpan={columns + 1} className="px-2 pt-5 pb-1 text-left">
        <span
          className={cn(
            "sticky left-2 inline-flex items-center gap-1 font-semibold text-lg",
            className,
          )}
        >
          {caret(key, label)}
          {label}
        </span>
      </th>
    </tr>
  );

  const row = (
    key: string,
    label: ReactNode,
    values: RowValues | null,
    {
      pick,
      kind = "item",
      heat: shaded = false,
      foldKey,
    }: {
      pick?: Omit<CellPick, "column">;
      kind?: "item" | "header" | "subtotal" | "total";
      heat?: boolean;
      foldKey?: string;
    } = {},
  ) => (
    <tr
      key={key}
      className={cn(
        kind === "item" && "font-normal",
        kind === "header" && "font-medium [&>*]:bg-muted",
        kind === "subtotal" && "font-medium",
        kind === "total" && "font-semibold [&>*]:bg-muted",
      )}
    >
      <th
        scope="row"
        className={cn(
          STICKY,
          "max-w-56 truncate px-2 py-1.5 text-left",
          kind === "item" ? "pl-6 font-normal" : kind === "total" ? "font-semibold" : "font-medium",
        )}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {foldKey && caret(foldKey, typeof label === "string" ? label : key)}
        </span>
      </th>
      {values ? cells(values, pick, { heat: shaded }) : <td colSpan={columns} />}
    </tr>
  );

  const incomeOpen = !collapsed.income;
  const sourcesOpen = !collapsed["income-sources"];
  const expenseOpen = !collapsed.expense;
  const rate = (value: number | null) =>
    value === null ? "—" : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;

  return (
    <div className="max-h-[75vh] overflow-auto rounded-lg border">
      <table className="w-full min-w-max border-separate border-spacing-0 text-sm [&_td]:border-b [&_th]:border-b">
        <thead>
          <tr>
            <th scope="col" className={cn(STICKY, "sticky top-0 z-30 min-w-40 px-2 py-2")}>
              <span className="sr-only">Row</span>
            </th>
            {[...table.months.map((m) => monthLabel(m)), "Average", "Total"].map((label) => (
              <th
                key={label}
                scope="col"
                className="sticky top-0 z-20 min-w-28 bg-background px-3 py-2 text-right font-medium text-muted-foreground text-xs uppercase"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {section("income", "Income", "text-emerald-700 dark:text-emerald-400")}
          {incomeOpen && (
            <>
              {row("sources", "All Income Sources", sourcesOpen ? null : table.totalIncome, {
                kind: "header",
                foldKey: "income-sources",
                pick: sourcesOpen
                  ? undefined
                  : { title: "All Income Sources", target: { kind: "income" } },
              })}
              {sourcesOpen &&
                table.income.map((r) =>
                  row(`payee-${r.payeeId ?? "none"}`, r.name, r.values, {
                    pick: { title: r.name, target: { kind: "income", payeeId: r.payeeId } },
                  }),
                )}
              {sourcesOpen &&
                row("sources-total", "Total All Income Sources", table.totalIncome, {
                  kind: "subtotal",
                  pick: { title: "All Income Sources", target: { kind: "income" } },
                })}
              {row("income-total", "Total Income", table.totalIncome, {
                kind: "total",
                pick: { title: "Income", target: { kind: "income" } },
              })}
            </>
          )}
          {section("expense", "Expense", "text-destructive")}
          {expenseOpen && (
            <>
              {table.uncategorized &&
                row("uncategorized", table.uncategorized.name, table.uncategorized.values, {
                  kind: "header",
                  heat,
                  pick: {
                    title: table.uncategorized.name,
                    target: { kind: "spending", categoryId: table.uncategorized.categoryId },
                  },
                })}
              {table.groups.map((g) => {
                const open = !collapsed[g.groupId];
                const groupPick = {
                  title: g.name,
                  target: { kind: "spending", groupId: g.groupId } as const,
                };
                return [
                  row(`group-${g.groupId}`, g.name, open ? null : g.total, {
                    kind: "header",
                    foldKey: g.groupId,
                    pick: open ? undefined : groupPick,
                  }),
                  ...(open
                    ? [
                        ...g.categories.map((c) =>
                          row(`category-${c.categoryId}`, c.name, c.values, {
                            heat,
                            pick: {
                              title: c.name,
                              target: { kind: "spending", categoryId: c.categoryId },
                            },
                          }),
                        ),
                        row(`group-total-${g.groupId}`, `Total ${g.name}`, g.total, {
                          kind: "subtotal",
                          pick: groupPick,
                        }),
                      ]
                    : []),
                ];
              })}
              {row("expense-total", "Total Expenses", table.totalExpenses, {
                kind: "total",
                pick: { title: "Expenses", target: { kind: "spending" } },
              })}
            </>
          )}
          <tr>
            <th
              scope="row"
              className={cn(STICKY, "px-2 pt-5 pb-1.5 text-left font-semibold text-lg")}
            >
              Net Income
            </th>
            {cells(table.netIncome, undefined, {
              className: (a) =>
                cn(
                  "pt-5 font-semibold",
                  a > 0n && "text-emerald-700 dark:text-emerald-400",
                  a < 0n && "text-destructive",
                ),
            })}
          </tr>
          <tr>
            <th
              scope="row"
              className={cn(STICKY, "px-2 py-1.5 text-left font-normal text-muted-foreground")}
              title="Net income as a share of income"
            >
              Savings rate
            </th>
            {[...table.savingsRate.months, table.savingsRate.average, table.savingsRate.total].map(
              (v, i) => (
                <td
                  key={i}
                  className={cn(
                    "px-3 py-1.5 text-right text-muted-foreground tabular-nums",
                    v !== null && v < 0 && "text-destructive",
                  )}
                >
                  {rate(v)}
                </td>
              ),
            )}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * A cell's heat: warmer the more it spent than its row's average, cooler the less (display only).
 */
function heatStyle(heat: number | null): CSSProperties {
  if (heat === null || Math.abs(heat) < 0.1) return {};
  const strength = Math.round(8 + Math.abs(heat) * 30);
  const color = heat > 0 ? "var(--destructive)" : "var(--report-3)";
  return { backgroundColor: `color-mix(in oklab, ${color} ${strength}%, transparent)` };
}
