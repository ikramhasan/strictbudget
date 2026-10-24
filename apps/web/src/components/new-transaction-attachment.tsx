import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@strictbudget/ui/components/alert-dialog";
import { Button } from "@strictbudget/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { cn } from "@strictbudget/ui/lib/utils";
import { FileText, ImageOff, ImagePlus, Sparkles, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { aiReadsAttachment } from "@/lib/ai";
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENT_BYTES } from "./transaction-attachment";

/** A local address for the picked file, for its thumbnail; freed when the file changes. */
function usePreview(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file?.type.startsWith("image/")) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

/**
 * Picked before the transaction exists: kept in the browser and uploaded once the transaction is
 * saved. With AI on, picking a receipt asks at once whether to fill the row in (`onFill`).
 */
export function NewAttachmentCell({
  file,
  onFile,
  aiEnabled,
  busy,
  onFill,
  className,
}: {
  file: File | null;
  onFile: (file: File | null) => void;
  aiEnabled: boolean;
  /** The AI is reading the file, or it's being uploaded with the saved transaction. */
  busy: boolean;
  onFill: (file: File) => void;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [asking, setAsking] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [broken, setBroken] = useState(false);
  const preview = usePreview(file);
  const canFill = aiEnabled && file !== null && aiReadsAttachment(file);

  function pick(picked: File) {
    if (picked.size > MAX_ATTACHMENT_BYTES) {
      toast.error("That file is too big: attachments can be at most 15 MB.");
      return;
    }
    setBroken(false);
    onFile(picked);
    if (aiEnabled && aiReadsAttachment(picked)) setAsking(true);
  }

  const picker = (
    <input
      ref={input}
      type="file"
      accept={ATTACHMENT_ACCEPT}
      className="hidden"
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        const picked = e.target.files?.[0];
        e.target.value = "";
        if (picked) pick(picked);
      }}
    />
  );

  let cell: ReactNode;
  if (busy) {
    cell = (
      <span className="flex justify-center" role="status" aria-label="Reading the attachment">
        <Spinner className="size-4" />
      </span>
    );
  } else if (file) {
    const Icon = broken ? ImageOff : FileText;
    cell = (
      <button
        type="button"
        className="mx-auto flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Open the attachment ${file.name}`}
        onClick={() => setViewing(true)}
      >
        {preview && !broken ? (
          <img
            src={preview}
            alt=""
            className="h-5 w-7 rounded-sm bg-muted object-cover"
            onError={() => setBroken(true)}
          />
        ) : (
          <span className="flex h-5 w-7 items-center justify-center rounded-sm bg-muted text-muted-foreground">
            <Icon className="size-3.5" />
          </span>
        )}
      </button>
    );
  } else {
    cell = (
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="mx-auto flex text-muted-foreground/60 hover:text-foreground"
        aria-label="Add a photo or PDF"
        title={aiEnabled ? "Add a receipt" : "Add Attachment"}
        onClick={() => input.current?.click()}
      >
        <ImagePlus />
      </Button>
    );
  }

  return (
    // Keys pressed in the dialogs (portalled, but React bubbles them through the tree) stop here:
    // the row would take Escape as cancelling the new transaction and Enter as saving it.
    // biome-ignore lint/a11y/noStaticElementInteractions: only stops its dialogs' keys bubbling on
    <div
      className={cn("flex", className)}
      onKeyDown={(e) => {
        if (!e.currentTarget.contains(e.target as Node)) e.stopPropagation();
      }}
    >
      {picker}
      {cell}
      <Dialog open={viewing && file !== null} onOpenChange={setViewing}>
        <DialogContent className="max-h-[calc(100svh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl">
          <div className="grid gap-0.5 pr-8">
            <DialogTitle className="truncate">{file?.name}</DialogTitle>
            <DialogDescription>Added once you save the transaction.</DialogDescription>
          </div>
          {preview && !broken ? (
            <img
              src={preview}
              alt={file?.name ?? ""}
              className="mx-auto max-h-[60svh] w-auto max-w-full rounded-md object-contain"
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-muted-foreground">
              <FileText className="size-10" />
            </div>
          )}
          <DialogFooter className="flex-row flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              className="mr-auto text-destructive"
              onClick={() => {
                onFile(null);
                setViewing(false);
              }}
            >
              <Trash2 /> Delete
            </Button>
            {canFill && (
              <Button
                variant="outline"
                onClick={() => {
                  if (file) onFill(file);
                  setViewing(false);
                }}
              >
                <Sparkles /> Fill in with AI
              </Button>
            )}
            <Button onClick={() => setViewing(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent className="data-[size=default]:sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Fill in this transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              strictbudget AI can read {file?.name ?? "the file"} and fill in the date, payee,
              category, memo and amount, using your own payees and categories. Check them before
              saving: the transaction is added uncleared, for you to clear when it shows up in your
              account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Just attach it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (file) onFill(file);
              }}
            >
              <Sparkles /> Fill in with AI
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
