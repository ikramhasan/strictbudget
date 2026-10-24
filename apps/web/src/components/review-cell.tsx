import { Button } from "@strictbudget/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@strictbudget/ui/components/popover";
import { Info, Link2 } from "lucide-react";

export interface MatchedRow {
  date: string;
  payee: string;
  memo: string;
  amount: string;
}

/**
 * Blue on an unapproved transaction (also when it needs a category); yellow on an approved one that
 * needs a category. While a matched transaction is edited, a grey link icon opens its match.
 */
export function ReviewCell({
  approved,
  needsCategory,
  pending,
  onApprove,
  onReject,
  onCategorize,
  match,
}: {
  approved: boolean;
  needsCategory: boolean;
  pending?: boolean;
  onApprove: () => void;
  onReject: () => void;
  onCategorize?: () => void;
  /** Set while a matched transaction is being edited: its two sides, entered first. */
  match?: {
    rows: readonly [MatchedRow, MatchedRow];
    onUnmatch: () => void;
    /**
     * The register keeps the icon while its popover is open: opening it ends the cell's edit,
     * which would otherwise take the icon away.
     */
    onHold?: (held: boolean) => void;
  };
}) {
  if (!approved) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="This transaction needs approval"
            title="This transaction needs approval"
          >
            <Info className="fill-blue-500 text-white dark:fill-blue-400 dark:text-background" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="grid w-56 gap-2 p-3">
          <Button type="button" size="sm" disabled={pending} onClick={onApprove}>
            Approve Transaction
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={onReject}
          >
            Reject Transaction
          </Button>
        </PopoverContent>
      </Popover>
    );
  }
  if (needsCategory) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="This transaction needs a category"
        title="This transaction needs a category"
        disabled={!onCategorize}
        onClick={onCategorize}
      >
        <Info className="fill-yellow-500 text-white dark:fill-yellow-400 dark:text-background" />
      </Button>
    );
  }
  if (match) return <MatchedTransactions {...match} pending={pending} />;
  return null;
}

function MatchedTransactions({
  rows,
  onUnmatch,
  pending,
  onHold,
}: {
  rows: readonly MatchedRow[];
  onUnmatch: () => void;
  pending?: boolean;
  onHold?: (held: boolean) => void;
}) {
  return (
    <Popover onOpenChange={(open) => !open && onHold?.(false)}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="This transaction has a matched transaction"
          title="This transaction has a matched transaction"
          // Before the edited cell loses focus and the row leaves editing (which hides this icon).
          onPointerDown={() => onHold?.(true)}
        >
          <Link2 className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-auto max-w-[calc(100vw-2rem)] gap-3 p-3">
        <p className="font-medium text-sm">Matched Transactions</p>
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr className="border-b text-muted-foreground text-xs uppercase">
                <th className="px-2 py-1 text-left font-medium">Date</th>
                <th className="px-2 py-1 text-left font-medium">Payee</th>
                <th className="px-2 py-1 text-left font-medium">Memo</th>
                <th className="px-2 py-1 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${i}-${r.date}`} className="border-b last:border-0">
                  <td className="whitespace-nowrap px-2 py-1.5">{r.date}</td>
                  <td className="max-w-48 truncate px-2 py-1.5">{r.payee}</td>
                  <td className="max-w-40 truncate px-2 py-1.5">{r.memo}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                    {r.amount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="justify-self-end"
          disabled={pending}
          onClick={onUnmatch}
        >
          Unmatch
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export function NeedsCategoryPill() {
  return (
    <span className="rounded-full bg-yellow-200 px-2 py-0.5 font-medium text-xs text-yellow-950 dark:bg-yellow-400/20 dark:text-yellow-200">
      This needs a category
    </span>
  );
}
