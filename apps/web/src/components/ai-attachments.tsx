import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@strictbudget/ui/components/attachment";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { FileSpreadsheet, FileText, ImageOff, X } from "lucide-react";
import { useRef, useState } from "react";
import {
  type AiAttachment,
  aiAttachmentUrl,
  deleteAiAttachment,
  MAX_AI_FILE_BYTES,
  uploadAiAttachment,
} from "@/lib/ai";

const MAX_FILES = 5;

const isImage = (type: string) => type.startsWith("image/");
const isSheet = (type: string) => /spreadsheet|csv|tab-separated/.test(type);

/** A file picked for the next message: uploading, ready (uploaded), or refused. */
interface PickedFile {
  key: string;
  name: string;
  /** A local preview of a photo, until it's sent. */
  preview: string | null;
  state: "uploading" | "done" | "error";
  error?: string;
  attachment?: AiAttachment;
}

/**
 * The files picked for the next message. Each uploads as soon as it's picked, so sending is
 * instant; one removed before sending is deleted from the server.
 */
export function usePickedFiles(budgetId: string) {
  const [files, setFiles] = useState<PickedFile[]>([]);
  const counter = useRef(0);
  const update = (key: string, patch: Partial<PickedFile>) =>
    setFiles((all) => all.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  function add(picked: Iterable<File>) {
    const room = MAX_FILES - files.length;
    for (const file of [...picked].slice(0, Math.max(0, room))) {
      counter.current += 1;
      const key = `file-${counter.current}`;
      const entry: PickedFile = {
        key,
        name: file.name,
        preview: isImage(file.type) ? URL.createObjectURL(file) : null,
        state: "uploading",
      };
      setFiles((all) => [...all, entry]);
      if (file.size > MAX_AI_FILE_BYTES) {
        update(key, { state: "error", error: "Bigger than 15 MB" });
        continue;
      }
      uploadAiAttachment(budgetId, file).then(
        (attachment) => update(key, { state: "done", attachment }),
        (error: Error) => update(key, { state: "error", error: error.message }),
      );
    }
  }

  function remove(key: string) {
    const file = files.find((f) => f.key === key);
    if (file?.preview) URL.revokeObjectURL(file.preview);
    if (file?.attachment) void deleteAiAttachment(budgetId, file.attachment.id);
    setFiles((all) => all.filter((f) => f.key !== key));
  }

  /** Empties the list once its files are sent (they're the conversation's now). */
  function clear() {
    for (const f of files) if (f.preview) URL.revokeObjectURL(f.preview);
    setFiles([]);
  }

  const ready = files.flatMap((f) => (f.attachment ? [f.attachment] : []));
  return {
    files,
    ready,
    add,
    remove,
    clear,
    uploading: files.some((f) => f.state === "uploading"),
    full: files.length >= MAX_FILES,
  };
}

export function PickedFiles({
  files,
  onRemove,
}: {
  files: readonly PickedFile[];
  onRemove: (key: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <AttachmentGroup className="w-full px-2 pt-1" aria-label="Attached files">
      {files.map((f) => (
        <Attachment key={f.key} size="sm" state={f.state} className="max-w-56">
          <AttachmentMedia variant={f.preview ? "image" : "icon"}>
            {f.state === "uploading" && !f.preview ? (
              <Spinner />
            ) : f.preview ? (
              <img src={f.preview} alt="" />
            ) : (
              <FileIcon type={f.attachment?.contentType ?? f.name} />
            )}
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{f.name}</AttachmentTitle>
            {/* Uploading shows as a shimmer on the name; only a refusal needs words. */}
            {f.state === "error" && (
              <AttachmentDescription role="alert">{f.error}</AttachmentDescription>
            )}
          </AttachmentContent>
          <AttachmentActions>
            <AttachmentAction aria-label={`Remove ${f.name}`} onClick={() => onRemove(f.key)}>
              <X />
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
      ))}
    </AttachmentGroup>
  );
}

function FileIcon({ type }: { type: string }) {
  return isSheet(type) || /\.(xlsx|csv|tsv)$/i.test(type) ? <FileSpreadsheet /> : <FileText />;
}

/** The pointer a sent message keeps to a file (the API's `strictbudget-attachment:` part). */
export interface SentFile {
  attachmentId: string;
  fileName: string;
  contentType: string;
}

/** A sent message's file part, read back: null for parts that aren't the app's files. */
export function sentFile(part: unknown): SentFile | null {
  if (!part || typeof part !== "object") return null;
  const p = part as {
    type?: unknown;
    source?: { value?: unknown; mimeType?: unknown };
    metadata?: { attachmentId?: unknown; fileName?: unknown };
  };
  if (p.type !== "image" && p.type !== "document") return null;
  const id = p.metadata?.attachmentId;
  if (typeof id !== "string") return null;
  return {
    attachmentId: id,
    fileName: typeof p.metadata?.fileName === "string" ? p.metadata.fileName : "File",
    contentType: typeof p.source?.mimeType === "string" ? p.source.mimeType : "",
  };
}

function kindLabel(type: string): string {
  if (type === "application/pdf") return "PDF";
  if (isSheet(type)) return "Spreadsheet";
  return "Document";
}

/**
 * A message's files, above its text: photos as thumbnails in a row, then the other files by name.
 * Each opens in a new tab.
 */
export function SentFiles({ budgetId, files }: { budgetId: string; files: readonly SentFile[] }) {
  const photos = files.filter((f) => isImage(f.contentType));
  const others = files.filter((f) => !isImage(f.contentType));
  return (
    <div className="ml-auto grid justify-items-end gap-2">
      {photos.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {photos.map((f) => (
            <SentPhoto key={f.attachmentId} budgetId={budgetId} file={f} />
          ))}
        </div>
      )}
      {others.map((f) => (
        <Attachment key={f.attachmentId} className="max-w-72">
          <AttachmentMedia>
            <FileIcon type={f.contentType} />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{f.fileName}</AttachmentTitle>
            <AttachmentDescription>{kindLabel(f.contentType)}</AttachmentDescription>
          </AttachmentContent>
          <AttachmentTrigger asChild>
            <a href={aiAttachmentUrl(budgetId, f.attachmentId)} target="_blank" rel="noreferrer">
              <span className="sr-only">Open {f.fileName}</span>
            </a>
          </AttachmentTrigger>
        </Attachment>
      ))}
    </div>
  );
}

function SentPhoto({ budgetId, file }: { budgetId: string; file: SentFile }) {
  const [broken, setBroken] = useState(false);
  const url = aiAttachmentUrl(budgetId, file.attachmentId);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={file.fileName}
      className="block size-20 overflow-hidden rounded-xl border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {broken ? (
        <span className="flex size-full items-center justify-center text-muted-foreground">
          <ImageOff className="size-5" />
          <span className="sr-only">{file.fileName}</span>
        </span>
      ) : (
        <img
          src={url}
          alt={file.fileName}
          loading="lazy"
          className="size-full object-cover"
          onError={() => setBroken(true)}
        />
      )}
    </a>
  );
}
