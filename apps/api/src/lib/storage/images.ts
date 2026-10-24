import { AppError } from "../errors";
import { attachmentType } from "./file-type";

/**
 * A profile picture or account logo: the browser crops it to a square and sends a small raster
 * image, so only these types and a modest size are taken.
 */
export const PICTURE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_PICTURE_BYTES = 2 * 1024 * 1024;

/** The upload's bytes and type, or a 400/413/415 for anything else. */
export async function readPicture(file: File) {
  if (file.size > MAX_PICTURE_BYTES) {
    throw new AppError(413, "FILE_TOO_LARGE", "Pictures can be at most 2 MB");
  }
  if (file.size === 0) throw new AppError(400, "BAD_REQUEST", "The file is empty");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = await attachmentType(bytes);
  if (!type || !(PICTURE_TYPES as readonly string[]).includes(type)) {
    throw new AppError(415, "UNSUPPORTED_FILE_TYPE", "Pictures can be PNG, JPEG or WebP");
  }
  return { bytes, type };
}

/**
 * A picture's signed link lasts an hour and the browser keeps it a little less; each version has its
 * own URL (`?v=`), so a new picture shows at once.
 */
export const PICTURE_LINK_SECONDS = 60 * 60;
export const PICTURE_CACHE_SECONDS = 50 * 60;
