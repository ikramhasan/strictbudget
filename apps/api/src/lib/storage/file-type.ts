import { fileTypeFromBuffer } from "file-type";

/**
 * What a transaction attachment can be: photo types (jpg, png, webp, avif, gif, svg, and heic
 * from phones) and PDFs.
 */
export const ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/svg+xml",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

const isAttachmentType = (mime: string): mime is AttachmentType =>
  (ATTACHMENT_TYPES as readonly string[]).includes(mime);

/** An SVG document: text whose first element is `<svg` (after any XML prolog, comments or doctype). */
function isSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 4096));
  const rest = head
    .replace(/^﻿/, "")
    .replace(/^\s*<\?xml[\s\S]*?\?>/, "")
    .replace(/^(\s*(<!--[\s\S]*?-->|<!DOCTYPE[^>]*>))*/i, "")
    .trimStart();
  return /^<svg[\s>]/i.test(rest);
}

/**
 * The file's type from its contents, not from the name or the type the browser sent (which
 * anyone can set); null if it isn't one an attachment can be.
 */
export async function attachmentType(bytes: Uint8Array): Promise<AttachmentType | null> {
  // SVG is text: file-type reads it as XML at best.
  if (isSvg(bytes)) return "image/svg+xml";
  const found = await fileTypeFromBuffer(bytes);
  // HEIC photos are HEIF files; file-type names the HEVC-coded ones `image/heic`.
  const mime = found?.mime === "image/heic-sequence" ? "image/heic" : found?.mime;
  return mime && isAttachmentType(mime) ? mime : null;
}
