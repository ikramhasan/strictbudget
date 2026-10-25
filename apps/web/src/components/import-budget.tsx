import type { components } from "@strictbudget/api-client";
import { Button } from "@strictbudget/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@strictbudget/ui/components/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArchiveRestore, ChevronDown, FileSpreadsheet, Import, KeyRound } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api";
import { apiErrorMessage, invalidateBudgets } from "@/lib/budgets";
import { ExternalApiImportDialog, ExternalFilesImportDialog } from "./external-import";

type Backup = components["schemas"]["BudgetBackup"];

export function ImportBudgetMenu() {
  const [dialog, setDialog] = useState<"external" | "files" | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function restore(chosen: File) {
    setPending(true);
    try {
      let backup: Backup;
      try {
        backup = JSON.parse(await chosen.text()) as Backup;
      } catch {
        toast.error("That file isn't a strictbudget backup.");
        return;
      }
      const { data, error } = await apiClient.POST("/v1/budgets/import", {
        params: { query: {} },
        body: backup,
      });
      if (error || !data) throw error;
      await invalidateBudgets(queryClient);
      toast.success(`Restored "${data.budget.name}".`);
      await navigate({ to: "/budgets/$budgetId", params: { budgetId: data.budget.id } });
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't restore the backup."));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={pending}>
            <Import /> {pending ? "Importing…" : "Import"} <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onSelect={() => setDialog("external")}>
            <KeyRound /> From YNAB…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("files")}>
            <FileSpreadsheet /> From YNAB's exported files…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => file.current?.click()}>
            <ArchiveRestore /> Restore a strictbudget backup…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ExternalApiImportDialog
        open={dialog === "external"}
        onOpenChange={(open) => setDialog(open ? "external" : null)}
      />
      <ExternalFilesImportDialog
        open={dialog === "files"}
        onOpenChange={(open) => setDialog(open ? "files" : null)}
      />
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-label="Backup file"
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          e.target.value = "";
          if (chosen) void restore(chosen);
        }}
      />
    </>
  );
}
