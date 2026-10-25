import type { RouteHandler } from "@hono/zod-openapi";
import { sql } from "@strictbudget/db";
import { aiConversation, budget } from "@strictbudget/db/schema";
import { chat, chatParamsFromRequestBody, toServerSentEventsResponse } from "@tanstack/ai";
import { reconstructChat, withPersistence } from "@tanstack/ai-persistence";
import { and, desc, eq } from "drizzle-orm";
import type { Context } from "hono";
import {
  anthropicAdapter,
  budgetTools,
  inAppPrincipal,
  systemPrompt,
} from "../../lib/ai/assistant";
import {
  attachmentIds,
  attachmentMiddleware,
  claimAttachments,
  usableAttachments,
  withStoredAttachments,
} from "../../lib/ai/attachments";
import { chatPersistence } from "../../lib/ai/persistence";
import { aiSettings, aiUnavailableReason, assertAiAllowed } from "../../lib/ai/settings";
import { loadBudgetAccess } from "../../lib/budget-access";
import { AppError } from "../../lib/errors";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import type {
  aiChat,
  deleteAiConversation,
  getAiSettings,
  hydrateAiChat,
  listAiConversations,
  updateAiSettings,
} from "./routes";

type Env = AppEnv & AuthedEnv;

export const getAiSettingsHandler: RouteHandler<typeof getAiSettings, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { budget: b } = await loadBudgetAccess(c, budgetId);
  return c.json(aiSettings(c.var.deps.env, b), 200);
};

export const updateAiSettingsHandler: RouteHandler<typeof updateAiSettings, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  refuseAgents(c);
  const body = c.req.valid("json");
  const { env, db } = c.var.deps;
  // The same permission as the budget's other settings (name, formats).
  const { budget: b } = await loadBudgetAccess(c, budgetId, { organization: ["update"] });
  const enabled = body.enabled ?? b.aiEnabled;
  // Turning AI off hides the chat button too, so turning it back on starts without it.
  const assistantButton = enabled ? (body.assistantButton ?? b.aiAssistantButton) : false;
  if (body.enabled && aiUnavailableReason(env)) {
    throw new AppError(409, "AI_UNAVAILABLE", "AI features aren't set up on this server.");
  }
  if (body.assistantButton && !enabled) {
    throw new AppError(409, "AI_DISABLED", "Turn on AI features before the chat button.");
  }
  const [updated] = await db
    .update(budget)
    .set({ aiEnabled: enabled, aiAssistantButton: assistantButton })
    .where(eq(budget.id, budgetId))
    .returning();
  return c.json(aiSettings(env, updated ?? b), 200);
};

/**
 * The in-app assistant is for the person in the app. An outside agent (MCP, Agent Auth) driving
 * it would spend the server's model key and approve the assistant's changes itself; the agent
 * catalog leaves these routes out too (`AGENT_EXCLUDED`).
 */
// biome-ignore lint/suspicious/noExplicitAny: accepts any route's context (path/input generics)
export function refuseAgents(c: Context<Env, any, any>) {
  if (c.var.agent) {
    throw new AppError(403, "NOT_FOR_AGENTS", "The in-app AI assistant is only for people");
  }
}

type ConversationRow = typeof aiConversation.$inferSelect;

const summaryJson = (c: ConversationRow) => ({
  id: c.id,
  title: c.title,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

/**
 * The budget, once AI may run for it. Every conversation route goes through here, so the AI never
 * reads or writes a budget that hasn't turned it on.
 */
// biome-ignore lint/suspicious/noExplicitAny: accepts any route's context (path/input generics)
export async function aiBudget(c: Context<Env, any, any>, budgetId: string) {
  refuseAgents(c);
  const access = await loadBudgetAccess(c, budgetId);
  assertAiAllowed(c.var.deps.env, access.budget);
  return access.budget;
}

/** The conversation behind a thread id: the caller's own in this budget, or none yet. */
// biome-ignore lint/suspicious/noExplicitAny: accepts any route's context (path/input generics)
async function conversationFor(c: Context<Env, any, any>, budgetId: string, threadId: string) {
  const [row] = await c.var.deps.db
    .select()
    .from(aiConversation)
    .where(eq(aiConversation.id, threadId));
  if (row && (row.budgetId !== budgetId || row.userId !== c.var.user.id)) {
    // Someone else's thread (or another budget's) reads as not there at all.
    throw new AppError(404, "NOT_FOUND", "No such conversation");
  }
  return row ?? null;
}

function messageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const m = message as { content?: unknown; parts?: unknown };
  if (typeof m.content === "string") return m.content;
  const parts = Array.isArray(m.parts) ? m.parts : Array.isArray(m.content) ? m.content : [];
  const text = parts
    .map((p) =>
      p && typeof p === "object" && (p as { type?: unknown }).type === "text"
        ? String(
            (p as { content?: unknown; text?: unknown }).content ??
              (p as { text?: unknown }).text ??
              "",
          )
        : "",
    )
    .join(" ");
  // A message that's only files is named by them.
  if (text.trim()) return text;
  return parts
    .map((p) => (p as { metadata?: { fileName?: unknown } } | null)?.metadata?.fileName)
    .filter((name): name is string => typeof name === "string")
    .join(", ");
}

/** A conversation's title: the start of its first message, on one line. */
function titleFrom(content: string): string {
  const line = content.replace(/\s+/g, " ").trim() || "New chat";
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
}

/** The message a send adds: the last user message, as the client sent it (its id included). */
function newUserMessage<T>(messages: readonly T[]): T[] {
  const last = messages.findLast((m) => (m as { role?: unknown }).role === "user");
  return last ? [last] : [];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const aiChatHandler: RouteHandler<typeof aiChat, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { db, env, auth } = c.var.deps;
  const b = await aiBudget(c, budgetId);
  const params = await chatParamsFromRequestBody(c.req.valid("json")).catch((error: unknown) => {
    // Not a valid AG-UI run input (TanStack AI's message); the caller's mistake, not ours.
    throw new AppError(
      400,
      "INVALID_CHAT_INPUT",
      error instanceof Error ? error.message : "Invalid chat input",
    );
  });
  // The server's transcript is the history. A send contributes its new user message only, a
  // resume nothing: a client re-sending what it painted (after a reload, with paging) would
  // otherwise be merged in again and break the model's tool-call pairing.
  const sent = params.resume ? [] : newUserMessage(params.messages);
  const ids = sent.flatMap(attachmentIds);
  // Checked before the conversation is written, so a refused send leaves nothing behind.
  const attachments = await usableAttachments(
    db,
    { budgetId, userId: c.var.user.id, conversationId: params.threadId },
    ids,
  );
  const existing = await conversationFor(c, budgetId, params.threadId);
  if (existing) {
    // Most recently used first in the history.
    await db
      .update(aiConversation)
      .set({ updatedAt: sql`now()` })
      .where(eq(aiConversation.id, existing.id));
  } else {
    const firstUser = params.messages.findLast((m) => (m as { role?: unknown }).role === "user");
    await db.insert(aiConversation).values({
      id: params.threadId,
      budgetId,
      userId: c.var.user.id,
      title: titleFrom(messageText(firstUser)),
    });
  }
  // Files it carries become this conversation's; the transcript keeps pointers to them.
  await claimAttachments(db, params.threadId, ids);
  const messages = sent.map((m) => withStoredAttachments(m, attachments));

  const adapter = c.var.deps.aiAdapter ?? anthropicAdapter(env);
  if (!adapter)
    throw new AppError(503, "AI_UNAVAILABLE", "AI features aren't set up on this server.");
  const principal = await inAppPrincipal(db, c.var.user);
  // The person's own date (the app sends it), as everywhere budgets take a "today".
  const today =
    typeof params.forwardedProps.today === "string" && ISO_DATE.test(params.forwardedProps.today)
      ? params.forwardedProps.today
      : new Date().toISOString().slice(0, 10);

  const persistence = chatPersistence(db);
  // The tools whose changes this resume approves or denies (see `budgetTools`).
  const answering = params.resume
    ? new Set(
        (await persistence.stores.interrupts.listPending(params.threadId)).flatMap((i) => {
          const name = (i.payload.metadata as { toolName?: unknown } | undefined)?.toolName;
          return typeof name === "string" ? [name] : [];
        }),
      )
    : undefined;

  const abortController = new AbortController();
  c.req.raw.signal.addEventListener("abort", () => abortController.abort());
  const stream = chat({
    adapter,
    messages,
    threadId: params.threadId,
    runId: params.runId,
    ...(params.parentRunId ? { parentRunId: params.parentRunId } : {}),
    ...(params.resume ? { resume: params.resume } : {}),
    systemPrompts: [systemPrompt(b, today)],
    tools: budgetTools(auth.agentRuntime, principal, {
      db,
      storage: c.var.deps.storage,
      budgetId,
      threadId: params.threadId,
      alsoEager: answering,
    }),
    lazyToolsConfig: { includeDescription: "first-sentence" },
    middleware: [
      withPersistence(persistence),
      // After persistence has loaded the transcript: the model gets the files, the store doesn't.
      attachmentMiddleware({ db, storage: c.var.deps.storage, conversationId: params.threadId }),
    ],
    abortController,
  });
  return toServerSentEventsResponse(stream, { abortController });
};

export const hydrateAiChatHandler: RouteHandler<typeof hydrateAiChat, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { threadId } = c.req.valid("query");
  await aiBudget(c, budgetId);
  // A thread the caller doesn't own is a 404 before anything loads; an unknown one is empty.
  await conversationFor(c, budgetId, threadId);
  const res = await reconstructChat(chatPersistence(c.var.deps.db), c.req.raw);
  return c.json(
    (await res.json()) as { messages: unknown[]; activeRun: unknown; interrupts: unknown },
    200,
  );
};

export const listAiConversationsHandler: RouteHandler<typeof listAiConversations, Env> = async (
  c,
) => {
  const { budgetId } = c.req.valid("param");
  await aiBudget(c, budgetId);
  const rows = await c.var.deps.db
    .select()
    .from(aiConversation)
    .where(and(eq(aiConversation.budgetId, budgetId), eq(aiConversation.userId, c.var.user.id)))
    .orderBy(desc(aiConversation.updatedAt), desc(aiConversation.id));
  return c.json({ conversations: rows.map(summaryJson) }, 200);
};

export const deleteAiConversationHandler: RouteHandler<typeof deleteAiConversation, Env> = async (
  c,
) => {
  const { budgetId, conversationId } = c.req.valid("param");
  await aiBudget(c, budgetId);
  if (!(await conversationFor(c, budgetId, conversationId))) {
    throw new AppError(404, "NOT_FOUND", "No such conversation");
  }
  // Its transcript, runs, pending approvals and files go with it (a trigger queues the files).
  await c.var.deps.db.delete(aiConversation).where(eq(aiConversation.id, conversationId));
  await c.var.deps.jobs.send(c.var.deps.db, "storage.purge", null);
  return c.body(null, 204);
};
