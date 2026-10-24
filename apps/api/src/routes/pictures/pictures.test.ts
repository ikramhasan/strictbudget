import { storageDeletion } from "@strictbudget/db/schema";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBudget,
  createTestApp,
  resetDatabase,
  runJobs,
  shareBudget,
  signUp,
} from "../../../test/helpers";
import { MemoryStorage } from "../../lib/storage";

const storage = new MemoryStorage();
const { app, db, jobs, close } = createTestApp({ storage });
beforeEach(async () => {
  await resetDatabase(db);
  storage.objects.clear();
});
afterAll(close);

async function purge() {
  await jobs.send(db, "storage.purge", null);
  await runJobs(app);
}

const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  ),
  (ch) => ch.charCodeAt(0),
);
const PDF = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");
type ErrorBody = { error: { code: string } };
const json = async <T>(res: Response) => (await res.json()) as T;

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function put(path: string, cookie: string, bytes: Uint8Array, name = "picture.png") {
  const form = new FormData();
  form.append("file", new File([bytes as Uint8Array<ArrayBuffer>], name));
  return app.request(path, { method: "PUT", headers: { cookie }, body: form });
}

describe("profile pictures", () => {
  it("sets, replaces and removes one, kept in the user's image", async () => {
    const { cookie } = await signUp(app);
    const first = await put("/v1/me/picture", cookie, PNG);
    expect(first.status, await first.clone().text()).toBe(200);
    const { url } = await json<{ url: string }>(first);
    expect(url).toMatch(/^\/v1\/users\/[^/]+\/picture\?v=/);
    expect((await json<{ image: string }>(await send("GET", "/v1/me", cookie))).image).toBe(url);
    const served = await send("GET", url, cookie);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");

    // Replacing it queues the old file for deletion.
    const { url: second } = await json<{ url: string }>(await put("/v1/me/picture", cookie, PNG));
    expect(second).not.toBe(url);
    await purge();
    expect(storage.objects.size).toBe(1);

    expect((await send("DELETE", "/v1/me/picture", cookie)).status).toBe(204);
    expect((await json<{ image: string | null }>(await send("GET", "/v1/me", cookie))).image).toBe(
      null,
    );
    await purge();
    expect(storage.objects.size).toBe(0);
    expect(await db.select().from(storageDeletion)).toEqual([]);
  });

  it("takes only PNG, JPEG or WebP", async () => {
    const { cookie } = await signUp(app);
    const res = await put("/v1/me/picture", cookie, PDF, "a.png");
    expect(res.status).toBe(415);
    expect((await json<ErrorBody>(res)).error.code).toBe("UNSUPPORTED_FILE_TYPE");
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG);
    expect((await put("/v1/me/picture", cookie, big)).status).toBe(413);
  });

  it("shows to people who share a budget, on members and change history", async () => {
    const owner = await signUp(app, { name: "Owner" });
    const budget = await createBudget(app, owner.cookie);
    const { url } = await json<{ url: string }>(await put("/v1/me/picture", owner.cookie, PNG));
    const stranger = await signUp(app);
    expect((await send("GET", url, stranger.cookie)).status).toBe(404);

    const pat = await shareBudget(app, owner.cookie, budget.id);
    expect((await send("GET", url, pat.cookie)).status).toBe(200);
    const { members } = await json<{ members: { name: string; picture: string | null }[] }>(
      await send("GET", `/v1/budgets/${budget.id}/members`, pat.cookie),
    );
    expect(members.find((m) => m.name === "Owner")?.picture).toBe(url);

    const account = await json<{ id: string }>(
      await send("POST", `/v1/budgets/${budget.id}/accounts`, owner.cookie, {
        name: "Checking",
        type: "checking",
        balance: "1000",
        date: "2026-10-01",
      }),
    );
    const { events } = await json<{ events: { actor: { picture: string | null } | null }[] }>(
      await send("GET", `/v1/budgets/${budget.id}/activity?entity=budget_account`, pat.cookie),
    );
    expect(events[0]?.actor?.picture).toBe(url);
    expect(account.id).toBeTruthy();
  });

  it("can't be pointed elsewhere through Better Auth's own endpoints", async () => {
    const owner = await signUp(app, { name: "Owner" });
    const budget = await createBudget(app, owner.cookie);
    const pat = await shareBudget(app, owner.cookie, budget.id, { name: "Pat" });
    const update = await app.request("/api/auth/update-user", {
      method: "POST",
      headers: {
        cookie: pat.cookie,
        "content-type": "application/json",
        origin: "http://localhost:5173",
      },
      body: JSON.stringify({ image: "https://x.test/p.png", name: "Pat" }),
    });
    expect(update.status).toBe(200);
    const pictureOf = async () =>
      (
        await json<{ members: { name: string; picture: string | null }[] }>(
          await send("GET", `/v1/budgets/${budget.id}/members`, owner.cookie),
        )
      ).members.find((m) => m.name === "Pat")?.picture;
    expect(await pictureOf()).toBeNull();
    expect(
      (await json<{ image: string | null }>(await send("GET", "/v1/me", pat.cookie))).image,
    ).toBe(null);
    // A real picture still shows, as its API path.
    const { url } = await json<{ url: string }>(await put("/v1/me/picture", pat.cookie, PNG));
    expect(await pictureOf()).toBe(url);
  });

  it("goes with its user", async () => {
    const { cookie, password } = await signUp(app);
    await put("/v1/me/picture", cookie, PNG);
    const res = await send("POST", "/v1/me/delete", cookie, { password });
    expect([200, 204]).toContain(res.status);
    await purge();
    expect(storage.objects.size).toBe(0);
  });
});

describe("account logos", () => {
  async function setup() {
    const { cookie } = await signUp(app);
    const budget = await createBudget(app, cookie);
    const base = `/v1/budgets/${budget.id}`;
    const account = await json<{ id: string; logo: string | null }>(
      await send("POST", `${base}/accounts`, cookie, {
        name: "Brac Bank",
        type: "checking",
        balance: "1000",
        date: "2026-10-01",
      }),
    );
    return { cookie, budget, base, account };
  }
  const logoOf = async (base: string, cookie: string, id: string) =>
    (
      await json<{ accounts: { id: string; logo: string | null }[] }>(
        await send("GET", `${base}/accounts`, cookie),
      )
    ).accounts.find((a) => a.id === id)?.logo;

  it("sets one shown on the account, serves it, and removes it", async () => {
    const { cookie, base, account } = await setup();
    expect(account.logo).toBeNull();
    const res = await put(`${base}/accounts/${account.id}/logo`, cookie, PNG);
    expect(res.status, await res.clone().text()).toBe(200);
    const { url } = await json<{ url: string }>(res);
    expect(await logoOf(base, cookie, account.id)).toBe(url);
    expect((await send("GET", url, cookie)).status).toBe(200);
    expect((await send("DELETE", `${base}/accounts/${account.id}/logo`, cookie)).status).toBe(204);
    expect(await logoOf(base, cookie, account.id)).toBeNull();
    await purge();
    expect(storage.objects.size).toBe(0);
  });

  it("is for editors only, and goes with its account", async () => {
    const { cookie, budget, base, account } = await setup();
    const viewer = await shareBudget(app, cookie, budget.id, { role: "viewer" });
    expect((await put(`${base}/accounts/${account.id}/logo`, viewer.cookie, PNG)).status).toBe(403);
    await put(`${base}/accounts/${account.id}/logo`, cookie, PNG);
    expect((await send("DELETE", `${base}/accounts/${account.id}`, cookie)).status).toBe(204);
    await purge();
    expect(storage.objects.size).toBe(0);
  });
});
