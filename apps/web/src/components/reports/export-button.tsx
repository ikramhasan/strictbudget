import { Button } from "@strictbudget/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import { FileDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { downloadExport, type ExportFile } from "@/lib/reports";

/** Asks for confirmation, then downloads CSV or TSV; several files are zipped together. */
export function ExportButton({
  files,
  zipName,
  disabled,
}: {
  /** Builds the files when the user confirms (may fetch the transactions first). */
  files: () => Promise<ExportFile[]> | ExportFile[];
  zipName: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      downloadExport(await files(), zipName);
      setOpen(false);
    } catch {
      toast.error("Couldn't export the report.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="ghost" disabled={disabled} onClick={() => setOpen(true)}>
        <FileDown />
        Export
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Export Report</DialogTitle>
            <DialogDescription>
              Your data is just that—yours! All the requested data will be exported in CSV format so
              it's easy to open in other applications.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={run}>
              Export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
