import type { Area } from "react-easy-crop";
import { apiBaseUrl, apiClient } from "./api";
import { apiErrorMessage } from "./budgets";

/** How big a cropped picture is sent: a profile picture, and an account logo. */
export const PROFILE_PICTURE_PX = 512;
export const ACCOUNT_LOGO_PX = 256;

/**
 * The `<img>` source for a picture URL from the API, or undefined without one. Only our own API
 * paths are used: anything else (a URL that would point the browser at another host) is ignored.
 */
export function pictureSrc(url: string | null | undefined): string | undefined {
  return url && /^\/v1\/[\w/?=&.-]+$/.test(url) ? `${apiBaseUrl}${url}` : undefined;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That file isn't an image this browser can read."));
    image.src = src;
  });
}

/**
 * The cropped square of `src`, scaled to `size` px, as WebP (PNG where the browser can't encode
 * WebP). Drawn on a canvas, so whatever was picked (HEIC on Safari, a huge photo) goes up small.
 */
export async function cropToBlob(src: string, area: Area, size: number): Promise<Blob> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser can't crop images.");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, size, size);
  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  const webp = await encode("image/webp");
  if (webp && webp.type === "image/webp") return webp;
  const png = await encode("image/png");
  if (!png) throw new Error("Couldn't save the cropped picture.");
  return png;
}

function pictureForm(blob: Blob): FormData {
  const form = new FormData();
  form.append("file", blob, blob.type === "image/webp" ? "picture.webp" : "picture.png");
  return form;
}

export async function uploadProfilePicture(blob: Blob): Promise<string> {
  const { data, error } = await apiClient.PUT("/v1/me/picture", {
    body: { file: blob as unknown as string },
    bodySerializer: () => pictureForm(blob),
  });
  if (error || !data) throw new Error(apiErrorMessage(error, "Couldn't save the picture."));
  return data.url;
}

export async function deleteProfilePicture(): Promise<void> {
  const { error } = await apiClient.DELETE("/v1/me/picture");
  if (error) throw new Error(apiErrorMessage(error, "Couldn't remove the picture."));
}

export async function uploadAccountLogo(
  budgetId: string,
  accountId: string,
  blob: Blob,
): Promise<string> {
  const { data, error } = await apiClient.PUT("/v1/budgets/{budgetId}/accounts/{accountId}/logo", {
    params: { path: { budgetId, accountId } },
    body: { file: blob as unknown as string },
    bodySerializer: () => pictureForm(blob),
  });
  if (error || !data) throw new Error(apiErrorMessage(error, "Couldn't save the logo."));
  return data.url;
}

export async function deleteAccountLogo(budgetId: string, accountId: string): Promise<void> {
  const { error } = await apiClient.DELETE("/v1/budgets/{budgetId}/accounts/{accountId}/logo", {
    params: { path: { budgetId, accountId } },
  });
  if (error) throw new Error(apiErrorMessage(error, "Couldn't remove the logo."));
}

/**
 * A picture chosen at sign-up waits in this browser until the account is confirmed and signed in
 * (sign-up gives no session to upload with), then `takePendingPicture` hands it over once.
 */
const PENDING_KEY = "strictbudget:pending-picture";

export async function savePendingPicture(email: string, blob: Blob): Promise<void> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  try {
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ email: email.trim().toLowerCase(), dataUrl }),
    );
  } catch {
    // Blocked storage: the picture can still be added in Account settings.
  }
}

export async function takePendingPicture(email: string): Promise<Blob | null> {
  let pending: { email: string; dataUrl: string } | null = null;
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    pending = raw ? (JSON.parse(raw) as { email: string; dataUrl: string }) : null;
  } catch {
    return null;
  }
  if (!pending || pending.email !== email.trim().toLowerCase()) return null;
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing to clear.
  }
  return (await fetch(pending.dataUrl)).blob();
}
