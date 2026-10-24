import type { Database } from "@strictbudget/db";
import { aiAttachment } from "@strictbudget/db/schema";
import type { ChatMiddleware, ContentPart, ModelMessage } from "@tanstack/ai";
import { and, eq, inArray } from "drizzle-orm";
import { AppError } from "../errors";
import type { ObjectStorage } from "../storage";
import { kindOf, modelParts } from "./files";

// A file in a conversation is stored once, in object storage (`ai_attachment`), and the
// conversation's transcript only points at it: an image or document part whose URL source is
// `strictbudget-attachment:<id>`. Just before each model call the pointers are swapped for the
// file's contents (`attachmentMiddleware`), as the provider's own messages, so the transcript in
// the database never holds a file's bytes.

const SCHEME = "strictbudget-attachment:";

type AttachmentRow = typeof aiAttachment.$inferSelect;
type Part = Record<string, unknown>;

/** The stored transcript's pointer to an attachment. */
export function attachmentPart(row: AttachmentRow): ContentPart {
  return {
    type: kindOf(row.contentType) === "image" ? "image" : "document",
    source: { type: "url", value: `${SCHEME}${row.id}`, mimeType: row.contentType },
    metadata: { attachmentId: row.id, fileName: row.fileName, byteSize: row.byteSize },
  };
}

const MEDIA = new Set(["image", "document", "audio", "video"]);

/** A message's parts: a UI message's `parts` or a model message's `content`. */
function partsOf(message: unknown): Part[] | null {
  if (!message || typeof message !== "object") return null;
  const m = message as { parts?: unknown; content?: unknown };
  if (Array.isArray(m.parts)) return m.parts as Part[];
  if (Array.isArray(m.content)) return m.content as Part[];
  return null;
}

/** The attachment a part points at, or null when it isn't a pointer. */
function pointedAt(part: Part): string | null {
  const source = part.source as { type?: unknown; value?: unknown } | undefined;
  if (source?.type !== "url" || typeof source.value !== "string") return null;
  return source.value.startsWith(SCHEME) ? source.value.slice(SCHEME.length) : null;
}

/**
 * The attachments a message the person sends points at. Any other file in it (inline bytes, an
 * outside URL, a provider's file handle) is refused: files are uploaded first, so the transcript
 * only ever holds pointers.
 */
export function attachmentIds(message: unknown): string[] {
  const ids: string[] = [];
  for (const part of partsOf(message) ?? []) {
    if (!MEDIA.has(String(part.type))) continue;
    const id = pointedAt(part);
    if (!id || part.type === "audio" || part.type === "video") {
      throw new AppError(
        400,
        "INVALID_ATTACHMENT",
        "Upload files to the conversation before sending them",
      );
    }
    ids.push(id);
  }
  return [...new Set(ids)];
}

/** The message with each attachment pointer rewritten from its stored row (name, type, size). */
export function withStoredAttachments<T>(message: T, rows: ReadonlyMap<string, AttachmentRow>): T {
  const rewrite = (parts: Part[]) =>
    parts.map((part) => {
      const id = MEDIA.has(String(part.type)) ? pointedAt(part) : null;
      const row = id ? rows.get(id) : undefined;
      return row ? (attachmentPart(row) as unknown as Part) : part;
    });
  const m = message as { parts?: unknown; content?: unknown };
  if (Array.isArray(m.parts)) return { ...message, parts: rewrite(m.parts as Part[]) };
  if (Array.isArray(m.content)) return { ...message, content: rewrite(m.content as Part[]) };
  return message;
}

/**
 * The attachments a new message carries, checked before anything is written: they must be the
 * caller's, in this budget, and not already in another conversation. Returns their rows.
 */
export async function usableAttachments(
  db: Database,
  scope: { budgetId: string; userId: string; conversationId: string },
  ids: readonly string[],
): Promise<Map<string, AttachmentRow>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select()
    .from(aiAttachment)
    .where(
      and(
        inArray(aiAttachment.id, [...ids]),
        eq(aiAttachment.budgetId, scope.budgetId),
        eq(aiAttachment.userId, scope.userId),
      ),
    );
  const usable = rows.filter(
    (r) => r.conversationId === null || r.conversationId === scope.conversationId,
  );
  if (usable.length !== ids.length) {
    throw new AppError(
      400,
      "ATTACHMENT_NOT_FOUND",
      "An attached file is missing. Attach it again.",
    );
  }
  return new Map(usable.map((r) => [r.id, r]));
}

/** Makes checked attachments (`usableAttachments`) the conversation's, once it exists. */
export async function claimAttachments(
  db: Database,
  conversationId: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(aiAttachment)
    .set({ conversationId })
    .where(inArray(aiAttachment.id, [...ids]));
}

/**
 * What one model call carries of the conversation's files, newest first; older files past these
 * are named instead of sent. Photos and PDFs by bytes: Claude takes 32 MB per request, and base64
 * adds a third. Text and workbooks by characters (about 100k tokens), to leave room in the
 * context window for the conversation itself.
 */
const MAX_MEDIA_BYTES_PER_CALL = 20 * 1024 * 1024;
const MAX_TEXT_CHARS_PER_CALL = 400_000;

/**
 * Swaps the transcript's attachment pointers for the files themselves in what the model is sent
 * (`providerMessages`), each model call; the transcript (`messages`) keeps the pointers. Only this
 * conversation's attachments are read. Each file is read once per request.
 */
export function attachmentMiddleware(deps: {
  db: Database;
  storage: ObjectStorage | null;
  conversationId: string;
}): ChatMiddleware {
  const loaded = new Map<
    string,
    Promise<{ parts: ContentPart[]; mediaBytes: number; textChars: number } | null>
  >();
  async function load(id: string) {
    const [row] = await deps.db
      .select()
      .from(aiAttachment)
      .where(and(eq(aiAttachment.id, id), eq(aiAttachment.conversationId, deps.conversationId)));
    const bytes = row && deps.storage ? await deps.storage.get(row.storageKey) : null;
    if (!row || !bytes) return null;
    const parts = await modelParts({
      id: row.id,
      fileName: row.fileName,
      contentType: row.contentType,
      kind: kindOf(row.contentType),
      bytes,
    });
    const media = parts.some((p) => p.type !== "text");
    return {
      parts,
      mediaBytes: media ? bytes.byteLength : 0,
      textChars: parts.reduce((n, p) => n + (p.type === "text" ? p.content.length : 0), 0),
    };
  }
  const file = (id: string) => {
    let entry = loaded.get(id);
    if (!entry) {
      entry = load(id);
      loaded.set(id, entry);
    }
    return entry;
  };

  return {
    name: "strictbudget-attachments",
    async onConfig(_ctx, config) {
      const ids = new Set(config.messages.flatMap((m) => (partsOf(m) ?? []).map(pointedAt)));
      ids.delete(null);
      if (ids.size === 0) return;
      let mediaLeft = MAX_MEDIA_BYTES_PER_CALL;
      let textLeft = MAX_TEXT_CHARS_PER_CALL;
      const resolved: ModelMessage[] = [];
      // Newest first, so a long conversation drops its oldest files, not the one just sent.
      for (const message of [...config.messages].reverse()) {
        const parts = partsOf(message);
        if (!parts || message.role !== "user") {
          resolved.unshift(message);
          continue;
        }
        const content: ContentPart[] = [];
        for (const part of parts) {
          const id = pointedAt(part);
          if (!id) {
            content.push(part as unknown as ContentPart);
            continue;
          }
          const name = (part.metadata as { fileName?: unknown } | undefined)?.fileName ?? "file";
          const found = await file(id);
          if (!found) {
            content.push({ type: "text", content: `[The file "${name}" is no longer available.]` });
          } else if (found.mediaBytes > mediaLeft || found.textChars > textLeft) {
            content.push({
              type: "text",
              content: `[The file "${name}" is left out of this request to keep it small. Ask the person to attach it again if you need it.]`,
            });
          } else {
            mediaLeft -= found.mediaBytes;
            textLeft -= found.textChars;
            content.push(...found.parts);
          }
        }
        resolved.unshift({ ...message, content });
      }
      return { providerMessages: resolved };
    },
  };
}
