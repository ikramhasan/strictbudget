import { fakeText } from "@tanstack/ai/testing";
import { RateLimitError } from "@tiny-fish/sdk";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp, testEnv } from "../../../test/helpers";
import { createWebResearch, type WebResearch } from "../../lib/ai/web";

/** TinyFish, faked: records what the assistant looked up; throws `fail` when it's set. */
const lookups: { search: [string, string | undefined][]; read: string[][] } = {
  search: [],
  read: [],
};
let fail: Error | null = null;
const web: WebResearch = {
  async search(query, country) {
    lookups.search.push([query, country]);
    if (fail) throw fail;
    return [
      {
        title: "Blue Bottle Coffee",
        url: "https://bluebottlecoffee.com/",
        site: "bluebottlecoffee.com",
        snippet: "Specialty coffee roaster and cafés.",
      },
    ];
  },
  async read(urls) {
    lookups.read.push(urls);
    if (fail) throw fail;
    return {
      pages: [{ url: urls[0] ?? "", title: "Our cafés", text: "x".repeat(20_000) }],
      failed: urls.slice(1).map((url) => ({ url, error: "bot_blocked" })),
    };
  },
};

const model = fakeText();
const withWeb = createTestApp({ envOverrides: { AI_API_KEY: "test-key" }, aiAdapter: model, web });
const withoutWeb = createTestApp({ envOverrides: { AI_API_KEY: "test-key" }, aiAdapter: model });
beforeEach(async () => {
  await resetDatabase(withWeb.db);
  lookups.search = [];
  lookups.read = [];
  fail = null;
});
afterAll(async () => {
  await withWeb.close();
  await withoutWeb.close();
});

type App = typeof withWeb.app;
type ChatEvent = { type: string; content?: string; outcome?: { type: string } };

/** One chat turn in a budget with AI on; the tool results it streamed back. */
async function chatTurn(app: App, content: string) {
  const owner = await signUp(app);
  const budget = await createBudget(app, owner.cookie);
  const send = (method: string, path: string, body: unknown) =>
    app.request(`/v1/budgets/${budget.id}${path}`, {
      method,
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  await send("PATCH", "/ai", { enabled: true });
  const res = await send("POST", "/ai/chat", {
    threadId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    messages: [{ id: crypto.randomUUID(), role: "user", content }],
    state: {},
    tools: [],
    context: [],
    forwardedProps: { today: "2026-10-30" },
  });
  expect(res.status).toBe(200);
  const events = (await res.text())
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as ChatEvent);
  return {
    results: events
      .filter((e) => e.type === "TOOL_CALL_RESULT")
      .map((e) => JSON.parse(e.content ?? "null")),
    outcome: events.findLast((e) => e.type === "RUN_FINISHED")?.outcome?.type,
  };
}

/** What the model was offered on its first call: tool names and the system prompt. */
function offered() {
  const seen: { tools: string[]; prompt: string } = { tools: [], prompt: "" };
  model.setResponses([
    ({ request }) => {
      seen.tools = (request.tools ?? []).map((tool) => tool.name);
      seen.prompt = JSON.stringify(request.systemPrompts ?? []);
      return { text: "Hi." };
    },
  ]);
  return seen;
}

describe("AI web search", () => {
  it("is offered only on a server with a TinyFish key", async () => {
    expect(createWebResearch(testEnv())).toBeNull();
    expect(createWebResearch({ ...testEnv(), TINYFISH_API_KEY: "tf-key" })).not.toBeNull();

    const without = offered();
    await chatTurn(withoutWeb.app, "Hello");
    expect(without.tools).not.toContain("searchWeb");
    expect(without.tools).not.toContain("readWebPage");
    expect(without.prompt).not.toContain("searchWeb");

    const withIt = offered();
    await chatTurn(withWeb.app, "Hello");
    expect(withIt.tools).toEqual(expect.arrayContaining(["searchWeb", "readWebPage"]));
    expect(withIt.prompt).toContain("searchWeb");
  });

  it("is shown in the budget's AI settings", async () => {
    for (const [app, webSearch] of [
      [withWeb.app, true],
      [withoutWeb.app, false],
    ] as const) {
      const owner = await signUp(app);
      const budget = await createBudget(app, owner.cookie);
      const res = await app.request(`/v1/budgets/${budget.id}/ai`, {
        headers: { cookie: owner.cookie },
      });
      expect(await res.json()).toMatchObject({ webSearch });
    }
  });

  it("looks up a payee and reads its pages without asking", async () => {
    model.setResponses([
      {
        toolCalls: [
          { name: "searchWeb", input: { query: " Blue Bottle Oakland ", country: "us" } },
        ],
      },
      {
        toolCalls: [
          {
            name: "readWebPage",
            input: {
              urls: [
                "https://bluebottlecoffee.com/",
                "file:///etc/passwd",
                "https://a.example/",
                "https://b.example/",
                "https://c.example/",
              ],
            },
          },
        ],
      },
      { text: "Blue Bottle is a café, so Dining out." },
    ]);
    const { results, outcome } = await chatTurn(withWeb.app, "Add $6 at Blue Bottle");
    expect(outcome).not.toBe("interrupt");
    expect(lookups.search).toEqual([["Blue Bottle Oakland", "us"]]);
    // Only http(s), and at most three.
    expect(lookups.read).toEqual([
      ["https://bluebottlecoffee.com/", "https://a.example/", "https://b.example/"],
    ]);
    const [search, read] = results as [
      { results: { title: string }[] },
      { pages: { text: string }[]; failed: { url: string; error: string }[] },
    ];
    expect(search.results.map((r) => r.title)).toEqual(["Blue Bottle Coffee"]);
    // Long pages are cut.
    expect(read.pages[0]?.text.length).toBeLessThan(8_100);
    expect(read.pages[0]?.text).toMatch(/\[…cut\]$/);
    expect(read.failed).toEqual([
      { url: "https://a.example/", error: "bot_blocked" },
      { url: "https://b.example/", error: "bot_blocked" },
    ]);
  });

  it("tells the model when a lookup fails or is malformed, and carries on", async () => {
    fail = new RateLimitError("Too many requests", {
      response: new Response(null, { status: 429 }),
    });
    model.setResponses([
      { toolCalls: [{ name: "searchWeb", input: { query: "Blue Bottle" } }] },
      { toolCalls: [{ name: "readWebPage", input: { urls: ["ftp://nope"] } }] },
      { text: "I couldn't look that up, so which category is it?" },
    ]);
    const { results } = await chatTurn(withWeb.app, "Add $6 at Blue Bottle");
    expect(results).toEqual([
      {
        error: { code: "WEB_UNAVAILABLE", message: "Web search has reached its limit for now" },
      },
      { error: { code: "BAD_REQUEST", message: "Give one to three http(s) URLs" } },
    ]);
    expect(lookups.read).toEqual([]);
  });
});
