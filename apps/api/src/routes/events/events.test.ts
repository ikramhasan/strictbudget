import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBudget,
  createTestApp,
  resetDatabase,
  shareBudget,
  signUp,
} from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

function send(method: string, path: string, cookie: string, body?: unknown, headers = {}) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * Opens a server-sent event stream and waits until it's subscribed (its ": connected" line);
 * `until` then reads on until `done` says so, the stream ends or `ms` pass.
 */
async function openStream(res: Response) {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = "";
  const read = async (done: (text: string) => boolean, ms: number) => {
    const deadline = Date.now() + ms;
    while (!done(text) && Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<null>((r) => setTimeout(() => r(null), deadline - Date.now())),
      ]);
      if (!chunk || chunk.done) return true;
      text += decoder.decode(chunk.value);
    }
    return false;
  };
  await read((t) => t.includes(": connected"), 5000);
  return {
    until: async (done: (text: string) => boolean, ms = 5000) => {
      const ended = await read(done, ms);
      await reader.cancel();
      return { text, ended };
    },
  };
}

const changes = (text: string) =>
  text
    .split("\n\n")
    .filter((block) => block.includes("event: change"))
    .map((block) => JSON.parse(block.split("data: ")[1] ?? "{}") as Record<string, string>);

describe("live updates", () => {
  it("tells a member's open stream about a partner's change, with the tab that made it", async () => {
    const owner = await signUp(app, { name: "Owner" });
    const budget = await createBudget(app, owner.cookie);
    const pat = await shareBudget(app, owner.cookie, budget.id);
    const stream = await send("GET", `/v1/budgets/${budget.id}/events`, owner.cookie);
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");

    const open = await openStream(stream);
    const noted = await send(
      "PUT",
      `/v1/budgets/${budget.id}/months/2026-10/note`,
      pat.cookie,
      { note: "Hi" },
      { "x-client-id": "pats-tab" },
    );
    expect(noted.status).toBe(200);
    const { text } = await open.until((text) => changes(text).length > 0);
    expect(changes(text)).toEqual([
      { table: "month_note", actorId: pat.userId, agentId: null, clientId: "pats-tab" },
    ]);
  });

  it("is only for members, and ends for someone removed", async () => {
    const owner = await signUp(app, { name: "Owner" });
    const budget = await createBudget(app, owner.cookie);
    const stranger = await signUp(app);
    expect((await send("GET", `/v1/budgets/${budget.id}/events`, stranger.cookie)).status).toBe(
      404,
    );

    const pat = await shareBudget(app, owner.cookie, budget.id);
    const stream = await send("GET", `/v1/budgets/${budget.id}/events`, pat.cookie);
    const open = await openStream(stream);
    const started = Date.now();
    const removed = await send(
      "DELETE",
      `/v1/budgets/${budget.id}/members/${pat.userId}`,
      owner.cookie,
    );
    expect(removed.status).toBe(204);
    await send("PUT", `/v1/budgets/${budget.id}/months/2026-10/note`, owner.cookie, {
      note: "secret",
    });
    const { text, ended } = await open.until(() => false, 4000);
    expect(changes(text).filter((c) => c.table === "month_note")).toEqual([]);
    expect(ended).toBe(true);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("ends every member's stream when the budget is deleted", async () => {
    const owner = await signUp(app, { name: "Owner" });
    const budget = await createBudget(app, owner.cookie);
    const pat = await shareBudget(app, owner.cookie, budget.id);
    const stream = await send("GET", `/v1/budgets/${budget.id}/events`, pat.cookie);
    const open = await openStream(stream);
    const started = Date.now();
    expect((await send("DELETE", `/v1/budgets/${budget.id}`, owner.cookie)).status).toBe(204);
    const { ended } = await open.until(() => false, 4000);
    expect(ended).toBe(true);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
