import { NUMBER_FORMAT_SPECS, paidOffSavings } from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import { cn } from "@strictbudget/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import confetti from "canvas-confetti";
import {
  ChevronDown,
  ChevronRight,
  Gamepad2,
  Image,
  LineChart,
  PartyPopper,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api";
import { useBudget } from "@/lib/budget-context";
import { apiErrorMessage } from "@/lib/budgets";
import { transactionsQueryPrefix } from "@/lib/transactions";

type LoanBannerState = LoanActivity["banners"];

import {
  type LoanPlan,
  type MessagePart,
  type ProgressMessage,
  progressMessage,
  remainingPercent,
  trackAt,
} from "@/lib/loan-planner";
import { type LoanActivity, longMonth } from "@/lib/loans";
import { LoanChart, LoanChartLegend, type LoanSeries, SERIES_HINTS } from "./loan-chart";

/** Rounds to whole major units, half up, and drops the decimals ("$9,745", "9.745 €"). */
export function useWholeFormat() {
  const { budget, formatAmount } = useBudget();
  const spec = NUMBER_FORMAT_SPECS[budget.numberFormat];
  return (minorUnits: bigint, exponent: number) => {
    const unit = 10n ** BigInt(exponent);
    const half = unit / 2n;
    const whole = ((minorUnits + (minorUnits < 0n ? -half : half)) / unit) * unit;
    return formatAmount({ amount: whole, currency: budget.currency }).replace(
      new RegExp(`\\${spec.decimal}\\d+`),
      "",
    );
  };
}

type BannerName = "simulator" | "paidOff";

/**
 * Hidden at once, then saved on the budget; every loan's data is refetched, as the simulator
 * dismissal covers them all.
 */
function useDismissed(budgetId: string, accountId: string, saved: LoanBannerState | undefined) {
  const queryClient = useQueryClient();
  const [local, setLocal] = useState<ReadonlySet<BannerName>>(() => new Set());
  const dismissed = (banner: BannerName) =>
    local.has(banner) ||
    (banner === "simulator" ? saved?.simulatorDismissed : saved?.paidOffDismissed) === true;
  const dismiss = async (banner: BannerName) => {
    setLocal((prev) => new Set(prev).add(banner));
    const { error } = await apiClient.POST(
      "/v1/budgets/{budgetId}/accounts/{accountId}/loan/banners/dismiss",
      { params: { path: { budgetId, accountId } }, body: { banner } },
    );
    if (error) {
      toast.error(apiErrorMessage(error, "Couldn't dismiss the banner."));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: transactionsQueryPrefix });
  };
  return { dismissed, dismiss };
}

function Banner({
  icon,
  title,
  text,
  action,
  onAction,
  onDismiss,
  tone,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action: string;
  onAction: () => void;
  onDismiss: () => void;
  tone: "primary" | "success";
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "relative grid gap-3 rounded-lg border px-4 py-3 sm:flex sm:items-center sm:gap-4 sm:pr-14",
        tone === "primary"
          ? "border-primary/40 bg-primary/10"
          : "border-emerald-500/40 bg-emerald-500/15",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 pr-8 sm:gap-4 sm:pr-0">
        <span className="shrink-0 text-primary-text [&_svg]:size-6 sm:[&_svg]:size-8" aria-hidden>
          {icon}
        </span>
        <div className="grid min-w-0 gap-0.5">
          <p className="font-semibold">{title}</p>
          <p className="text-sm">{text}</p>
        </div>
      </div>
      <Button size="sm" className="w-full sm:w-auto" onClick={onAction}>
        {action}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Dismiss"
        className="absolute top-2 right-2 sm:top-1/2 sm:-translate-y-1/2"
        onClick={onDismiss}
      >
        <X />
      </Button>
    </section>
  );
}

/**
 * Dismissing the simulator banner hides it on every loan; the paid-off one goes per loan. Both
 * stay dismissed for everyone on the budget.
 */
export function LoanBanners({
  budgetId,
  accountId,
  banners,
  paidOff,
  onSimulate,
}: {
  budgetId: string;
  accountId: string;
  /** What's been dismissed on the plan; undefined while loading (nothing shows). */
  banners: LoanBannerState | undefined;
  paidOff: boolean;
  onSimulate?: () => void;
}) {
  const { dismissed, dismiss } = useDismissed(budgetId, accountId, banners);
  if (!banners) return null;
  const promoHidden = dismissed("simulator");
  const cheerHidden = dismissed("paidOff");
  const hidePromo = () => void dismiss("simulator");
  const hideCheer = () => void dismiss("paidOff");
  return (
    <>
      {!promoHidden && onSimulate && (
        <Banner
          tone="primary"
          icon={<Gamepad2 className="size-8" />}
          title="Make a plan to crush your debts with the loan payoff simulator"
          text="Find out how to save money and achieve your goals faster."
          action="Try It Now"
          onAction={onSimulate}
          onDismiss={hidePromo}
        />
      )}
      {paidOff && !cheerHidden && (
        <Banner
          tone="success"
          icon={<PartyPopper className="size-8" />}
          title="Another debt bites the dust."
          text="This calls for confetti. We're loading the cannon."
          action="Let's Celebrate"
          onAction={() => void confetti({ particleCount: 160, spread: 80, origin: { y: 0.4 } })}
          onDismiss={hideCheer}
        />
      )}
    </>
  );
}

export function MessageLine({ parts }: { parts: MessagePart[] }) {
  return (
    <p>
      {parts.map((part, i) =>
        typeof part === "string" ? (
          <span key={i}>{part}</span>
        ) : (
          <strong key={i} className="rounded bg-primary/15 px-1 font-semibold">
            {part.strong}
          </strong>
        ),
      )}
    </p>
  );
}

export function MessageBox({
  message,
  onIncreaseTarget,
  onIncreaseMinimum,
}: {
  message: ProgressMessage;
  onIncreaseTarget?: () => void;
  onIncreaseMinimum?: () => void;
}) {
  const [first, ...rest] = message.lines;
  return (
    <div
      className={cn(
        "grid justify-items-center gap-2 rounded-md px-4 py-3 text-center text-sm",
        message.tone === "warning" && "bg-amber-500/15",
        message.tone === "success" && "bg-emerald-500/15",
        message.tone === "info" && "bg-primary/10",
      )}
    >
      {first && <MessageLine parts={first} />}
      {message.increaseTarget && onIncreaseTarget && (
        <Button size="sm" variant="secondary" onClick={onIncreaseTarget}>
          Increase your target
        </Button>
      )}
      {message.increaseMinimum && onIncreaseMinimum && (
        <Button size="sm" variant="secondary" onClick={onIncreaseMinimum}>
          Increase your minimum monthly payment
        </Button>
      )}
      {rest.map((parts, i) => (
        <MessageLine key={i} parts={parts} />
      ))}
    </div>
  );
}

export function planSeries(plan: LoanPlan): LoanSeries[] {
  const { tracks } = plan;
  const series: LoanSeries[] = [];
  if (tracks.past.balances.length > 1 || plan.progress.paidOff) series.push("past");
  if (tracks.original) series.push("original");
  if (tracks.minimum) series.push("minimum");
  if (tracks.current) series.push("current");
  return series;
}

export function seriesHints(plan: LoanPlan) {
  return {
    ...SERIES_HINTS,
    current:
      plan.target !== null
        ? "Estimated future balance if you pay your paired category’s target amount every payment period."
        : SERIES_HINTS.minimum,
  };
}

export function LoanProgressCard({
  plan,
  onShare,
  onSimulate,
  onIncreaseTarget,
  onIncreaseMinimum,
  onBaseOriginal,
}: {
  plan: LoanPlan;
  /** Undefined for a closed loan: it can't be shared. */
  onShare?: () => void;
  onSimulate?: () => void;
  onIncreaseTarget?: () => void;
  onIncreaseMinimum?: () => void;
  /** "Base the Original Payment Schedule on this Past Balance". */
  onBaseOriginal?: (month: string) => void;
}) {
  const { budget, formatAmount } = useBudget();
  const whole = useWholeFormat();
  const [open, setOpen] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const { progress } = plan;
  const format = (m: bigint) => formatAmount({ amount: m, currency: budget.currency });
  const savings = paidOffSavings(progress, plan.current);
  const message = progressMessage(plan, format, savings);
  const series = planSeries(plan);
  const warning = message?.tone === "warning";
  const Toggle = open ? ChevronDown : ChevronRight;
  return (
    <section className="overflow-hidden rounded-lg border" aria-label="Your Loan's Progress">
      <button
        type="button"
        className="flex w-full items-center justify-between border-b px-4 py-3 text-left font-semibold text-sm"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Your Loan's Progress
        <Toggle className="size-4" aria-hidden />
      </button>
      {open && (
        <div className="grid gap-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-muted-foreground text-sm">Balance Remaining</p>
              <p className="text-2xl tabular-nums">
                <span className="font-semibold">{whole(progress.owed, plan.exponent)}</span>{" "}
                <span className="text-lg">
                  ({remainingPercent(progress.owed > 0n ? progress.owed : 0n, progress.started)}%)
                </span>
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {onShare && (
                <Button variant="ghost" size="sm" onClick={onShare}>
                  <Image /> Share Your Progress
                </Button>
              )}
              {!progress.paidOff && onSimulate && (
                <Button variant="ghost" size="sm" onClick={onSimulate}>
                  <LineChart /> Open Payoff Simulator
                </Button>
              )}
            </div>
          </div>
          <LoanChartLegend
            series={series}
            paidOff={progress.paidOff}
            warning={warning}
            hints={seriesHints(plan)}
          />
          <div className="relative">
            <LoanChart
              tracks={plan.tracks}
              exponent={plan.exponent}
              paidOff={progress.paidOff}
              warning={warning}
              onPickPast={onBaseOriginal ? setPicked : undefined}
            />
            {picked && onBaseOriginal && (
              <PastBalancePopover
                plan={plan}
                month={picked}
                format={format}
                onClose={() => setPicked(null)}
                onBase={() => {
                  onBaseOriginal(picked);
                  setPicked(null);
                }}
              />
            )}
          </div>
          {message && (
            <MessageBox
              message={message}
              onIncreaseTarget={onIncreaseTarget}
              onIncreaseMinimum={onIncreaseMinimum}
            />
          )}
        </div>
      )}
    </section>
  );
}

function PastBalancePopover({
  plan,
  month,
  format,
  onClose,
  onBase,
}: {
  plan: LoanPlan;
  month: string;
  format: (minorUnits: bigint) => string;
  onClose: () => void;
  onBase: () => void;
}) {
  const past = trackAt(plan.tracks.past, month);
  const original = trackAt(plan.tracks.original, month);
  return (
    <div
      role="dialog"
      aria-label={longMonth(month)}
      className="absolute top-2 left-16 z-10 grid w-80 gap-2 rounded-md border bg-popover p-3 text-popover-foreground text-sm shadow-md"
    >
      <div className="flex items-center justify-between border-b pb-2">
        <span className="font-semibold">{longMonth(month)}</span>
        <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>
      {original !== undefined && (
        <p className="flex justify-between gap-4">
          <span>Original Payment Schedule</span>
          <span className="tabular-nums">{format(original)}</span>
        </p>
      )}
      {past !== undefined && (
        <p className="flex justify-between gap-4">
          <span>Past Balance</span>
          <span className="tabular-nums">{format(past)}</span>
        </p>
      )}
      <button
        type="button"
        className="text-left text-primary-text hover:underline"
        onClick={onBase}
      >
        Base the Original Payment Schedule on this Past Balance
      </button>
    </div>
  );
}
