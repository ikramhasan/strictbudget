import {
  type BudgetMonth,
  effectivePayment,
  minimumToPayDown,
  monthsBetween,
  paymentForMonths,
  payoffSchedule,
  plannedPayoff,
} from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import { Input } from "@strictbudget/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@strictbudget/ui/components/popover";
import { cn } from "@strictbudget/ui/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, ChevronRight, Copy, TriangleAlert, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useBudget } from "@/lib/budget-context";
import { formatDuration, type LoanPlan, type Track, trackAt } from "@/lib/loan-planner";
import { formatRate, shortMonth } from "@/lib/loans";
import { parseMoneyInput, toMoneyInput } from "@/lib/money-input";
import { LoanChart, LoanChartLegend, type LoanSeries } from "./loan-chart";
import { seriesHints } from "./loan-progress";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function PayoffMonthPicker({
  value,
  min,
  onChange,
  label,
}: {
  value: BudgetMonth | null;
  min: BudgetMonth;
  onChange: (month: BudgetMonth) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number((value ?? min).slice(0, 4)));
  const minYear = Number(min.slice(0, 4));
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setYear(Number((value ?? min).slice(0, 4)));
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between font-normal"
          aria-label={value ? `${label}, ${shortMonth(value)} selected` : label}
        >
          {value ? shortMonth(value) : ""}
          <ChevronDown className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="start">
        <div className="mb-2 flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous year"
            disabled={year <= minYear}
            onClick={() => setYear(year - 1)}
          >
            <ChevronLeft />
          </Button>
          <span className="font-semibold">{year}</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next year"
            onClick={() => setYear(year + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {MONTHS.map((name, i) => {
            const month = `${year}-${String(i + 1).padStart(2, "0")}`;
            return (
              <Button
                key={name}
                size="sm"
                variant={month === value ? "default" : "ghost"}
                disabled={month < min}
                onClick={() => {
                  onChange(month);
                  setOpen(false);
                }}
              >
                {name}
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Copies `text` and opens the plan with the paired category's Assigned being edited. */
export function useCopyToPlan(categoryId: string | null) {
  const { budget } = useBudget();
  const navigate = useNavigate();
  if (!categoryId) return undefined;
  return async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard access can be refused; the plan still opens on the category.
    }
    await navigate({
      to: "/budgets/$budgetId",
      params: { budgetId: budget.id },
      search: { category: categoryId, assign: true },
    });
  };
}

function Summary({
  tone,
  title,
  left,
  right,
}: {
  tone: "neutral" | "extra" | "less";
  title: string;
  left: [string, string];
  right: [string, string];
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border text-center",
        tone === "neutral" && "bg-muted/60",
        tone === "extra" && "border-primary/50 bg-primary/10",
        tone === "less" && "border-amber-500/50 bg-amber-500/10",
      )}
    >
      <p className="border-b px-3 py-2 font-semibold text-sm">{title}</p>
      <div className="grid grid-cols-2 divide-x">
        {[left, right].map(([value, label]) => (
          <div key={label} className="px-3 py-3">
            <p className="font-semibold tabular-nums">{value}</p>
            <p className="text-sm">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Nothing here is saved; "Copy and go to my plan" copies an amount and opens the plan. */
export function PayoffSimulator({
  open,
  onOpenChange,
  plan,
  pairedCategoryId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: LoanPlan;
  pairedCategoryId: string | null;
}) {
  const { budget, formatAmount } = useBudget();
  const format = (m: bigint) => formatAmount({ amount: m, currency: budget.currency });
  const toInput = (m: bigint) => toMoneyInput(m, budget);
  const copyToPlan = useCopyToPlan(pairedCategoryId);
  const { progress, current, rate, exponent } = plan;
  const escrow = (plan.minimumShown ?? 0n) - (plan.minimum ?? 0n);
  const base = plan.targetShown ?? plan.minimumShown ?? 0n;
  const [paymentText, setPaymentText] = useState(() => toInput(base));
  const [extraText, setExtraText] = useState("");
  const [pickedMonth, setPickedMonth] = useState<BudgetMonth | null>(null);

  const parse = (text: string) => {
    if (text.trim() === "") return 0n;
    const parsed = parseMoneyInput(text, budget);
    return typeof parsed === "string" ? null : parsed;
  };
  const extra = parse(extraText) ?? 0n;
  const typed = pickedMonth === current ? null : parse(paymentText);
  const paidThisMonth = progress.paidThisMonth;
  const simulate = (shown: bigint | null, withExtra: bigint) => {
    const payment = effectivePayment(shown, escrow);
    return payment === null
      ? null
      : plannedPayoff({
          owed: progress.owed,
          rate,
          payment,
          exponent,
          month: current,
          extra: withExtra,
          paidThisMonth,
        });
  };
  const sim = simulate(typed, extra);
  const baseline = simulate(base, 0n);
  const minimum = simulate(plan.minimumShown, 0n);
  const changed = typed !== base || extra > 0n || pickedMonth !== null;
  const payoffMonth = pickedMonth ?? sim?.payoffMonth ?? null;

  /** Closes the simulator first: opened from the plan's inspector, it would stay open over it. */
  const goToPlan = (text: string) => {
    onOpenChange(false);
    void copyToPlan?.(text);
  };
  const pickMonth = (month: BudgetMonth) => {
    setPickedMonth(month);
    const months = monthsBetween(current, month);
    const owedAfter = sim?.owedAfterThisMonth ?? progress.owed;
    const payment = paymentForMonths({ owed: owedAfter, rate, months });
    if (payment !== null) {
      setPaymentText(toInput(payment + escrow));
      setPickedMonth(null);
    }
  };
  const reset = () => {
    setPaymentText(toInput(base));
    setExtraText("");
    setPickedMonth(null);
  };

  const minShown = plan.minimumShown;
  const interestFloor = minimumToPayDown(progress.owed, rate, exponent);
  let paymentHint: ReactNode = null;
  if (pickedMonth === current) {
    paymentHint = "We can't estimate a monthly payment for this Payoff date.";
  } else if (typed !== null) {
    if (!sim) paymentHint = `${format(typed)} is less than your estimated monthly interest.`;
    else if (plan.targetShown !== null && typed === plan.targetShown)
      paymentHint = `${format(typed)} is your current monthly target.`;
    else if (minShown !== null && typed === minShown)
      paymentHint = `${format(typed)} is your minimum monthly payment.`;
    else if (minShown !== null && typed < minShown)
      paymentHint = `${format(typed)} is less than your minimum monthly payment.`;
    else if (copyToPlan) paymentHint = <CopyLink onClick={() => goToPlan(toInput(typed))} />;
  }
  const dateHint =
    pickedMonth === current
      ? "Payoff date is too far in the future."
      : !sim
        ? "We can't estimate a payoff date for this payment amount."
        : baseline && sim.payoffMonth === baseline.payoffMonth && !changed
          ? `You have ${baseline.months} payments remaining on your loan.`
          : baseline
            ? `Your original payoff date is ${shortMonth(baseline.payoffMonth)}`
            : null;

  // The summary box compares with paying the minimum.
  let summary: ReactNode = null;
  if (sim && minimum && typed !== null && minShown !== null) {
    const diff = typed - minShown;
    if (diff === 0n && extra === 0n) {
      summary = (
        <Summary
          tone="neutral"
          title="Paying the minimum every month"
          left={[format(sim.interest), "Interest Remaining"]}
          right={[formatDuration(sim.months), "Time Remaining"]}
        />
      );
    } else if (diff >= 0n) {
      summary = (
        <Summary
          tone="extra"
          title={
            diff > 0n
              ? `Paying +${format(diff)} extra every month`
              : `Paying +${format(extra)} extra this month`
          }
          left={[format(minimum.interest - sim.interest), "Interest Savings"]}
          right={[formatDuration(Math.max(0, minimum.months - sim.months)), "Time Savings"]}
        />
      );
    } else {
      summary = (
        <>
          <Summary
            tone="less"
            title={`Paying -${format(-diff)} less than minimum every month`}
            left={[format(sim.interest - minimum.interest), "Additional Interest"]}
            right={[formatDuration(Math.max(0, sim.months - minimum.months)), "Additional Time"]}
          />
          <p className="flex items-start gap-2 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
            Your lender may also charge fees, which would further increase your time and interest
            costs.
          </p>
        </>
      );
    }
  }

  // The simulation begins at the start of this month, where Past Balance's month does.
  const simTrack: Track | null =
    sim && changed && typed !== null
      ? {
          from: current,
          balances: [
            trackAt(plan.tracks.past, current) ?? progress.owed,
            sim.owedAfterThisMonth,
            ...(payoffSchedule({
              owed: sim.owedAfterThisMonth,
              rate,
              payment: effectivePayment(typed, escrow) ?? 0n,
              exponent,
            }) ?? []),
          ],
        }
      : null;
  const tracks: Partial<Record<LoanSeries, Track | null>> = {
    past: plan.tracks.past.balances.length > 1 ? plan.tracks.past : null,
    minimum: plan.tracks.minimum,
    current: plan.tracks.current,
    simulation: simTrack,
  };
  const series = (Object.keys(tracks) as LoanSeries[]).filter((k) => tracks[k]);
  const less = typed !== null && minShown !== null && typed < minShown;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[95vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Loan Payoff Simulator</DialogTitle>
        </DialogHeader>
        <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
          <div className="grid content-start gap-5">
            <div className="border-b pb-3 text-center">
              <p className="font-semibold tabular-nums">
                {minShown !== null ? format(minShown) : "--"}
              </p>
              <p className="text-muted-foreground text-xs">Required Minimum Payment</p>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="sim-payment" className="font-semibold text-sm">
                Monthly Payment
              </label>
              <Input
                id="sim-payment"
                inputMode="decimal"
                value={pickedMonth === current ? "" : paymentText}
                onChange={(e) => {
                  setPaymentText(e.target.value);
                  setPickedMonth(null);
                }}
                onBlur={() => {
                  const value = parse(paymentText);
                  if (value !== null) setPaymentText(toInput(value));
                }}
              />
              {paymentHint && <div className="text-muted-foreground text-xs">{paymentHint}</div>}
            </div>
            <div className="grid gap-1.5">
              <span className="font-semibold text-sm">Payoff Date</span>
              <PayoffMonthPicker
                label="Payoff Date"
                value={payoffMonth}
                min={current}
                onChange={pickMonth}
              />
              {dateHint && <p className="text-muted-foreground text-xs">{dateHint}</p>}
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="sim-extra" className="font-semibold text-sm">
                One time extra in {MONTHS[Number(current.slice(5)) - 1]}
              </label>
              <Input
                id="sim-extra"
                inputMode="decimal"
                value={extraText}
                onChange={(e) => setExtraText(e.target.value)}
                onBlur={() => {
                  const value = parse(extraText);
                  if (value) setExtraText(toInput(value));
                }}
              />
              <div className="text-muted-foreground text-xs">
                {extra > 0n && copyToPlan ? (
                  <CopyLink onClick={() => goToPlan(toInput(extra))} />
                ) : (
                  "Extra one-off payments can have a large impact on your loan."
                )}
              </div>
            </div>
            {changed && (
              <Button variant="link" className="justify-start px-0" onClick={reset}>
                <X /> Reset all changes
              </Button>
            )}
          </div>
          <div className="grid min-w-0 content-start gap-4">
            <LoanChart tracks={tracks} exponent={exponent} warning={less} className="h-56" />
            <LoanChartLegend series={series} warning={less} hints={seriesHints(plan)} />
            {!sim && typed !== null && rate !== null && (
              <p className="rounded-md bg-amber-500/15 px-4 py-3 text-center text-sm">
                The {formatRate(rate)}% interest rate on your loan will increase your debt by{" "}
                {format(interestFloor)} per month. Paying less than this amount means your loan will
                never be fully paid.
              </p>
            )}
            {summary}
            <dl className="grid gap-2 text-sm tabular-nums">
              <div className="flex justify-between border-b pb-2 font-semibold">
                <dt>Remaining to Pay</dt>
                <dd>{sim ? format(progress.owed + sim.interest) : "--"}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Principal</dt>
                <dd>{sim ? format(progress.owed) : "--"}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Interest</dt>
                <dd>{sim ? format(sim.interest) : "--"}</dd>
              </div>
            </dl>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-primary-text hover:underline"
    >
      <Copy className="size-3" aria-hidden /> Copy and go to my plan
    </button>
  );
}
