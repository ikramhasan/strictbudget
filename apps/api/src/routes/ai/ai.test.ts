import { readFileSync } from "node:fs";
import { connectedAgent, transaction, user } from "@strictbudget/db/schema";
import { fakeText } from "@tanstack/ai/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBudget,
  createTestApp,
  resetDatabase,
  shareBudget,
  signUp,
} from "../../../test/helpers";
import { agentOperations, type OpenApiDocument } from "../../lib/agents/operations";
import { AGENT_PRINCIPAL, connectAgent } from "../../lib/agents/principal";

// The same database, one server with AI set up (answering from a scripted model) and one without.
const model = fakeText();
const withAi = createTestApp({ envOverrides: { AI_API_KEY: "test-key" }, aiAdapter: model });
const withoutAi = createTestApp();
beforeEach(() => resetDatabase(withAi.db));
afterAll(async () => {
  await withAi.close();
  await withoutAi.close();
});

type App = typeof withAi.app;
type Settings = {
  available: boolean;
  unavailableReason: string | null;
  enabled: boolean;
  assistantButton: boolean;
};

function send(app: App, method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;
const errorCode = async (res: Response) =>
  (await json<{ error: { code: string } }>(res)).error.code;

async function setup(app: App = withAi.app) {
  const owner = await signUp(app);
  const budget = await createBudget(app, owner.cookie);
  const path = `/v1/budgets/${budget.id}/ai`;
  const enable = () => send(withAi.app, "PATCH", path, owner.cookie, { enabled: true });
  return { owner, budget, path, enable };
}

describe("AI settings", () => {
  it("start off, and turn on and off for one budget", async () => {
    const { owner, path } = await setup();
    const other = await createBudget(withAi.app, owner.cookie, { name: "Other" });
    expect(await json<Settings>(await send(withAi.app, "GET", path, owner.cookie))).toEqual({
      available: true,
      unavailableReason: null,
      enabled: false,
      assistantButton: false,
    });

    const on = await send(withAi.app, "PATCH", path, owner.cookie, {
      enabled: true,
      assistantButton: true,
    });
    expect(on.status).toBe(200);
    expect(await json<Settings>(on)).toMatchObject({ enabled: true, assistantButton: true });
    const otherSettings = await send(withAi.app, "GET", `/v1/budgets/${other.id}/ai`, owner.cookie);
    expect(await json<Settings>(otherSettings)).toMatchObject({ enabled: false });

    // Turning AI off hides the chat button too, and it stays hidden when AI comes back.
    await send(withAi.app, "PATCH", path, owner.cookie, { enabled: false });
    const again = await send(withAi.app, "PATCH", path, owner.cookie, { enabled: true });
    expect(await json<Settings>(again)).toMatchObject({ enabled: true, assistantButton: false });
  });

  it("won't show the chat button while AI is off", async () => {
    const { owner, path } = await setup();
    const res = await send(withAi.app, "PATCH", path, owner.cookie, { assistantButton: true });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("AI_DISABLED");
  });

  it("can't turn on without AI on the server, and say why", async () => {
    const { owner, path } = await setup(withoutAi.app);
    expect(await json<Settings>(await send(withoutAi.app, "GET", path, owner.cookie))).toEqual({
      available: false,
      unavailableReason: "NOT_CONFIGURED",
      enabled: false,
      assistantButton: false,
    });
    const res = await send(withoutAi.app, "PATCH", path, owner.cookie, { enabled: true });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("AI_UNAVAILABLE");
  });

  it("read as off when the server loses its AI key", async () => {
    const { owner, path } = await setup();
    await send(withAi.app, "PATCH", path, owner.cookie, { enabled: true, assistantButton: true });
    const settings = await json<Settings>(await send(withoutAi.app, "GET", path, owner.cookie));
    expect(settings).toMatchObject({ available: false, enabled: false, assistantButton: false });
  });

  it("are changed by owners and editors, not viewers or non-members", async () => {
    const { owner, budget, path } = await setup();
    const editor = await shareBudget(withAi.app, owner.cookie, budget.id);
    const viewer = await shareBudget(withAi.app, owner.cookie, budget.id, {
      name: "Vic",
      role: "viewer",
    });
    const stranger = await signUp(withAi.app);
    const patch = (cookie: string) => send(withAi.app, "PATCH", path, cookie, { enabled: true });
    expect((await patch(editor.cookie)).status).toBe(200);
    expect((await patch(viewer.cookie)).status).toBe(403);
    expect((await patch(stranger.cookie)).status).toBe(404);
    expect((await send(withAi.app, "GET", path, viewer.cookie)).status).toBe(200);
  });
});

type ChatEvent = {
  type: string;
  delta?: string;
  toolCallId?: string;
  toolName?: string;
  content?: string;
  outcome?: { type: string; interrupts?: { id: string }[] };
};

/** One chat run, as the app's chat client sends it; the events it streamed back. */
async function run(
  app: App,
  cookie: string,
  budgetId: string,
  body: { threadId: string; content?: string; resume?: unknown[]; parentRunId?: string },
) {
  const res = await send(app, "POST", `/v1/budgets/${budgetId}/ai/chat`, cookie, {
    threadId: body.threadId,
    runId: crypto.randomUUID(),
    messages: body.content
      ? [{ id: crypto.randomUUID(), role: "user", content: body.content }]
      : [],
    ...(body.resume ? { resume: body.resume, parentRunId: body.parentRunId } : {}),
    // The rest of an AG-UI run input, as the chat client sends it.
    state: {},
    tools: [],
    context: [],
    forwardedProps: { today: "2026-10-18" },
  });
  if (res.status !== 200) return { status: res.status, events: [] as ChatEvent[], text: "" };
  const events = (await res.text())
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as ChatEvent);
  const text = events
    .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
    .map((e) => e.delta)
    .join("");
  return { status: res.status, events, text };
}

// The run's outcome is on its last RUN_FINISHED (a tool loop can report more than one).
const finished = (events: ChatEvent[]) => events.findLast((e) => e.type === "RUN_FINISHED");
const toolResults = (events: ChatEvent[]) =>
  events.filter((e) => e.type === "TOOL_CALL_RESULT").map((e) => JSON.parse(e.content ?? "null"));

describe("AI chat", () => {
  it("answers, and keeps the conversation for its history", async () => {
    const { owner, budget, enable, path } = await setup();
    await enable();
    model.setResponses([{ text: "Hi! Ask me about your budget." }]);
    const threadId = crypto.randomUUID();
    const reply = await run(withAi.app, owner.cookie, budget.id, {
      threadId,
      content: "Hello   there",
    });
    expect(reply.status).toBe(200);
    expect(reply.text).toBe("Hi! Ask me about your budget.");

    const list = await json<{ conversations: { id: string; title: string }[] }>(
      await send(withAi.app, "GET", `${path}/conversations`, owner.cookie),
    );
    expect(list.conversations).toEqual([
      expect.objectContaining({ id: threadId, title: "Hello there" }),
    ]);
    const state = await json<{ messages: { role: string }[] }>(
      await send(withAi.app, "GET", `${path}/chat?threadId=${threadId}`, owner.cookie),
    );
    expect(state.messages.map((m) => m.role)).toEqual(["user", "assistant"]);

    const removed = await send(
      withAi.app,
      "DELETE",
      `${path}/conversations/${threadId}`,
      owner.cookie,
    );
    expect(removed.status).toBe(204);
    const after = await json<{ messages: unknown[] }>(
      await send(withAi.app, "GET", `${path}/chat?threadId=${threadId}`, owner.cookie),
    );
    expect(after.messages).toEqual([]);
  });

  it("reads the budget without asking, and only this budget", async () => {
    const { owner, budget, enable } = await setup();
    await enable();
    const other = await createBudget(withAi.app, owner.cookie, { name: "Other" });
    await send(withAi.app, "POST", `/v1/budgets/${other.id}/accounts`, owner.cookie, {
      name: "Elsewhere",
      type: "checking",
      balance: "0",
      date: "2026-10-01",
    });
    await send(withAi.app, "POST", `/v1/budgets/${budget.id}/accounts`, owner.cookie, {
      name: "Checking",
      type: "checking",
      balance: "5000",
      date: "2026-10-01",
    });
    // Even naming the other budget, the tool runs on this one.
    model.setResponses([
      { toolCalls: [{ name: "listAccounts", input: { budgetId: other.id } }] },
      { text: "You have one account." },
    ]);
    const reply = await run(withAi.app, owner.cookie, budget.id, {
      threadId: crypto.randomUUID(),
      content: "What accounts do I have?",
    });
    const [accounts] = toolResults(reply.events) as [{ accounts: { name: string }[] }];
    expect(accounts.accounts.map((a) => a.name)).toEqual(["Checking"]);
    expect(finished(reply.events)?.outcome?.type).not.toBe("interrupt");
    expect(reply.text).toBe("You have one account.");
  });

  it("does arithmetic with its calculator, without asking", async () => {
    const { owner, budget, enable } = await setup();
    await enable();
    model.setResponses([
      { toolCalls: [{ name: "calculate", input: { expression: "0.1 + 0.2 + 1400 - 292.47" } }] },
      { text: "That comes to $1,107.83." },
    ]);
    const reply = await run(withAi.app, owner.cookie, budget.id, {
      threadId: crypto.randomUUID(),
      content: "What's 0.1 + 0.2 + 1400 - 292.47?",
    });
    expect(toolResults(reply.events)).toEqual([
      { expression: "0.1 + 0.2 + 1400 - 292.47", result: "1107.83" },
    ]);
    expect(finished(reply.events)?.outcome?.type).not.toBe("interrupt");
  });

  it("shows charts without asking, and says what's wrong with a bad one", async () => {
    const { owner, budget, enable } = await setup();
    await enable();
    const chart = {
      type: "bar",
      title: "Spending",
      valueFormat: "money",
      data: [{ label: "Rent", spent: 140000 }],
      series: [{ key: "spent", label: "Spent" }],
    };
    model.setResponses([
      {
        toolCalls: [
          { name: "presentChart", input: { ...chart, series: [{ key: "x", label: "X" }] } },
        ],
      },
      { toolCalls: [{ name: "presentChart", input: chart }] },
      { text: "Rent is most of it." },
    ]);
    const reply = await run(withAi.app, owner.cookie, budget.id, {
      threadId: crypto.randomUUID(),
      content: "Chart my spending",
    });
    expect(toolResults(reply.events)).toEqual([
      { error: 'Row 1 ("Rent") needs a number for "x"' },
      { shown: true },
    ]);
    expect(finished(reply.events)?.outcome?.type).not.toBe("interrupt");
  });

  it("makes a change only once the person approves it, as their in-app agent", async () => {
    const { owner, budget, enable, path } = await setup();
    await enable();
    const accounts = await json<{ id: string }>(
      await send(withAi.app, "POST", `/v1/budgets/${budget.id}/accounts`, owner.cookie, {
        name: "Checking",
        type: "checking",
        balance: "0",
        date: "2026-10-01",
      }),
    );
    const addLunch = {
      toolCalls: [
        {
          name: "createTransaction",
          input: {
            // What the person reads when approving; the server drops it before the API call.
            summary: "Add a $12 lunch to Checking, dated Oct 18.",
            body: { accountId: accounts.id, date: "2026-10-18", amount: "-1200", categoryId: null },
          },
        },
      ],
    };
    const lunches = async () =>
      // The account's own starting-balance transaction isn't one.
      (
        await withAi.db
          .select()
          .from(transaction)
          .where(and(eq(transaction.accountId, accounts.id), eq(transaction.amount, -1200n)))
      ).length;

    // Asked: the run pauses for approval and nothing is written.
    model.setResponses([addLunch]);
    const threadId = crypto.randomUUID();
    const paused = await run(withAi.app, owner.cookie, budget.id, {
      threadId,
      content: "I spent 12 on lunch",
    });
    const outcome = finished(paused.events)?.outcome;
    expect(outcome?.type).toBe("interrupt");
    expect(await lunches()).toBe(0);
    // The pause outlives the page: a reload shows it again.
    const state = await json<{ interrupts: { pending: unknown[] } | null }>(
      await send(withAi.app, "GET", `${path}/chat?threadId=${threadId}`, owner.cookie),
    );
    expect(state.interrupts?.pending).toHaveLength(1);
    // New input can't skip the pending approval.
    const skipped = await run(withAi.app, owner.cookie, budget.id, { threadId, content: "hi" });
    expect(skipped.events.some((e) => e.type === "RUN_ERROR")).toBe(true);

    // Approved: it runs, attributed to strictbudget AI on the person's behalf.
    model.setResponses([{ text: "Added your lunch." }]);
    const pausedRun = finished(paused.events) as { runId?: string };
    const approved = await run(withAi.app, owner.cookie, budget.id, {
      threadId,
      parentRunId: pausedRun.runId,
      resume: outcome?.interrupts?.map((i) => ({
        interruptId: i.id,
        status: "resolved",
        payload: true,
      })),
    });
    expect(approved.text).toBe("Added your lunch.");
    expect(await lunches()).toBe(1);
    const [row] = await withAi.db
      .select({ agent: connectedAgent.name, kind: connectedAgent.kind })
      .from(transaction)
      .innerJoin(connectedAgent, eq(connectedAgent.id, transaction.createdByAgentId))
      .where(and(eq(transaction.accountId, accounts.id), eq(transaction.amount, -1200n)));
    expect(row).toEqual({ agent: "strictbudget AI", kind: "in_app" });
  });

  it("makes an approved change once, even when the run fails after it and is retried", async () => {
    const { owner, budget, enable, path } = await setup();
    await enable();
    const account = await json<{ id: string }>(
      await send(withAi.app, "POST", `/v1/budgets/${budget.id}/accounts`, owner.cookie, {
        name: "Checking",
        type: "checking",
        balance: "0",
        date: "2026-10-01",
      }),
    );
    const coffees = async () =>
      (
        await withAi.db
          .select()
          .from(transaction)
          .where(and(eq(transaction.accountId, account.id), eq(transaction.amount, -800n)))
      ).length;
    model.setResponses([
      {
        toolCalls: [
          {
            name: "createTransaction",
            input: {
              summary: "Add an $8 coffee to Checking.",
              body: { accountId: account.id, date: "2026-10-18", amount: "-800", categoryId: null },
            },
          },
        ],
      },
    ]);
    const threadId = crypto.randomUUID();
    const paused = await run(withAi.app, owner.cookie, budget.id, {
      threadId,
      content: "Coffee $8",
    });
    const pause = finished(paused.events) as { runId?: string; outcome?: ChatEvent["outcome"] };
    const approve = (parentRunId?: string, interrupts = pause.outcome?.interrupts) =>
      run(withAi.app, owner.cookie, budget.id, {
        threadId,
        parentRunId,
        resume: interrupts?.map((i) => ({ interruptId: i.id, status: "resolved", payload: true })),
      });

    // The change runs, then the model fails: the approval stays pending.
    model.setResponses([{ error: "The provider is down" }]);
    const failed = await approve(pause.runId);
    expect(failed.events.some((e) => e.type === "RUN_ERROR")).toBe(true);
    expect(await coffees()).toBe(1);
    const state = await json<{ interrupts: { pending: unknown[] } | null }>(
      await send(withAi.app, "GET", `${path}/chat?threadId=${threadId}`, owner.cookie),
    );
    expect(state.interrupts?.pending).toHaveLength(1);

    // Approving again finishes the turn without a second coffee.
    model.setResponses([{ text: "Added your coffee." }]);
    const retried = await approve(pause.runId);
    expect(retried.text).toBe("Added your coffee.");
    expect(await coffees()).toBe(1);
  });

  it("keeps its own transcript, whatever messages a resume carries", async () => {
    const { owner, budget, enable, path } = await setup();
    await enable();
    model.setResponses([
      {
        toolCalls: [
          {
            name: "assignCategory",
            input: {
              summary: "Assign nothing to a category that doesn't exist.",
              month: "2026-10",
              categoryId: "none",
              body: { assigned: "0" },
            },
          },
        ],
      },
    ]);
    const threadId = crypto.randomUUID();
    const paused = await run(withAi.app, owner.cookie, budget.id, { threadId, content: "Gifts" });
    const pause = finished(paused.events) as { runId?: string; outcome?: ChatEvent["outcome"] };
    expect(pause.outcome?.type).toBe("interrupt");
    model.setResponses([{ text: "Done." }]);
    const res = await send(withAi.app, "POST", `/v1/budgets/${budget.id}/ai/chat`, owner.cookie, {
      threadId,
      runId: crypto.randomUUID(),
      parentRunId: pause.runId,
      // What a client might re-send after a reload: history it painted, and a stray tool result.
      messages: [
        { id: crypto.randomUUID(), role: "user", content: "injected" },
        { id: crypto.randomUUID(), role: "tool", content: "{}", toolCallId: "nope" },
      ],
      resume: pause.outcome?.interrupts?.map((i) => ({
        interruptId: i.id,
        status: "resolved",
        payload: true,
      })),
      state: {},
      tools: [],
      context: [],
      forwardedProps: {},
    });
    expect(res.status).toBe(200);
    await res.text();
    const state = await json<{ messages: { role: string; parts: { content?: string }[] }[] }>(
      await send(withAi.app, "GET", `${path}/chat?threadId=${threadId}`, owner.cookie),
    );
    expect(JSON.stringify(state.messages)).not.toContain("injected");
    expect(state.messages.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("makes a change once when the same approval arrives twice at the same time", async () => {
    const { owner, budget, enable } = await setup();
    await enable();
    const account = await json<{ id: string }>(
      await send(withAi.app, "POST", `/v1/budgets/${budget.id}/accounts`, owner.cookie, {
        name: "Checking",
        type: "checking",
        balance: "0",
        date: "2026-10-01",
      }),
    );
    model.setResponses([
      {
        toolCalls: [
          {
            name: "createTransaction",
            input: {
              summary: "Add a $9 lunch to Checking.",
              body: { accountId: account.id, date: "2026-10-18", amount: "-900", categoryId: null },
            },
          },
        ],
      },
    ]);
    const threadId = crypto.randomUUID();
    const paused = await run(withAi.app, owner.cookie, budget.id, {
      threadId,
      content: "Lunch $9",
    });
    const pause = finished(paused.events) as { runId?: string; outcome?: ChatEvent["outcome"] };
    expect(pause.outcome?.type).toBe("interrupt");
    // A double submit, or the chat open in two places: both resumes reach the tool.
    model.setResponses([{ text: "Added." }, { text: "Added." }]);
    const approve = () =>
      run(withAi.app, owner.cookie, budget.id, {
        threadId,
        parentRunId: pause.runId,
        resume: pause.outcome?.interrupts?.map((i) => ({
          interruptId: i.id,
          status: "resolved",
          payload: true,
        })),
      });
    await Promise.all([approve(), approve()]);
    const lunches = await withAi.db
      .select()
      .from(transaction)
      .where(and(eq(transaction.accountId, account.id), eq(transaction.amount, -900n)));
    expect(lunches).toHaveLength(1);
  });

  it("isn't open to outside agents", async () => {
    const { owner, budget, enable, path } = await setup();
    await enable();
    // Not in the catalog MCP and Agent Auth agents get…
    const doc = JSON.parse(
      readFileSync(new URL("../../../openapi.json", import.meta.url), "utf8"),
    ) as OpenApiDocument;
    const agentTools = new Set(agentOperations(doc).map((op) => op.name));
    for (const name of [
      "aiChat",
      "hydrateAiChat",
      "getAiSettings",
      "updateAiSettings",
      "listAiConversations",
      "deleteAiConversation",
    ]) {
      expect(agentTools.has(name), name).toBe(false);
    }
    // …and refused if an agent's request reaches the routes anyway.
    const [person] = await withAi.db.select().from(user).where(eq(user.email, owner.email));
    if (!person) throw new Error("no user");
    const agent = await connectAgent(withAi.db, {
      userId: person.id,
      kind: "mcp",
      externalId: "test-client",
      name: "Test agent",
      authorizedAt: new Date(),
    });
    if (!agent) throw new Error("no agent");
    const asAgent = (method: string, url: string, body?: unknown) =>
      withAi.app.request(
        url,
        {
          method,
          headers: { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        { [AGENT_PRINCIPAL]: { user: person, agent, canWrite: true } },
      );
    const chat = await asAgent("POST", `/v1/budgets/${budget.id}/ai/chat`, {
      threadId: crypto.randomUUID(),
      runId: "r1",
      messages: [],
      state: {},
      tools: [],
      context: [],
      forwardedProps: {},
    });
    expect(chat.status).toBe(403);
    expect(await errorCode(chat)).toBe("NOT_FOR_AGENTS");
    const settings = await asAgent("PATCH", path, { enabled: false });
    expect(settings.status).toBe(403);
    expect(await errorCode(settings)).toBe("NOT_FOR_AGENTS");
  });

  it("doesn't make a change the person denies", async () => {
    const { owner, budget, enable } = await setup();
    await enable();
    // A tool outside the always-loaded set: the model looks it up first, then calls it.
    model.setResponses([
      {
        toolCalls: [
          { name: "__lazy__tool__discovery__", input: { toolNames: ["createCategoryGroup"] } },
        ],
      },
      {
        toolCalls: [
          {
            name: "createCategoryGroup",
            input: { summary: "Add a Holidays category group.", body: { name: "Holidays" } },
          },
        ],
      },
    ]);
    const threadId = crypto.randomUUID();
    const paused = await run(withAi.app, owner.cookie, budget.id, {
      threadId,
      content: "Add a Holidays group",
    });
    const pausedRun = finished(paused.events) as { runId?: string; outcome?: ChatEvent["outcome"] };
    expect(pausedRun.outcome?.type).toBe("interrupt");
    model.setResponses([{ text: "Okay, I won't." }]);
    const denied = await run(withAi.app, owner.cookie, budget.id, {
      threadId,
      parentRunId: pausedRun.runId,
      // The app's Deny cancels the approval (it stays answerable after a deploy changes a schema).
      resume: pausedRun.outcome?.interrupts?.map((i) => ({
        interruptId: i.id,
        status: "cancelled",
      })),
    });
    expect(denied.text).toBe("Okay, I won't.");
    const groups = await json<{ groups: { name: string }[] }>(
      await send(withAi.app, "GET", `/v1/budgets/${budget.id}/categories`, owner.cookie),
    );
    expect(groups.groups.map((g) => g.name)).not.toContain("Holidays");
  });

  it("keeps conversations private to whoever had them", async () => {
    const { owner, budget, enable, path } = await setup();
    await enable();
    model.setResponses([{ text: "Hello." }]);
    const threadId = crypto.randomUUID();
    await run(withAi.app, owner.cookie, budget.id, { threadId, content: "hi" });
    const editor = await shareBudget(withAi.app, owner.cookie, budget.id);
    const theirs = await json<{ conversations: unknown[] }>(
      await send(withAi.app, "GET", `${path}/conversations`, editor.cookie),
    );
    expect(theirs.conversations).toEqual([]);
    const peek = await send(withAi.app, "GET", `${path}/chat?threadId=${threadId}`, editor.cookie);
    expect(peek.status).toBe(404);
    const reply = await run(withAi.app, editor.cookie, budget.id, { threadId, content: "hi" });
    expect(reply.status).toBe(404);
  });

  it("only runs where the budget turned AI on, on a server with AI, for non-viewers", async () => {
    const { owner, budget, enable } = await setup();
    const ask = (app: App, cookie = owner.cookie) =>
      run(app, cookie, budget.id, { threadId: crypto.randomUUID(), content: "hi" });
    const off = await send(withAi.app, "POST", `/v1/budgets/${budget.id}/ai/chat`, owner.cookie, {
      threadId: crypto.randomUUID(),
      runId: "r1",
      messages: [],
    });
    expect(off.status).toBe(403);
    expect(await errorCode(off)).toBe("AI_DISABLED");
    await enable();
    expect((await ask(withoutAi.app)).status).toBe(503);
    const viewer = await shareBudget(withAi.app, owner.cookie, budget.id, { role: "viewer" });
    expect((await ask(withAi.app, viewer.cookie)).status).toBe(403);
  });
});
