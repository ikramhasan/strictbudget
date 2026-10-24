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
import { Button, buttonVariants } from "@strictbudget/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { cn } from "@strictbudget/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, FileText, ImageOff, ImagePlus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { apiBaseUrl, apiClient } from "@/lib/api";
import { apiErrorMessage } from "@/lib/budgets";
import { type Transaction, transactionsQueryPrefix } from "@/lib/transactions";

type Attachment = NonNullable<Transaction["attachment"]>;

/** The API's limit. */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
/** Common photo types, HEIC from phones, and PDFs. */
export const ATTACHMENT_ACCEPT =
  "image/jpeg,image/png,image/webp,image/avif,image/gif,image/svg+xml,image/heic,image/heif,.heic,.heif,application/pdf";

const isPdf = (a: Attachment) => a.contentType === "application/pdf";

/** The file's address; the attachment's id keeps a replaced file out of the browser's cache. */
export function attachmentUrl(budgetId: string, t: Transaction, download = false): string {
  const params = new URLSearchParams({ v: t.attachment?.id ?? "" });
  if (download) params.set("download", "true");
  return `${apiBaseUrl}/v1/budgets/${budgetId}/transactions/${t.id}/attachment?${params}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function useAttachment(budgetId: string, t: Transaction) {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: transactionsQueryPrefix }),
      queryClient.invalidateQueries({
        queryKey: ["get", "/v1/budgets/{budgetId}/transactions/{transactionId}/history"],
      }),
    ]);
  const params = { path: { budgetId, transactionId: t.id } };

  async function upload(file: File) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error("That file is too big: attachments can be at most 15 MB.");
      return;
    }
    setUploading(true);
    try {
      const { error } = await apiClient.POST(
        "/v1/budgets/{budgetId}/transactions/{transactionId}/attachment",
        {
          params,
          body: { file: file as unknown as string },
          bodySerializer: () => {
            const form = new FormData();
            form.append("file", file);
            return form;
          },
        },
      );
      if (error) toast.error(apiErrorMessage(error, "Couldn't add the attachment. Try again."));
      await refresh();
    } catch {
      toast.error("Couldn't add the attachment. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  async function remove(): Promise<boolean> {
    setDeleting(true);
    try {
      const { error } = await apiClient.DELETE(
        "/v1/budgets/{budgetId}/transactions/{transactionId}/attachment",
        { params },
      );
      if (error) toast.error(apiErrorMessage(error, "Couldn't delete the attachment. Try again."));
      await refresh();
      return !error;
    } finally {
      setDeleting(false);
    }
  }

  return { upload, remove, uploading, deleting };
}

function useFilePicker(onPick: (file: File) => void) {
  const input = useRef<HTMLInputElement>(null);
  const element = (
    <input
      ref={input}
      type="file"
      accept={ATTACHMENT_ACCEPT}
      className="hidden"
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        // The same file can be picked again after a failed upload.
        e.target.value = "";
        if (file) onPick(file);
      }}
    />
  );
  return { element, open: () => input.current?.click() };
}

function Thumbnail({
  budgetId,
  transaction,
  className,
}: {
  budgetId: string;
  transaction: Transaction;
  className?: string;
}) {
  const attachment = transaction.attachment;
  // A photo this browser can't decode (HEIC outside Safari) shows as a file instead.
  const [brokenId, setBrokenId] = useState<string | null>(null);
  if (!attachment) return null;
  const broken = brokenId === attachment.id;
  if (isPdf(attachment) || broken) {
    const Icon = isPdf(attachment) ? FileText : ImageOff;
    return (
      <span
        className={cn(
          "flex items-center justify-center rounded-sm bg-muted text-muted-foreground",
          className,
        )}
      >
        <Icon className="size-4" />
      </span>
    );
  }
  return (
    <img
      src={attachmentUrl(budgetId, transaction)}
      alt=""
      loading="lazy"
      decoding="async"
      className={cn("rounded-sm bg-muted object-cover", className)}
      onError={() => setBrokenId(attachment.id)}
    />
  );
}

/** A PDF opens in a new tab instead (the browser's own viewer). */
function AttachmentViewer({
  budgetId,
  transaction,
  readOnly,
  open,
  onOpenChange,
  onDelete,
  deleting,
}: {
  budgetId: string;
  transaction: Transaction;
  readOnly: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => Promise<boolean>;
  deleting: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [brokenId, setBrokenId] = useState<string | null>(null);
  const attachment = transaction.attachment;
  if (!attachment) return null;
  const broken = brokenId === attachment.id;
  const url = attachmentUrl(budgetId, transaction);
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[calc(100svh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl">
          <div className="grid gap-0.5 pr-8">
            <DialogTitle className="truncate">{attachment.fileName}</DialogTitle>
            <DialogDescription>
              {[transaction.payeeName, formatSize(attachment.byteSize)].filter(Boolean).join(" · ")}
            </DialogDescription>
          </div>
          {isPdf(attachment) ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-10 text-muted-foreground">
              <FileText className="size-10" />
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: "outline" })}
              >
                <ExternalLink /> Open PDF
              </a>
            </div>
          ) : broken ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center text-muted-foreground text-sm">
              <ImageOff className="size-10" />
              <p>This browser can't show this photo. Download it to open it.</p>
            </div>
          ) : (
            <img
              src={url}
              alt={attachment.fileName}
              className="mx-auto max-h-[70svh] w-auto max-w-full rounded-md object-contain"
              onError={() => setBrokenId(attachment.id)}
            />
          )}
          <DialogFooter className="flex-row flex-wrap justify-end gap-2">
            {!readOnly && (
              <Button
                variant="ghost"
                className="mr-auto text-destructive"
                disabled={deleting}
                onClick={() => setConfirming(true)}
              >
                <Trash2 /> Delete
              </Button>
            )}
            <a
              href={attachmentUrl(budgetId, transaction, true)}
              className={buttonVariants({ variant: "outline" })}
            >
              <Download /> Download
            </a>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Attachment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this attachment?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                void onDelete().then((done) => {
                  if (done) onOpenChange(false);
                });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Scheduled transactions can't have an attachment (`disabled`). */
export function AttachmentCell({
  budgetId,
  transaction,
  readOnly = false,
}: {
  budgetId: string;
  transaction: Transaction;
  readOnly?: boolean;
}) {
  const { upload, remove, uploading, deleting } = useAttachment(budgetId, transaction);
  const picker = useFilePicker((file) => void upload(file));
  const [viewing, setViewing] = useState(false);
  const label = transaction.payeeName ?? "transaction";
  if (uploading) {
    return (
      <span className="flex justify-center" role="status" aria-label="Uploading">
        <Spinner className="size-4" />
      </span>
    );
  }
  if (transaction.attachment) {
    return (
      <>
        <button
          type="button"
          className="mx-auto flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Open the attachment of ${label}`}
          onClick={(e) => {
            // Not a click on the row (which would select or edit it).
            e.stopPropagation();
            setViewing(true);
          }}
        >
          <Thumbnail budgetId={budgetId} transaction={transaction} className="h-5 w-7" />
        </button>
        <AttachmentViewer
          budgetId={budgetId}
          transaction={transaction}
          readOnly={readOnly}
          open={viewing}
          onOpenChange={setViewing}
          onDelete={remove}
          deleting={deleting}
        />
      </>
    );
  }
  if (readOnly) return null;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="mx-auto flex text-muted-foreground/60 hover:text-foreground"
        aria-label={`Add a photo or PDF to ${label}`}
        title="Add Attachment"
        onClick={(e) => {
          e.stopPropagation();
          picker.open();
        }}
      >
        <ImagePlus />
      </Button>
      {picker.element}
    </>
  );
}

/** A scheduled transaction's cell shows the button, disabled. */
export function ScheduledAttachmentCell() {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="mx-auto flex text-muted-foreground/40"
      disabled
      aria-label="Scheduled transactions can't have attachments"
      title="Scheduled transactions can't have attachments"
    >
      <ImagePlus />
    </Button>
  );
}

export function AttachmentField({
  budgetId,
  transaction,
  readOnly = false,
}: {
  budgetId: string;
  transaction: Transaction;
  readOnly?: boolean;
}) {
  const { upload, remove, uploading, deleting } = useAttachment(budgetId, transaction);
  const picker = useFilePicker((file) => void upload(file));
  const [viewing, setViewing] = useState(false);
  const attachment = transaction.attachment;
  if (!attachment) {
    if (readOnly) return null;
    return (
      <>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full"
          disabled={uploading}
          onClick={picker.open}
        >
          {uploading ? <Spinner /> : <ImagePlus />}
          {uploading ? "Uploading…" : "Add photo or PDF"}
        </Button>
        {picker.element}
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-3 rounded-lg border p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setViewing(true)}
      >
        <Thumbnail budgetId={budgetId} transaction={transaction} className="size-10 shrink-0" />
        <span className="grid min-w-0">
          <span className="truncate font-medium text-sm">{attachment.fileName}</span>
          <span className="text-muted-foreground text-xs">{formatSize(attachment.byteSize)}</span>
        </span>
      </button>
      <AttachmentViewer
        budgetId={budgetId}
        transaction={transaction}
        readOnly={readOnly}
        open={viewing}
        onOpenChange={setViewing}
        onDelete={remove}
        deleting={deleting}
      />
    </>
  );
}
