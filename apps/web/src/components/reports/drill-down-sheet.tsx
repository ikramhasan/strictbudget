import { type CurrencyCode, money } from "@strictbudget/engine";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@strictbudget/ui/components/sheet";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Flag } from "lucide-react";
import { useBudget } from "@/lib/budget-context";
import { FLAG_CLASS } from "@/lib/flags";
import { type ReportRequest, rangeLabel, reportTransactionsOptions } from "@/lib/reports";

export interface DrillDown {
  title: string;
  request: ReportRequest;
  /** What the lines cover, when it isn't the request's months (e.g. "Oct 2, 2026"). */
  period?: string;
}

/** Rows shown at most; the total and count still cover every match. */
const LIMIT = 500;

/** The transactions behind a report mark, newest first; each opens in its account's register. */
export function DrillDownSheet({
  drill,
  onClose,
}: {
  drill: DrillDown | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={drill !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-lg">
        {drill && <DrillDownBody drill={drill} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

function DrillDownBody({ drill, onClose }: { drill: DrillDown; onClose: () => void }) {
  const { budget, formatAmount, formatDate } = useBudget();
  const navigate = useNavigate();
  const lines = useQuery(reportTransactionsOptions({ ...drill.request, limit: LIMIT }));
  const format = (amount: string, currency: CurrencyCode = budget.currency) =>
    formatAmount(money(BigInt(amount), currency));
  const open = (t: { accountId: string; transactionId: string }) => {
    onClose();
    void navigate({
      to: "/budgets/$budgetId/accounts/$accountId",
      params: { budgetId: budget.id, accountId: t.accountId },
      search: { transaction: t.transactionId },
    });
  };
  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{drill.title}</SheetTitle>
        <SheetDescription>
          {drill.period ?? rangeLabel(drill.request.range)}
          {lines.data && (
            <>
              {" · "}
              {lines.data.count} {lines.data.count === 1 ? "transaction" : "transactions"}
              {" · "}
              <span className="font-medium text-foreground tabular-nums">
                {format(lines.data.total)}
              </span>
            </>
          )}
        </SheetDescription>
      </SheetHeader>
      <div className="overflow-y-auto">
        {lines.isPending ? (
          <Skeleton className="m-4 h-24" />
        ) : lines.isError ? (
          <p className="p-4 text-muted-foreground text-sm">Couldn't load the transactions.</p>
        ) : lines.data.transactions.length === 0 ? (
          <p className="p-4 text-muted-foreground text-sm">No transactions.</p>
        ) : (
          <ul className="divide-y">
            {lines.data.transactions.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => open(t)}
                  className="grid w-full grid-cols-[1fr_auto] gap-x-3 px-4 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <span className="flex min-w-0 items-center gap-1 font-medium">
                    {t.flag && (
                      <Flag
                        aria-label={`${t.flag} flag`}
                        className={`size-3.5 shrink-0 fill-current ${FLAG_CLASS[t.flag]}`}
                      />
                    )}
                    <span className="truncate">{t.payeeName ?? "No payee"}</span>
                  </span>
                  <span className="text-right font-medium tabular-nums">{format(t.amount)}</span>
                  <span className="truncate text-muted-foreground text-xs">
                    {formatDate(t.date)} · {t.accountName}
                    {t.categoryName &&
                      ` · ${t.groupName ? `${t.groupName}: ` : ""}${t.categoryName}`}
                    {t.memo && ` · ${t.memo}`}
                  </span>
                  {t.currency !== budget.currency && (
                    <span className="text-right text-muted-foreground text-xs tabular-nums">
                      {format(t.nativeAmount, t.currency)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {lines.data && lines.data.count > lines.data.transactions.length && (
          <p className="p-4 text-muted-foreground text-xs">
            Showing the first {lines.data.transactions.length} of {lines.data.count}.
          </p>
        )}
      </div>
    </>
  );
}
