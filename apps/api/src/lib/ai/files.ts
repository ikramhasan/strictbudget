import type { ContentPart } from "@tanstack/ai";
import { fileTypeFromBuffer } from "file-type";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/node";
import { AppError } from "../errors";

/**
 * How the assistant reads a file. Claude reads JPEG, PNG, GIF and WebP images and PDFs itself
 * (docs.claude.com: vision, PDF support); everything else reaches it as text: text files (CSV,
 * TSV, OFX/QFX, QIF, JSON, XML, plain text) as they are, and Excel workbooks converted to CSV, one
 * block per sheet.
 */
export type AiFileKind = "image" | "pdf" | "text" | "spreadsheet";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const BINARY_TYPES: Record<string, AiFileKind> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/gif": "image",
  "image/webp": "image",
  "application/pdf": "pdf",
  [XLSX]: "spreadsheet",
};

/** A text file's type, by its extension (text has no signature to read). */
const TEXT_TYPES: Record<string, string> = {
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  ofx: "application/x-ofx",
  qfx: "application/x-ofx",
  qif: "application/qif",
  json: "application/json",
  xml: "application/xml",
};

/** The largest file the assistant takes (the same as a transaction attachment). */
export const MAX_AI_FILE_BYTES = 15 * 1024 * 1024;
/**
 * Claude's limit on one image is 5 MB of base64, so 3.75 MB of file; the app shrinks bigger
 * photos before uploading them.
 */
export const MAX_AI_IMAGE_BYTES = (5 * 1024 * 1024 * 3) / 4;
/** Text past this many characters (about 50k tokens) is cut off, with a note saying so. */
const MAX_TEXT_CHARS = 200_000;

export const AI_FILE_TYPES_MESSAGE =
  "The assistant can read photos (JPG, PNG, WebP, GIF), PDFs, Excel workbooks (.xlsx) and text files such as CSV, OFX, QIF or TXT";

export const AI_FILE_ACCEPT = [
  ...Object.keys(BINARY_TYPES),
  ...Object.keys(TEXT_TYPES).map((ext) => `.${ext}`),
  ".txt",
  "text/plain",
  "text/csv",
];

const extension = (fileName: string) => fileName.split(".").pop()?.toLowerCase() ?? "";

/** Text: no NUL byte in its first 64 KB (binary formats have them early). */
const looksLikeText = (bytes: Uint8Array) => !bytes.subarray(0, 64 * 1024).includes(0);

/**
 * The file's type and how the assistant reads it, from its contents (and, for text, which has no
 * signature, its extension); null for anything it can't read.
 */
export async function aiFileType(
  bytes: Uint8Array,
  fileName: string,
): Promise<{ contentType: string; kind: AiFileKind } | null> {
  const found = await fileTypeFromBuffer(bytes);
  const kind = found ? BINARY_TYPES[found.mime] : undefined;
  if (found && kind) return { contentType: found.mime, kind };
  // An OFX 2 statement or other XML is text file-type recognizes; anything else it names isn't.
  if (found && found.mime !== "application/xml") return null;
  if (!looksLikeText(bytes)) return null;
  return { contentType: TEXT_TYPES[extension(fileName)] ?? "text/plain", kind: "text" };
}

/** Reads an upload for the assistant: its bytes and type, or a 400/413/415 saying what's wrong. */
export async function readAiFile(file: File) {
  if (file.size > MAX_AI_FILE_BYTES) {
    throw new AppError(413, "FILE_TOO_LARGE", "Files can be at most 15 MB");
  }
  if (file.size === 0) throw new AppError(400, "BAD_REQUEST", "The file is empty");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = await aiFileType(bytes, file.name);
  if (!type) throw new AppError(415, "UNSUPPORTED_FILE_TYPE", AI_FILE_TYPES_MESSAGE);
  if (type.kind === "image" && bytes.byteLength > MAX_AI_IMAGE_BYTES) {
    throw new AppError(413, "FILE_TOO_LARGE", "Photos for the assistant can be at most 3.75 MB");
  }
  return { bytes, ...type, fileName: cleanFileName(file.name) };
}

/** A name to show and save the file as: no path, no control characters, not too long. */
export function cleanFileName(name: string): string {
  const base = name
    .split(/[/\\]/)
    .pop()
    ?.replace(/\p{Cc}/gu, "")
    .trim()
    .slice(-200);
  return base || "file";
}

/** Text as written: UTF-8, or Windows-1252 (what older bank exports use) when it isn't. */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function capped(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_TEXT_CHARS)}\n[… cut off: the file goes on for another ${text.length - MAX_TEXT_CHARS} characters]`;
}

/** A cell as CSV text: dates as YYYY-MM-DD (or a full timestamp when they have a time). */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  return String(value);
}

/**
 * A workbook as CSV, one block per sheet. Numbers stay as the text the file stores (no floats),
 * so amounts reach the model exactly.
 */
export async function spreadsheetText(bytes: Uint8Array): Promise<string> {
  const sheets = await readXlsxFile(Buffer.from(bytes), { parseNumber: (text) => text });
  return sheets
    .map(({ sheet, data }) => {
      const rows = (data as unknown[][]).map((row) => row.map(cellText));
      return `Sheet "${sheet}":\n${Papa.unparse(rows, { newline: "\n" })}`;
    })
    .join("\n\n");
}

/**
 * The file as the model reads it: a line naming it (and the attachment's id, which the assistant's
 * attach tool takes), then the file itself, natively or as text.
 */
export async function modelParts(file: {
  id?: string;
  fileName: string;
  contentType: string;
  kind: AiFileKind;
  bytes: Uint8Array;
}): Promise<ContentPart[]> {
  const label: ContentPart = {
    type: "text",
    content: `Attached file "${file.fileName}" (${file.contentType}${file.id ? `, attachment id ${file.id}` : ""}):`,
  };
  const base64 = () => Buffer.from(file.bytes).toString("base64");
  switch (file.kind) {
    case "image":
      return [
        label,
        { type: "image", source: { type: "data", value: base64(), mimeType: file.contentType } },
      ];
    case "pdf":
      return [
        label,
        {
          type: "document",
          source: { type: "data", value: base64(), mimeType: "application/pdf" },
          metadata: { title: file.fileName },
        },
      ];
    case "text":
      return [label, { type: "text", content: capped(decodeText(file.bytes)) }];
    case "spreadsheet": {
      let text: string;
      try {
        text = capped(await spreadsheetText(file.bytes));
      } catch {
        text = "[This workbook couldn't be read. Ask the person to save it as CSV and try again.]";
      }
      return [label, { type: "text", content: text }];
    }
  }
}

export function kindOf(contentType: string): AiFileKind {
  const binary = BINARY_TYPES[contentType];
  return binary ?? "text";
}
