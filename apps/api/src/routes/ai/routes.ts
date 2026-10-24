import { createRoute, z } from "@hono/zod-openapi";
import { zMinorUnits } from "@strictbudget/engine";
import { jsonError } from "../../lib/errors";
import {
  authSecurity,
  requireAuth,
  requireSession,
  sessionSecurity,
} from "../../middleware/require-auth";
import { aiFileBodyLimit } from "./attachments";

export const AiSettingsSchema = z
  .object({
    available: z.boolean().describe("The server has AI set up, so the budget can turn it on"),
    unavailableReason: z
      .enum(["NOT_CONFIGURED"])
      .nullable()
      .describe(
        "Why AI can't be turned on (NOT_CONFIGURED: the server has no AI key); null if it can",
      ),
    enabled: z
      .boolean()
      .describe("In-app AI features are on for this budget (false while unavailable)"),
    assistantButton: z
      .boolean()
      .describe("The floating AI chat button shows on this budget (only while `enabled`)"),
  })
  .openapi("AiSettings");

const UpdateAiSettingsSchema = z
  .strictObject({
    enabled: z.boolean().optional().describe("Turning it off also hides the chat button"),
    assistantButton: z.boolean().optional(),
  })
  .openapi("UpdateAiSettings");

const ConversationSummarySchema = z
  .object({
    id: z.string(),
    title: z.string().describe("The start of the first message"),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime().describe("When the last message was added"),
  })
  .openapi("AiConversationSummary");

const BudgetParams = z.object({
  budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
});

const notFound = jsonError("No such budget, or the caller isn't a member");

export const getAiSettings = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/ai",
  operationId: "getAiSettings",
  tags: ["AI"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "The budget's AI settings, and whether the server can run AI",
  request: { params: BudgetParams },
  responses: {
    200: { description: "Settings", content: { "application/json": { schema: AiSettingsSchema } } },
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: notFound,
  },
});

export const updateAiSettings = createRoute({
  method: "patch",
  path: "/budgets/{budgetId}/ai",
  operationId: "updateAiSettings",
  tags: ["AI"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "Turn the budget's AI features or its chat button on or off",
  request: {
    params: BudgetParams,
    body: { required: true, content: { "application/json": { schema: UpdateAiSettingsSchema } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: AiSettingsSchema } } },
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't change the budget's settings, NOT_FOR_AGENTS: an agent can't, or the account's email address isn't confirmed",
    ),
    404: notFound,
    409: jsonError(
      "AI_UNAVAILABLE: the server has no AI set up; AI_DISABLED: the chat button needs AI turned on",
    ),
  },
});

const ConversationParams = BudgetParams.extend({
  conversationId: z.string().openapi({ param: { name: "conversationId", in: "path" } }),
});

const aiErrors = {
  401: jsonError("Not signed in"),
  403: jsonError(
    "AI_DISABLED: AI is turned off for this budget; READ_ONLY: a viewer can't use it; NOT_FOR_AGENTS: an agent can't; or the account's email address isn't confirmed",
  ),
  503: jsonError("AI_UNAVAILABLE: the server has no AI set up"),
};

export const listAiConversations = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/ai/conversations",
  operationId: "listAiConversations",
  tags: ["AI"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "The caller's conversations with the budget's AI assistant, newest first",
  description: "Conversations are private: each member sees only their own.",
  request: { params: BudgetParams },
  responses: {
    200: {
      description: "Conversations",
      content: {
        "application/json": {
          schema: z
            .object({ conversations: z.array(ConversationSummarySchema) })
            .openapi("AiConversationList"),
        },
      },
    },
    ...aiErrors,
    404: notFound,
  },
});

export const deleteAiConversation = createRoute({
  method: "delete",
  path: "/budgets/{budgetId}/ai/conversations/{conversationId}",
  operationId: "deleteAiConversation",
  tags: ["AI"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "Delete one of the caller's conversations",
  request: { params: ConversationParams },
  responses: {
    204: { description: "Deleted" },
    ...aiErrors,
    404: jsonError("No such budget or conversation, or it isn't the caller's"),
  },
});

export const aiChat = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/ai/chat",
  operationId: "aiChat",
  tags: ["AI"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "Run the budget's AI assistant on a conversation (server-sent events)",
  description:
    "TanStack AI's chat protocol (AG-UI): the body is a run input with the conversation's " +
    "`threadId` (made by the client; a new one starts a conversation), a `runId`, the new " +
    "`messages`, and a `resume` batch answering pending approvals. The response is the run's " +
    "event stream. The assistant reads the budget freely; every change waits for the person's " +
    "approval (a tool-approval interrupt) and runs as their in-app agent.",
  request: {
    params: BudgetParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .looseObject({
              threadId: z
                .string()
                .regex(/^[\w-]{8,100}$/)
                .describe("The conversation's id"),
              runId: z.string().min(1).max(100),
              messages: z.array(z.unknown()),
            })
            .openapi("AiChatRun"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The run's events",
      content: { "text/event-stream": { schema: z.string() } },
    },
    400: jsonError("Invalid input"),
    ...aiErrors,
    404: jsonError("No such budget, or the conversation isn't the caller's"),
  },
});

export const hydrateAiChat = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/ai/chat",
  operationId: "hydrateAiChat",
  tags: ["AI"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "A conversation as the chat client shows it after a reload",
  description:
    "TanStack AI's `reconstructChat`: `{ messages, activeRun, interrupts }` for `threadId`, " +
    "including approvals still waiting on the person. An unknown thread is an empty " +
    "conversation.",
  request: {
    params: BudgetParams,
    query: z.object({
      threadId: z.string().openapi({ param: { name: "threadId", in: "query" } }),
      limit: z.string().optional(),
      before: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "The conversation",
      content: {
        "application/json": {
          schema: z
            .looseObject({
              messages: z.array(z.unknown()),
              activeRun: z.unknown(),
              interrupts: z.unknown(),
            })
            .openapi("AiChatState"),
        },
      },
    },
    ...aiErrors,
    404: jsonError("No such budget, or the conversation isn't the caller's"),
  },
});

export const AiAttachmentSchema = z
  .object({
    id: z.string(),
    fileName: z.string(),
    contentType: z.string().describe("Read from the file, not from what the browser said"),
    byteSize: z.number().int(),
    createdAt: z.iso.datetime(),
  })
  .openapi("AiAttachment");

const AttachmentParams = BudgetParams.extend({
  attachmentId: z.string().openapi({ param: { name: "attachmentId", in: "path" } }),
});

const fileBody = <T extends z.ZodRawShape>(extra: T) => ({
  required: true,
  content: {
    "multipart/form-data": {
      schema: z.object({
        file: z
          .custom<File>((v) => v instanceof File, { message: "Expected a file" })
          .openapi({ type: "string", format: "binary" }),
        ...extra,
      }),
    },
  },
});

const fileErrors = {
  413: jsonError("Bigger than 15 MB, or a photo bigger than 3.75 MB (`FILE_TOO_LARGE`)"),
  415: jsonError(
    "Not a file the assistant can read: photos (JPG, PNG, WebP, GIF), PDFs, Excel workbooks (.xlsx) and text files such as CSV, OFX or QIF (`UNSUPPORTED_FILE_TYPE`)",
  ),
};

const storageOff = jsonError(
  "AI_UNAVAILABLE: the server has no AI set up; ATTACHMENTS_DISABLED: it has no file storage",
);

export const uploadAiAttachment = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/ai/attachments",
  operationId: "uploadAiAttachment",
  tags: ["AI"],
  security: sessionSecurity,
  middleware: [requireSession, aiFileBodyLimit] as const,
  summary: "Upload a file to send to the AI assistant",
  description:
    "Kept in object storage, private to the caller. Send it by putting a pointer to it in a chat " +
    'message: an image or document part whose source is `{ type: "url", value: ' +
    '"strictbudget-attachment:<id>" }`. A file that isn\'t sent within a day is deleted.',
  request: { params: BudgetParams, body: fileBody({}) },
  responses: {
    201: {
      description: "Uploaded",
      content: { "application/json": { schema: AiAttachmentSchema } },
    },
    400: jsonError("No file, or an empty one"),
    ...aiErrors,
    404: notFound,
    ...fileErrors,
    503: storageOff,
  },
});

export const getAiAttachment = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/ai/attachments/{attachmentId}",
  operationId: "getAiAttachment",
  tags: ["AI"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "Open or download a file sent to the AI assistant",
  description:
    "Redirects to a short-lived link to the file in object storage, or (storage on the API's " +
    "own disk) sends the file. Only the person who uploaded it can open it.",
  request: {
    params: AttachmentParams,
    query: z.object({
      download: z
        .enum(["true", "false"])
        .optional()
        .describe("`true`: saved as a download (its file name) rather than shown"),
    }),
  },
  responses: {
    200: {
      description: "The file",
      content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } },
    },
    302: { description: "Where to fetch the file (valid for a few minutes)" },
    ...aiErrors,
    404: jsonError("No such budget or file, or it isn't the caller's"),
    503: storageOff,
  },
});

export const deleteAiAttachment = createRoute({
  method: "delete",
  path: "/budgets/{budgetId}/ai/attachments/{attachmentId}",
  operationId: "deleteAiAttachment",
  tags: ["AI"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "Remove a file before sending it",
  description: "A file already sent stays with its conversation (deleted with it).",
  request: { params: AttachmentParams },
  responses: {
    204: { description: "Deleted" },
    ...aiErrors,
    404: jsonError("No such budget or file, or it isn't the caller's"),
    409: jsonError("ATTACHMENT_SENT: it's part of a conversation"),
  },
});

const DraftLineSchema = z.object({
  categoryId: z.string(),
  memo: z.string().nullable(),
  amount: zMinorUnits.describe("In the account's currency; negative for an outflow"),
});

export const TransactionDraftSchema = z
  .object({
    found: z.boolean().describe("False when the file didn't look like a receipt, invoice or bill"),
    date: z.iso.date().nullable(),
    payeeId: z
      .string()
      .nullable()
      .describe("An existing payee the file matched; null for a new one (`payeeName`) or none"),
    payeeName: z.string().nullable(),
    categoryId: z.string().nullable().describe("Null when unsure, or when it's a split"),
    memo: z.string().nullable(),
    amount: zMinorUnits
      .nullable()
      .describe("The total in the account's currency, negative for an outflow; null if unread"),
    lines: z
      .array(DraftLineSchema)
      .describe("A split by category, adding up to `amount`; empty when it isn't one"),
    note: z.string().nullable().describe("Something the person should check"),
  })
  .openapi("TransactionDraft");

export const draftTransactionFromFile = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/ai/transaction-draft",
  operationId: "draftTransactionFromFile",
  tags: ["AI"],
  security: sessionSecurity,
  middleware: [requireSession, aiFileBodyLimit] as const,
  summary: "Fill in a new transaction from a receipt",
  description:
    "One AI request (not a conversation): reads the file and fills in a transaction for the " +
    "account, choosing from the budget's own categories and payees. Nothing is saved, and the " +
    "file isn't kept: the app puts the result in its new-transaction row for the person to check.",
  request: {
    params: BudgetParams,
    body: fileBody({
      accountId: z.string().describe("The account the transaction goes in"),
      today: z.iso.date().optional().describe("The person's date, for a receipt without a year"),
    }),
  },
  responses: {
    200: {
      description: "The filled-in transaction",
      content: { "application/json": { schema: TransactionDraftSchema } },
    },
    400: jsonError("No file, an empty one, or no such account"),
    ...aiErrors,
    404: notFound,
    ...fileErrors,
    502: jsonError("AI_FAILED: the AI couldn't read the file"),
  },
});
