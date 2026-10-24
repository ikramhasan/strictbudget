import { Button } from "@strictbudget/ui/components/button";
import { Redo2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { apiErrorMessage } from "@/lib/budgets";
import { useUndo, useUndoShortcuts } from "@/lib/undo";

export function UndoRedoButtons() {
  const history = useUndo();
  const report = (error: unknown) =>
    toast.error(apiErrorMessage(error, "Couldn't update the budget."));
  useUndoShortcuts(report);

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Undo"
        title={history.undoLabel ? `Undo ${history.undoLabel}` : "Nothing to undo"}
        disabled={!history.undoLabel || history.busy}
        onClick={() => void history.undo().catch(report)}
      >
        <Undo2 />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Redo"
        title={history.redoLabel ? `Redo ${history.redoLabel}` : "Nothing to redo"}
        disabled={!history.redoLabel || history.busy}
        onClick={() => void history.redo().catch(report)}
      >
        <Redo2 />
      </Button>
    </div>
  );
}
