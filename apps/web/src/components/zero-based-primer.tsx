import { cn } from "@strictbudget/ui/lib/utils";
import { ArrowDown, ArrowUp, Landmark } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Setup's explanation of the method: four moves, each with a small picture of the budget doing
 * it. `example` formats whole units of the budget's currency (the pictures' made-up amounts).
 */
export function ZeroBasedPrimer({ example }: { example: (units: number) => string }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-2">
      <Move
        n={1}
        title="Start with the money you have"
        body="Ready to Assign is the cash in your accounts today, not next month's paycheck."
      >
        <div className="grid w-full max-w-56 justify-items-center gap-1.5">
          <Row
            icon={<Landmark className="size-3.5 text-muted-foreground" aria-hidden />}
            label="Checking"
            amount={example(2000)}
          />
          <ArrowDown className="size-3.5 text-muted-foreground" aria-hidden />
          <div className="flex w-full items-center justify-between gap-2 rounded-md bg-green-200 px-2.5 py-1.5 text-green-950 text-xs dark:bg-green-900/60 dark:text-green-50">
            <span className="font-medium">Ready to Assign</span>
            <span className="font-semibold tabular-nums">{example(2000)}</span>
          </div>
        </div>
      </Move>
      <Move
        n={2}
        title="Give every dollar a job"
        body="Assign it to categories until Ready to Assign reaches zero."
      >
        <div className="grid w-full max-w-56 gap-2">
          <div className="flex h-2.5 overflow-hidden rounded-full">
            <span className="w-[60%] bg-chart-1" />
            <span className="w-[25%] border-background border-l-2 bg-chart-2" />
            <span className="w-[15%] border-background border-l-2 bg-chart-3" />
          </div>
          <ul className="grid gap-1 text-xs">
            <Legend swatch="bg-chart-1" label="Rent" amount={example(1200)} />
            <Legend swatch="bg-chart-2" label="Groceries" amount={example(500)} />
            <Legend swatch="bg-chart-3" label="Savings" amount={example(300)} />
          </ul>
          <span className="flex justify-between border-t pt-1.5 font-medium text-xs">
            Ready to Assign <span className="tabular-nums">{example(0)}</span>
          </span>
        </div>
      </Move>
      <Move
        n={3}
        title="Spend from what's available"
        body="Each category shows what's left of its job. Spending takes from there."
      >
        <div className="grid w-full max-w-56 gap-1.5 rounded-md bg-background px-2.5 py-2 text-xs ring-1 ring-border">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">Groceries</span>
            <span className="rounded-full bg-green-200 px-1.5 font-semibold text-green-950 tabular-nums dark:bg-green-900/60 dark:text-green-50">
              {example(380)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-[76%] rounded-full bg-green-600 dark:bg-green-500" />
          </div>
          <span className="text-muted-foreground">
            {example(120)} spent of {example(500)}
          </span>
        </div>
      </Move>
      <Move
        n={4}
        title="Roll with the punches"
        body="Overspent somewhere? Move money from another category. Changing the plan is part of the plan."
      >
        <div className="grid w-full max-w-56 gap-1.5 text-xs">
          <div className="flex items-center justify-between gap-2 rounded-md bg-background px-2.5 py-1.5 ring-1 ring-border">
            <span className="font-medium">Dining out</span>
            <span className="rounded-full bg-red-200 px-1.5 font-semibold text-red-950 tabular-nums dark:bg-red-900/60 dark:text-red-50">
              −{example(40)}
            </span>
          </div>
          <div className="flex items-center justify-center gap-1 text-muted-foreground">
            <ArrowUp className="size-3.5" aria-hidden />
            move {example(40)}
          </div>
          <Row label="Fun money" amount={example(60)} />
        </div>
      </Move>
    </ol>
  );
}

function Move({
  n,
  title,
  body,
  children,
}: {
  n: number;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <li className="grid content-start gap-3 rounded-xl border p-3">
      {/* The picture is decoration: the title and sentence say it all to a screen reader. */}
      <div
        aria-hidden
        className="flex h-36 items-center justify-center rounded-lg bg-muted/60 px-4 dark:bg-muted/40"
      >
        {children}
      </div>
      <div className="flex gap-3 px-1 pb-1">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary font-semibold text-primary-foreground text-xs tabular-nums">
          {n}
        </span>
        <div className="grid gap-0.5">
          <h3 className="font-semibold text-sm">{title}</h3>
          <p className="text-pretty text-muted-foreground text-sm">{body}</p>
        </div>
      </div>
    </li>
  );
}

function Row({ icon, label, amount }: { icon?: ReactNode; label: string; amount: string }) {
  return (
    <div className="flex w-full items-center justify-between gap-2 rounded-md bg-background px-2.5 py-1.5 text-xs ring-1 ring-border">
      <span className="flex items-center gap-1.5 font-medium">
        {icon}
        {label}
      </span>
      <span className="tabular-nums">{amount}</span>
    </div>
  );
}

function Legend({ swatch, label, amount }: { swatch: string; label: string; amount: string }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5">
        <span className={cn("size-2 rounded-full", swatch)} />
        {label}
      </span>
      <span className="tabular-nums">{amount}</span>
    </li>
  );
}
