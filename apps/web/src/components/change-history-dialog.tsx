import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { format as formatDay } from "date-fns";
import { $api } from "@/lib/api";
import { useBudget } from "@/lib/budget-context";
import { ActivityList } from "./activity-list";

export function ChangeHistoryDialog({
  transactionId,
  onOpenChange,
}: {
  /** Null keeps the dialog closed. */
  transactionId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { budget, formatDate } = useBudget();
  const history = $api.useQuery(
    "get",
    "/v1/budgets/{budgetId}/transactions/{transactionId}/history",
    { params: { path: { budgetId: budget.id, transactionId: transactionId ?? "" } } },
    { enabled: transactionId !== null },
  );
  const events = history.data?.events ?? [];
  return (
    <Dialog open={transactionId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>History</DialogTitle>
          <DialogDescription>
            Who entered this transaction and every change since.
          </DialogDescription>
        </DialogHeader>
        {history.isPending ? (
          <Spinner className="mx-auto" />
        ) : (
          <ActivityList
            events={events}
            dateOf={(at) => formatDate(formatDay(new Date(at), "yyyy-MM-dd"))}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
