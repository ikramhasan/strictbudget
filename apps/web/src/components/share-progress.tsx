import { cn } from "@strictbudget/ui/lib/utils";
import { type LoanPlan, paidOffPercent } from "@/lib/loan-planner";
import { LoanChart, LoanChartLegend } from "./loan-chart";
import { planSeries, useWholeFormat } from "./loan-progress";
import { ShareImageDialog } from "./share-image-dialog";

const TAGLINE = "Never worrying about this debt again.";

export function ShareProgressDialog({
  open,
  onOpenChange,
  plan,
  loanName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: LoanPlan;
  loanName: string;
}) {
  const whole = useWholeFormat();
  const { progress } = plan;
  const paid = paidOffPercent(progress.owed > 0n ? progress.owed : 0n, progress.started);
  const series = planSeries(plan);

  return (
    <ShareImageDialog
      open={open}
      onOpenChange={onOpenChange}
      tagline={TAGLINE}
      fileName={`${loanName} progress`}
    >
      {({ showAmounts, layout }) => (
        <>
          <div className={cn("grid content-start gap-1", layout === "row" && "w-44 shrink-0")}>
            <p className="text-muted-foreground text-xs">{loanName}</p>
            {showAmounts ? (
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold text-xl tabular-nums">
                  {whole(progress.owed > 0n ? progress.owed : 0n, plan.exponent)}
                </span>
                <span className="text-xs">Remaining</span>
                <span className="text-emerald-600 text-xs dark:text-emerald-400">
                  {paid}% Paid Off
                </span>
              </p>
            ) : (
              <p className="font-semibold text-xl">{paid}% Paid Off</p>
            )}
          </div>
          {/* The chart takes whatever height the card has left. */}
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <LoanChart
              tracks={plan.tracks}
              exponent={plan.exponent}
              showAmounts={showAmounts}
              paidOff={progress.paidOff}
              className="h-auto min-h-0 flex-1"
            />
            <LoanChartLegend series={series} paidOff={progress.paidOff} hints={{}} />
          </div>
        </>
      )}
    </ShareImageDialog>
  );
}
