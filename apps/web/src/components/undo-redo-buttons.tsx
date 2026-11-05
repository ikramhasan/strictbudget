import { Button } from "@strictbudget/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@strictbudget/ui/components/tooltip";
import { Redo2, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { apiErrorMessage } from "@/lib/budgets";
import { useCommand } from "@/lib/commands";
import { useUndo, useUndoShortcuts } from "@/lib/undo";

export function UndoRedoButtons() {
  const history = useUndo();
  const report = (error: unknown) =>
    toast.error(apiErrorMessage(error, "Couldn't update the budget."));
  useUndoShortcuts(report);
  // In the command palette too, naming what they'd undo or redo.
  useCommand({
    label: `Undo ${history.undoLabel}`,
    caps: ["mod", "Z"],
    run: () => void history.undo().catch(report),
    enabled: Boolean(history.undoLabel) && !history.busy,
  });
  useCommand({
    label: `Redo ${history.redoLabel}`,
    caps: ["mod", "shift", "Z"],
    run: () => void history.redo().catch(report),
    enabled: Boolean(history.redoLabel) && !history.busy,
  });

  return (
    <div className="flex items-center gap-1">
      <HistoryButton
        label="Undo"
        tip={history.undoLabel ? `Undo ${history.undoLabel}` : "Nothing to undo"}
        disabled={!history.undoLabel || history.busy}
        onClick={() => void history.undo().catch(report)}
      >
        <Undo2 />
      </HistoryButton>
      <HistoryButton
        label="Redo"
        tip={history.redoLabel ? `Redo ${history.redoLabel}` : "Nothing to redo"}
        disabled={!history.redoLabel || history.busy}
        onClick={() => void history.redo().catch(report)}
      >
        <Redo2 />
      </HistoryButton>
    </div>
  );
}

/** An icon button naming what it would undo or redo in a tooltip (it still shows when disabled). */
function HistoryButton({
  label,
  tip,
  disabled,
  onClick,
  children,
}: {
  label: string;
  tip: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A span keeps the tooltip working while the button is disabled. */}
        <span className="inline-flex">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-description={tip}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}
