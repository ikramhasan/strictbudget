import { addMonths } from "@strictbudget/engine";
import { Popover, PopoverContent, PopoverTrigger } from "@strictbudget/ui/components/popover";
import { cn } from "@strictbudget/ui/lib/utils";
import { CircleCheck, CircleMinus, CirclePlus, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { type BudgetMonthData, monthName } from "@/lib/months";
import { TargetPie } from "./move-money";

type Breakdown = BudgetMonthData["readyToAssignBreakdown"];

/**
 * The breakdown's lines for `month`: what adds to Ready to Assign, then what takes from it. Lines at
 * zero are left out.
 */
export function breakdownSections(b: Breakdown, month: string) {
  const last = monthName(addMonths(month, -1));
  const name = monthName(month);
  const keep = (lines: { label: string; amount: string }[]) =>
    lines.filter((l) => l.amount !== "0");
  return {
    plus: keep([
      { label: `Ready to Assign left over from ${last}`, amount: b.leftOver },
      { label: `Inflow: Ready to Assign transactions in ${name}`, amount: b.inflows },
      { label: "Inflow from Debt Account", amount: b.debtInflows },
    ]),
    minus: keep([
      { label: `Cash overspending in ${last}`, amount: b.cashOverspending },
      { label: `Assigned in ${name}`, amount: b.assigned },
      { label: "Assigned in Future", amount: b.assignedInFuture },
    ]),
  };
}

const sum = (lines: { amount: string }[]) =>
  lines.reduce((total, l) => total + BigInt(l.amount), 0n).toString();

/** Positive breakdown amounts get a plus sign. */
const signed = (format: (minorUnits: string) => string, amount: string) =>
  `${BigInt(amount) > 0n ? "+" : ""}${format(amount)}`;

function BreakdownContent({
  breakdown,
  month,
  format,
}: {
  breakdown: Breakdown;
  month: string;
  format: (minorUnits: string) => string;
}) {
  const { plus, minus } = breakdownSections(breakdown, month);
  const total = BigInt(breakdown.total);
  const section = (
    lines: { label: string; amount: string }[],
    icon: ReactNode,
    label: string,
    subtotalClass?: string,
  ) =>
    lines.length > 0 && (
      <section aria-label={label} className="grid gap-1 border-b pb-2">
        <div className="flex items-center justify-between">
          {icon}
          <span className={cn("tabular-nums", subtotalClass)}>{signed(format, sum(lines))}</span>
        </div>
        {lines.map((l) => (
          <div key={l.label} className="flex justify-between gap-3">
            <span>{l.label}</span>
            <span className="tabular-nums">{signed(format, l.amount)}</span>
          </div>
        ))}
      </section>
    );
  return (
    <div className="grid gap-3 text-sm">
      <h2 className="font-medium">Ready to Assign Breakdown</h2>
      <div className="grid gap-2 rounded-md bg-muted/60 p-3">
        {section(
          plus,
          <CirclePlus className="size-4 text-green-700 dark:text-green-400" aria-hidden />,
          "Added",
          "text-green-700 dark:text-green-400",
        )}
        {section(minus, <CircleMinus className="size-4" aria-hidden />, "Taken")}
        <div className="flex justify-between gap-3 font-semibold">
          <span>Total Ready to Assign</span>
          <span
            className={cn(
              "tabular-nums",
              total > 0n && "text-green-700 dark:text-green-400",
              total < 0n && "text-destructive",
            )}
          >
            = {signed(format, breakdown.total)}
          </span>
        </div>
        <p className="text-muted-foreground">
          {total > 0n
            ? "Give these dollars a job by assigning them to one or more categories!"
            : total === 0n
              ? "Nice work! Every dollar has a job."
              : "You have assigned more than you have."}
        </p>
      </div>
      <p className="flex gap-2 rounded-md bg-blue-50 p-3 text-blue-950 dark:bg-blue-950/40 dark:text-blue-50">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        Ready to Assign is money that hasn't yet been assigned to a category.
      </p>
    </div>
  );
}

/**
 * Red when negative: "You assigned more than you have" while categories could cover it,
 * "Overdraft? We can help with that!" once even their cash couldn't (the API's `overdraft`).
 */
export function ReadyToAssignBanner({
  amount,
  overdraft,
  format,
  action,
  assign,
  breakdown,
}: {
  amount: string;
  overdraft: boolean;
  format: (minorUnits: string) => string;
  /** A button for money assigned beyond what there is (Fix This). */
  action?: ReactNode;
  /** The Assign button, while there's money to assign. */
  assign?: ReactNode;
  /** The month's breakdown, opened by clicking the amount. */
  breakdown?: { lines: Breakdown; month: string };
}) {
  const sign = amount === "0" ? 0 : amount.startsWith("-") ? -1 : 1;
  const negativeLabel = overdraft
    ? "Overdraft? We can help with that!"
    : "You assigned more than you have";
  const summary = (
    <>
      <span className="font-semibold text-2xl tabular-nums">{format(amount)}</span>
      <span className="text-sm">
        {sign > 0 ? "Ready to Assign" : sign === 0 ? "All Money Assigned" : negativeLabel}
      </span>
    </>
  );
  return (
    <output
      aria-live="polite"
      className={cn(
        "flex min-w-56 flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-2 max-md:w-full transition-colors duration-200 ease-out-quint",
        sign > 0 && "bg-green-200 text-green-950 dark:bg-green-900/60 dark:text-green-50",
        sign === 0 && "bg-muted text-muted-foreground",
        sign < 0 && "bg-red-200 text-red-950 dark:bg-red-900/60 dark:text-red-50",
      )}
    >
      {breakdown ? (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="grid cursor-pointer text-left">
              {summary}
              {/* After the amount, so the visible text starts the button's name (WCAG 2.5.3). */}
              <span className="sr-only">View Ready to Assign Breakdown</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-96">
            <BreakdownContent breakdown={breakdown.lines} month={breakdown.month} format={format} />
          </PopoverContent>
        </Popover>
      ) : (
        <span className="grid">{summary}</span>
      )}
      {sign > 0 && assign}
      {sign === 0 && <CircleCheck className="size-6" aria-hidden />}
      {sign < 0 && !overdraft && action}
    </output>
  );
}

/**
 * Shown in the current month; lists the next month even when nothing is assigned there. When a
 * later month is over-assigned the heading gets a warning sign and a red line names the first such
 * month.
 */
export function FutureMonthsPanel({
  data,
  format,
}: {
  data: BudgetMonthData;
  format: (minorUnits: string) => string;
}) {
  const months = data.futureMonths.length
    ? data.futureMonths
    : [{ month: addMonths(data.month, 1), assigned: "0", targets: data.nextMonthTargets }];
  return (
    <section aria-label="Assigned in Future Months" className="grid gap-2 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2 font-semibold text-sm">
        <h2 className="flex items-center gap-1.5">
          {data.futureShortfall && (
            <TriangleAlert className="size-4 shrink-0" aria-label="A later month is short" />
          )}
          Assigned in Future Months
        </h2>
        <span className="tabular-nums">{format(data.assignedInFuture)}</span>
      </div>
      {data.futureShortfall && (
        <p className="rounded-md bg-red-100 px-3 py-1.5 text-center text-red-950 text-sm dark:bg-red-900/40 dark:text-red-50">
          Ready to Assign in {monthName(data.futureShortfall.month)} is{" "}
          {format(data.futureShortfall.readyToAssign)}
        </p>
      )}
      <ul className="grid gap-1 text-sm">
        {months.map((m) => (
          <li key={m.month} className="flex justify-between gap-2">
            <span className="flex items-center gap-1.5">
              {m.targets && <FutureTargetIcon targets={m.targets} />}
              {monthName(m.month)}
            </span>
            <span className="tabular-nums">{format(m.assigned)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * How much of a later month's targets is funded: a blue pie filling up, a check once they're all
 * funded; no icon for a month without targets.
 */
export function FutureTargetIcon({ targets }: { targets: { needed: string; funded: string } }) {
  const needed = BigInt(targets.needed);
  const funded = BigInt(targets.funded);
  const tone = "text-blue-600 dark:text-blue-400";
  if (funded >= needed) {
    return <CircleCheck className={cn("size-4 shrink-0", tone)} aria-label="Targets funded" />;
  }
  return <TargetPie percent={Number((funded * 100n) / needed)} className={cn("size-4", tone)} />;
}
