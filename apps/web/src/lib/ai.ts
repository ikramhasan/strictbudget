import type { components } from "@strictbudget/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { $api, apiBaseUrl, apiClient } from "./api";
import { apiErrorMessage } from "./budgets";
import { type MoneySettings, toMoneyInput } from "./money-input";
import { type Draft, emptyLine } from "./transactions";

export type AiSettings = components["schemas"]["AiSettings"];
export type AiConversationSummary = components["schemas"]["AiConversationSummary"];

const SETTINGS = "/v1/budgets/{budgetId}/ai" as const;

export function useAiSettings(budgetId: string | undefined) {
  return $api.useQuery(
    "get",
    SETTINGS,
    { params: { path: { budgetId: budgetId ?? "" } } },
    { enabled: Boolean(budgetId) },
  );
}

export function useUpdateAiSettings(budgetId: string) {
  const queryClient = useQueryClient();
  const update = $api.useMutation("patch", SETTINGS);
  const init = { params: { path: { budgetId } } };
  return async (body: { enabled?: boolean; assistantButton?: boolean }) => {
    try {
      const next = await update.mutateAsync({ ...init, body });
      queryClient.setQueryData(["get", SETTINGS, init], next);
    } catch (error) {
      toast.error(apiErrorMessage(error, "Couldn't change the AI settings. Try again."));
    }
  };
}

export function aiUnavailableMessage(reason: AiSettings["unavailableReason"]): string | null {
  switch (reason) {
    case "NOT_CONFIGURED":
      return "AI isn't set up on this strictbudget server yet. Whoever runs it needs to add an AI key (AI_API_KEY) before AI features can be turned on.";
    case null:
      return null;
  }
}

export type AiAttachment = components["schemas"]["AiAttachment"];
export type TransactionDraft = components["schemas"]["TransactionDraft"];

export const AI_FILE_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,application/pdf,.xlsx,.csv,.tsv,.ofx,.qfx,.qif,.json,.xml,.txt,text/plain,text/csv";
/** The API's limits: 15 MB a file, 3.75 MB a photo (Claude's 5 MB, once in base64). */
export const MAX_AI_FILE_BYTES = 15 * 1024 * 1024;
const MAX_AI_IMAGE_BYTES = (5 * 1024 * 1024 * 3) / 4;
/** Claude reads images at up to about this many pixels on the long side. */
const IMAGE_EDGE = 2048;

export function aiAttachmentUrl(budgetId: string, attachmentId: string, download = false): string {
  const query = download ? "?download=true" : "";
  return `${apiBaseUrl}/v1/budgets/${budgetId}/ai/attachments/${attachmentId}${query}`;
}

/**
 * A photo small enough for the AI: one over its 3.75 MB limit (a phone's camera) is redrawn as a
 * JPEG at most 2048 px on its long side, which is all the model looks at anyway. Anything else,
 * and a photo this browser can't decode (HEIC outside Safari), is returned as it is.
 */
export async function shrinkForAi(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= MAX_AI_IMAGE_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.85));
    if (!blob) return file;
    return new File([blob], `${file.name.replace(/\.\w+$/, "")}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** A multipart body for the generated client, which can't describe a file field itself. */
function formBody<T extends Record<string, string | File>>(fields: T) {
  return {
    body: fields as unknown as { [K in keyof T]: string },
    bodySerializer: () => {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.append(key, value);
      return form;
    },
  };
}

export async function uploadAiAttachment(budgetId: string, file: File): Promise<AiAttachment> {
  const { data, error } = await apiClient.POST("/v1/budgets/{budgetId}/ai/attachments", {
    params: { path: { budgetId } },
    ...formBody({ file: await shrinkForAi(file) }),
  });
  if (error || !data) throw new Error(apiErrorMessage(error, "Couldn't attach the file."));
  return data;
}

export async function deleteAiAttachment(budgetId: string, attachmentId: string) {
  await apiClient.DELETE("/v1/budgets/{budgetId}/ai/attachments/{attachmentId}", {
    params: { path: { budgetId, attachmentId } },
  });
}

export async function draftTransactionFromFile(
  budgetId: string,
  file: File,
  accountId: string,
  today: string,
): Promise<TransactionDraft> {
  const { data, error } = await apiClient.POST("/v1/budgets/{budgetId}/ai/transaction-draft", {
    params: { path: { budgetId } },
    ...formBody({ file: await shrinkForAi(file), accountId, today }),
  });
  if (error || !data) {
    throw new Error(apiErrorMessage(error, "The AI couldn't read this file. Try again."));
  }
  return data;
}

/** The photo and PDF types the AI reads, of those a transaction attachment can be. */
export const aiReadsAttachment = (file: File) =>
  /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(file.type);

/**
 * A new transaction filled in from what the AI read: what it found replaces the row's fields, and
 * what it didn't find is left as it was. It's always uncleared, for the person to clear once it
 * shows up in the account.
 */
export function applyTransactionDraft(
  draft: Draft,
  read: TransactionDraft,
  settings: MoneySettings,
): Draft {
  const amount = read.amount === null ? null : BigInt(read.amount);
  const unsigned = (n: bigint) => toMoneyInput(n < 0n ? -n : n, settings);
  return {
    ...draft,
    ...(read.date ? { date: read.date } : {}),
    ...(read.payeeName ? { payeeName: read.payeeName, transferAccountId: null } : {}),
    ...(read.memo ? { memo: read.memo } : {}),
    ...(amount !== null
      ? {
          outflow: amount < 0n ? unsigned(amount) : "",
          inflow: amount > 0n ? unsigned(amount) : "",
        }
      : {}),
    ...(read.lines.length > 0
      ? {
          categoryId: null,
          lines: read.lines.map((l) => {
            const part = BigInt(l.amount);
            return emptyLine({
              categoryId: l.categoryId,
              memo: l.memo ?? "",
              outflow: part < 0n ? unsigned(part) : "",
              inflow: part > 0n ? unsigned(part) : "",
            });
          }),
        }
      : read.categoryId
        ? { categoryId: read.categoryId, lines: null }
        : {}),
    cleared: "uncleared",
  };
}
