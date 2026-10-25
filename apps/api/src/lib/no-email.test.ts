import { user } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, resetDatabase, signIn, signUp } from "../../test/helpers";

// A self-hosted server without Resend: addresses are taken as given.
const { app, db, close } = createTestApp({ sendsEmail: false });
beforeEach(() => resetDatabase(db));
afterAll(close);

const ORIGIN = { origin: "http://localhost:5173" };
function post(path: string, body: unknown, cookie?: string) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...ORIGIN, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

describe("a server that sends no email", () => {
  it("says so", async () => {
    const res = await app.request("/v1/instance");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deployment: "self-hosted", email: false });
  });

  it("signs straight in after sign-up, with the address confirmed", async () => {
    const email = `pat-${crypto.randomUUID()}@example.com`;
    const res = await post("/api/auth/sign-up/email", {
      email,
      password: "correct-horse-battery",
      name: "Pat",
    });
    expect(res.status).toBe(200);
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    expect(cookie).toContain("session_token=");
    const me = await app.request("/v1/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email, emailVerified: true });
  });

  it("says when an address is taken: there's no email to tell its owner instead", async () => {
    const { email } = await signUp(app);
    const res = await post("/api/auth/sign-up/email", {
      email,
      password: "another-horse-battery",
      name: "Someone",
    });
    expect(res.status).toBe(422);
  });

  it("confirms an account left unconfirmed from when it sent email, on sign-in", async () => {
    const { email, password } = await signUp(app);
    await db.update(user).set({ emailVerified: false }).where(eq(user.email, email));
    const cookie = await signIn(app, email, password);
    expect((await app.request("/v1/me", { headers: { cookie } })).status).toBe(200);
  });

  it("has no password reset link", async () => {
    const { email } = await signUp(app);
    const res = await post("/api/auth/request-password-reset", { email });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("changes the email at once after the password check", async () => {
    const { cookie, password } = await signUp(app);
    const taken = await signUp(app);
    const next = `new-${crypto.randomUUID()}@example.com`;

    const wrong = await post(
      "/v1/me/email",
      { newEmail: next, password: "nope-nope-nope" },
      cookie,
    );
    expect(wrong.status).toBe(403);
    const clash = await post("/v1/me/email", { newEmail: taken.email, password }, cookie);
    expect(clash.status).toBe(409);

    const res = await post("/v1/me/email", { newEmail: next.toUpperCase(), password }, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "changed", email: next });
    const me = await app.request("/v1/me", { headers: { cookie } });
    expect(await me.json()).toMatchObject({ email: next, emailVerified: true });
    expect(await signIn(app, next, password)).toContain("session_token=");
  });
});

describe("GET /v1/instance", () => {
  it("names a cloud server that sends email", async () => {
    const cloud = createTestApp({ envOverrides: { STRICTBUDGET_DEPLOYMENT: "cloud" } });
    try {
      const res = await cloud.app.request("/v1/instance");
      expect(await res.json()).toEqual({ deployment: "cloud", email: true });
    } finally {
      await cloud.close();
    }
  });
});
