import { rateLimit, session, user, verification } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestApp,
  emailsTo,
  linkToken,
  one,
  resetDatabase,
  runJobs,
  signIn,
  signUp,
} from "../../test/helpers";
import { EMAILS_PER_ADDRESS_PER_HOUR } from "./email/sender";
import { PASSWORD_CHECKS_PER_HOUR } from "./throttle";

const { app, db, outbox, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

const ORIGIN = "http://localhost:5173";
const JSON_HEADERS = { "content-type": "application/json", origin: ORIGIN };

function post(path: string, body: unknown, cookie?: string) {
  return app.request(path, {
    method: "POST",
    headers: { ...JSON_HEADERS, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function signUpOnly(email: string, password = "correct-horse-battery", name = "Test User") {
  return post("/api/auth/sign-up/email", { email, password, name });
}

function verify(token: string, cookie?: string) {
  return app.request(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, {
    headers: cookie ? { cookie } : {},
  });
}

function signInRaw(email: string, password: string) {
  return post("/api/auth/sign-in/email", { email, password });
}

async function errorCode(res: Response) {
  return ((await res.json()) as { error?: { code?: string }; code?: string }).error?.code;
}

const fresh = () => `user-${crypto.randomUUID()}@example.com`;

describe("email verification", () => {
  it("signs nobody in at sign-up and emails a link to the web app with the token in the fragment", async () => {
    const email = fresh();
    const res = await signUpOnly(email);
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some((c) => c.includes("session_token="))).toBe(false);

    const sent = await emailsTo(app, email);
    expect(sent.map((m) => m.kind)).toEqual(["verify-email"]);
    const url = new URL(sent[0]?.text.match(/https?:\/\/\S+#\S+/)?.[0] ?? "");
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/verify-email");
    // Nothing a scanner fetches (path and query) carries the token; the API URL isn't in the email.
    expect(url.search).toBe("");
    expect(sent[0]?.text).not.toContain("/api/auth");
    expect(sent[0]?.html).not.toContain("/api/auth");
    expect(linkToken(sent[0])).toMatch(/^ey/);
  });

  it("refuses sign-in until the email is confirmed, sending a fresh link", async () => {
    const email = fresh();
    await signUpOnly(email);
    const res = await signInRaw(email, "correct-horse-battery");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("EMAIL_NOT_VERIFIED");
    expect(await emailsTo(app, email, "verify-email")).toHaveLength(2);
  });

  it("doesn't resend on a wrong password, so sign-in can't be used to spam an inbox", async () => {
    const email = fresh();
    await signUpOnly(email);
    expect((await signInRaw(email, "wrong-password-123")).status).toBe(401);
    expect(await emailsTo(app, email, "verify-email")).toHaveLength(1);
  });

  it("confirms the address without signing in; signing in then works", async () => {
    const email = fresh();
    await signUpOnly(email);
    const res = await verify(linkToken((await emailsTo(app, email))[0]));
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some((c) => c.includes("session_token="))).toBe(false);
    const row = await db.query.user.findFirst({ where: eq(user.email, email) });
    expect(row?.emailVerified).toBe(true);
    expect(await signIn(app, email, "correct-horse-battery")).toContain("session_token=");
  });

  it("does nothing for a used link: no session, no change", async () => {
    const email = fresh();
    await signUpOnly(email);
    const token = linkToken((await emailsTo(app, email))[0]);
    await verify(token);
    const again = await verify(token);
    expect(again.status).toBe(200);
    expect(again.headers.getSetCookie().some((c) => c.includes("session_token="))).toBe(false);
  });

  it("rejects a forged or tampered token", async () => {
    const email = fresh();
    await signUpOnly(email);
    const token = linkToken((await emailsTo(app, email))[0]);
    const [h, p, sig] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ email: "someone-else@example.com", exp: 9_999_999_999 }),
    ).toString("base64url");
    for (const bad of ["garbage", `${h}.${forgedPayload}.${sig}`, `${h}.${p}.${sig}x`]) {
      const res = await verify(bad);
      expect(res.status).toBe(401);
    }
    const row = await db.query.user.findFirst({ where: eq(user.email, email) });
    expect(row?.emailVerified).toBe(false);
  });

  it("answers a duplicate sign-up like a new one, emails the owner instead, and keeps their password", async () => {
    const { email, password } = await signUp(app);
    const before = outbox.outbox.length;
    const dup = await signUpOnly(email, "another-password-456", "Intruder");
    const newOne = await signUpOnly(fresh(), "another-password-456", "Intruder");
    expect(dup.status).toBe(200);
    expect(Object.keys((await dup.json()) as object).sort()).toEqual(
      Object.keys((await newOne.json()) as object).sort(),
    );
    await runJobs(app);
    const sentForDup = outbox.outbox.slice(before).filter((m) => m.to === email);
    expect(sentForDup.map((m) => m.kind)).toEqual(["existing-account"]);
    expect((await signInRaw(email, "another-password-456")).status).toBe(401);
    expect(await signIn(app, email, password)).toContain("session_token=");
  });

  it("answers a resend request the same for unknown, unverified and verified addresses", async () => {
    const unverified = fresh();
    await signUpOnly(unverified);
    const { email: verified } = await signUp(app);
    for (const email of [fresh(), unverified, verified]) {
      const res = await post("/api/auth/send-verification-email", { email });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: true });
    }
    expect(await emailsTo(app, unverified, "verify-email")).toHaveLength(2);
    expect(await emailsTo(app, verified, "verify-email")).toHaveLength(1);
  });

  it(`sends one address at most ${EMAILS_PER_ADDRESS_PER_HOUR} links an hour, however often it's asked`, async () => {
    const email = fresh();
    await signUpOnly(email);
    // Sign-up sent one, so this asks for one more than the limit allows. Each signed-out resend
    // takes at least 500 ms (Better Auth's constant-time floor), so the loop stays short.
    for (let i = 0; i < EMAILS_PER_ADDRESS_PER_HOUR; i++) {
      const res = await post("/api/auth/send-verification-email", { email });
      expect(res.status).toBe(200);
    }
    expect(await emailsTo(app, email, "verify-email")).toHaveLength(EMAILS_PER_ADDRESS_PER_HOUR);
  });

  it("puts no user-entered name in emails", async () => {
    const email = fresh();
    await signUpOnly(email, "correct-horse-battery", '<a href="https://evil.test">Win</a>');
    const sent = one((await emailsTo(app, email))[0]);
    expect(sent.html).not.toContain("evil.test");
    expect(sent.text).not.toContain("evil.test");
  });

  it("refuses /v1 routes for a session whose email isn't confirmed", async () => {
    const { cookie, email } = await signUp(app);
    await db.update(user).set({ emailVerified: false }).where(eq(user.email, email));
    const res = await app.request("/v1/me", { headers: { cookie } });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("EMAIL_NOT_VERIFIED");
  });
});

describe("password reset", () => {
  const requestReset = (email: string) => post("/api/auth/request-password-reset", { email });
  const reset = (token: string, newPassword: string) =>
    post("/api/auth/reset-password", { token, newPassword });

  it("answers the same for unknown addresses and only emails real accounts", async () => {
    const { email } = await signUp(app);
    const known = await requestReset(email);
    const unknown = await requestReset(fresh());
    expect(known.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
    const sent = await emailsTo(app, email, "reset-password");
    expect(sent).toHaveLength(1);
    const url = new URL(sent[0]?.text.match(/https?:\/\/\S+#\S+/)?.[0] ?? "");
    expect(`${url.origin}${url.pathname}${url.search}`).toBe(`${ORIGIN}/reset-password`);
  });

  it("resets once, signs out every device and tells the owner", async () => {
    const { email, cookie } = await signUp(app);
    await requestReset(email);
    const token = linkToken((await emailsTo(app, email, "reset-password"))[0]);

    expect((await reset(token, "brand-new-password-1")).status).toBe(200);
    expect((await app.request("/v1/me", { headers: { cookie } })).status).toBe(401);
    expect((await signInRaw(email, "correct-horse-battery")).status).toBe(401);
    expect(await signIn(app, email, "brand-new-password-1")).toContain("session_token=");
    expect(await emailsTo(app, email, "password-changed")).toHaveLength(1);

    const again = await reset(token, "another-password-2");
    expect(again.status).toBe(400);
    expect(await signIn(app, email, "brand-new-password-1")).toContain("session_token=");
  });

  it("stores only a hash of the token", async () => {
    const { email } = await signUp(app);
    await requestReset(email);
    const token = linkToken((await emailsTo(app, email, "reset-password"))[0]);
    const rows = await db.select().from(verification);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.identifier).not.toContain(token);
  });

  it("refuses an expired link", async () => {
    const { email, password } = await signUp(app);
    await requestReset(email);
    const token = linkToken((await emailsTo(app, email, "reset-password"))[0]);
    await db.update(verification).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await reset(token, "brand-new-password-1")).status).toBe(400);
    expect(await signIn(app, email, password)).toContain("session_token=");
  });

  it("refuses a too-short password and leaves the link usable", async () => {
    const { email } = await signUp(app);
    await requestReset(email);
    const token = linkToken((await emailsTo(app, email, "reset-password"))[0]);
    expect((await reset(token, "short")).status).toBe(400);
    expect((await reset(token, "long-enough-password")).status).toBe(200);
  });
});

describe("change email", () => {
  const changeEmail = (cookie: string, newEmail: string, password: string) =>
    post("/v1/me/email", { newEmail, password }, cookie);

  it("checks the password, then asks the current address to approve before the new one confirms", async () => {
    const { cookie, email, password } = await signUp(app);
    const next = fresh();

    const wrong = await changeEmail(cookie, next, "not-my-password");
    expect(wrong.status).toBe(403);
    expect(await errorCode(wrong)).toBe("INVALID_PASSWORD");
    expect(await emailsTo(app, email, "change-email-confirm")).toHaveLength(0);

    const res = await changeEmail(cookie, next, password);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "approval_sent" });
    const approval = await emailsTo(app, email, "change-email-confirm");
    expect(approval).toHaveLength(1);
    expect(approval[0]?.text).toContain(next);
    expect(await emailsTo(app, next)).toHaveLength(0);

    // Approving (from any browser: the link holder owns the current inbox) emails the new address.
    expect((await verify(linkToken(approval[0]))).status).toBe(200);
    expect((await db.query.user.findFirst({ where: eq(user.email, email) }))?.email).toBe(email);
    const confirm = await emailsTo(app, next, "change-email-verify");
    expect(confirm).toHaveLength(1);

    // Opened where nobody is signed in (another device, a forwarded link): no session, no change.
    const signedOut = await verify(linkToken(confirm[0]));
    expect(signedOut.status).toBe(401);
    expect(await signedOut.json()).toMatchObject({ code: "SIGN_IN_REQUIRED" });
    expect(signedOut.headers.getSetCookie().some((c) => c.includes("session_token="))).toBe(false);
    expect((await db.query.user.findFirst({ where: eq(user.email, email) }))?.email).toBe(email);

    // Someone else's session doesn't count either.
    const { cookie: stranger } = await signUp(app);
    expect((await verify(linkToken(confirm[0]), stranger)).status).toBeGreaterThanOrEqual(400);
    expect((await db.query.user.findFirst({ where: eq(user.email, email) }))?.email).toBe(email);

    expect((await verify(linkToken(confirm[0]), cookie)).status).toBe(200);
    const row = await db.query.user.findFirst({ where: eq(user.email, next) });
    expect(row?.emailVerified).toBe(true);
    expect((await signInRaw(email, password)).status).toBe(401);
    expect(await signIn(app, next, password)).toContain("session_token=");

    // Replaying the confirm link once the change is done changes nothing.
    expect((await verify(linkToken(confirm[0]))).status).toBe(401);
    expect(await db.query.user.findFirst({ where: eq(user.email, next) })).toBeTruthy();
  });

  it("says the new address is taken when someone signed up with it before the change was confirmed", async () => {
    const { cookie, email, password } = await signUp(app);
    const next = fresh();
    expect((await changeEmail(cookie, next, password)).status).toBe(202);
    const approval = await emailsTo(app, email, "change-email-confirm");
    expect((await verify(linkToken(approval[0]))).status).toBe(200);
    const confirm = await emailsTo(app, next, "change-email-verify");

    // Someone signs up with the pending address (unconfirmed, but it's theirs now).
    expect((await signUpOnly(next, "another-password-456", "Newcomer")).status).toBe(200);

    const res = await verify(linkToken(confirm[0]), cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "EMAIL_TAKEN" });
    expect((await db.query.user.findFirst({ where: eq(user.email, email) }))?.email).toBe(email);
  });

  it("doesn't call the address taken when a finished change's link is opened again", async () => {
    const { cookie, email, password } = await signUp(app);
    const next = fresh();
    expect((await changeEmail(cookie, next, password)).status).toBe(202);
    const approval = await emailsTo(app, email, "change-email-confirm");
    expect((await verify(linkToken(approval[0]))).status).toBe(200);
    const confirm = await emailsTo(app, next, "change-email-verify");
    expect((await verify(linkToken(confirm[0]), cookie)).status).toBe(200);
    const signedIn = await signIn(app, next, password);

    for (const replay of [
      verify(linkToken(confirm[0]), signedIn),
      verify(linkToken(approval[0])),
    ]) {
      const res = await replay;
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await res.json()).not.toMatchObject({ code: "EMAIL_TAKEN" });
    }
  });

  it("says so at the approval step too", async () => {
    const { cookie, email, password } = await signUp(app);
    const next = fresh();
    expect((await changeEmail(cookie, next, password)).status).toBe(202);
    const approval = await emailsTo(app, email, "change-email-confirm");
    await signUpOnly(next, "another-password-456", "Newcomer");

    const res = await verify(linkToken(approval[0]));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "EMAIL_TAKEN" });
    expect(await emailsTo(app, next, "change-email-verify")).toHaveLength(0);
  });

  it("answers the same when the new address already has an account, and sends nothing", async () => {
    const { cookie, email, password } = await signUp(app);
    const { email: taken } = await signUp(app);
    const before = outbox.outbox.length;
    const res = await changeEmail(cookie, taken, password);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "approval_sent" });
    await runJobs(app);
    expect(outbox.outbox.slice(before)).toHaveLength(0);
    expect((await db.query.user.findFirst({ where: eq(user.email, email) }))?.email).toBe(email);
  });

  it("refuses the current address", async () => {
    const { cookie, email, password } = await signUp(app);
    const res = await changeEmail(cookie, email.toUpperCase(), password);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("SAME_EMAIL");
  });

  it(`allows ${PASSWORD_CHECKS_PER_HOUR} password attempts an hour`, async () => {
    const { cookie, password } = await signUp(app);
    for (let i = 0; i < PASSWORD_CHECKS_PER_HOUR; i++) {
      expect((await changeEmail(cookie, fresh(), "wrong-guess")).status).toBe(403);
    }
    const limited = await changeEmail(cookie, fresh(), password);
    expect(limited.status).toBe(429);
    expect(await errorCode(limited)).toBe("RATE_LIMITED");
  });

  it("isn't reachable through Better Auth's own endpoint, which skips the password", async () => {
    const { cookie } = await signUp(app);
    const res = await post("/api/auth/change-email", { newEmail: fresh() }, cookie);
    expect(res.status).toBe(404);
  });

  it("needs a session", async () => {
    const res = await post("/v1/me/email", { newEmail: fresh(), password: "x" });
    expect(res.status).toBe(401);
  });
});

describe("change password", () => {
  it("needs the current password, can sign out other devices, and tells the owner", async () => {
    const { cookie, email, password } = await signUp(app);
    const other = await signIn(app, email, password);

    const wrong = await post(
      "/api/auth/change-password",
      { currentPassword: "nope-nope-nope", newPassword: "brand-new-password-1" },
      cookie,
    );
    expect(wrong.status).toBe(400);
    expect(await emailsTo(app, email, "password-changed")).toHaveLength(0);

    const res = await post(
      "/api/auth/change-password",
      {
        currentPassword: password,
        newPassword: "brand-new-password-1",
        revokeOtherSessions: true,
      },
      cookie,
    );
    expect(res.status).toBe(200);
    const newCookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    expect((await app.request("/v1/me", { headers: { cookie: other } })).status).toBe(401);
    expect((await app.request("/v1/me", { headers: { cookie: newCookie } })).status).toBe(200);
    expect(await emailsTo(app, email, "password-changed")).toHaveLength(1);
    expect(await signIn(app, email, "brand-new-password-1")).toContain("session_token=");
  });
});

describe("password guessing with a stolen session", () => {
  it("counts change-password and change-email attempts against one hourly limit", async () => {
    const { cookie, password } = await signUp(app);
    const changePassword = (currentPassword: string) =>
      post(
        "/api/auth/change-password",
        { currentPassword, newPassword: "brand-new-password-1" },
        cookie,
      );
    for (let i = 0; i < PASSWORD_CHECKS_PER_HOUR / 2; i++) {
      expect((await changePassword("wrong-guess-1")).status).toBe(400);
      expect(
        (await post("/v1/me/email", { newEmail: fresh(), password: "wrong-guess-2" }, cookie))
          .status,
      ).toBe(403);
    }
    const limited = await changePassword(password);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect((await app.request("/v1/me", { headers: { cookie } })).status).toBe(200);
  });
});

describe("sessions", () => {
  const MAC_CHROME =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

  async function signInAs(email: string, password: string, userAgent: string) {
    const res = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { ...JSON_HEADERS, "user-agent": userAgent },
      body: JSON.stringify({ email, password }),
    });
    return res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  }

  type SessionList = {
    sessions: {
      id: string;
      current: boolean;
      browser: string | null;
      os: string | null;
      deviceType: string;
    }[];
  };
  const list = async (cookie: string) =>
    (await (await app.request("/v1/me/sessions", { headers: { cookie } })).json()) as SessionList;

  it("lists this account's devices, current first, without any session token", async () => {
    const { email, password, cookie: first } = await signUp(app);
    const mac = await signInAs(email, password, MAC_CHROME);
    const phone = await signInAs(email, password, IPHONE);
    await signUp(app); // someone else's sessions stay out

    const res = await app.request("/v1/me/sessions", { headers: { cookie: phone } });
    expect(res.status).toBe(200);
    const raw = await res.text();
    const tokens = (await db.select({ token: session.token }).from(session)).map((r) => r.token);
    for (const token of tokens) expect(raw).not.toContain(token);
    expect(raw).not.toMatch(/"token"/);

    const { sessions } = JSON.parse(raw) as SessionList;
    expect(sessions).toHaveLength(3);
    expect(sessions[0]).toMatchObject({
      current: true,
      browser: "Safari",
      os: "iOS",
      deviceType: "mobile",
    });
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    expect(sessions).toContainEqual(
      expect.objectContaining({ browser: "Chrome", os: "macOS", deviceType: "desktop" }),
    );
    expect(first && mac).toBeTruthy();
  });

  it("signs out one other device by id", async () => {
    const { email, password, cookie } = await signUp(app);
    const other = await signInAs(email, password, MAC_CHROME);
    const target = one((await list(cookie)).sessions.find((s) => !s.current));

    const res = await app.request(`/v1/me/sessions/${target.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(res.status).toBe(204);
    expect((await app.request("/v1/me", { headers: { cookie: other } })).status).toBe(401);
    expect((await list(cookie)).sessions).toHaveLength(1);
  });

  it("refuses this device's id and another account's session", async () => {
    const { cookie } = await signUp(app);
    const { cookie: strangerCookie } = await signUp(app);
    const mine = one((await list(cookie)).sessions[0]);
    const theirs = one((await list(strangerCookie)).sessions[0]);

    const own = await app.request(`/v1/me/sessions/${mine.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(own.status).toBe(400);
    expect(await errorCode(own)).toBe("CURRENT_SESSION");
    const stranger = await app.request(`/v1/me/sessions/${theirs.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(stranger.status).toBe(404);
    expect((await app.request("/v1/me", { headers: { cookie: strangerCookie } })).status).toBe(200);
  });

  it("signs out every other device", async () => {
    const { email, password, cookie } = await signUp(app);
    const a = await signInAs(email, password, MAC_CHROME);
    const b = await signInAs(email, password, IPHONE);
    const res = await app.request("/v1/me/sessions", { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(204);
    for (const gone of [a, b]) {
      expect((await app.request("/v1/me", { headers: { cookie: gone } })).status).toBe(401);
    }
    expect((await app.request("/v1/me", { headers: { cookie } })).status).toBe(200);
  });

  it("blocks Better Auth's session endpoints, which hand tokens to the browser", async () => {
    const { cookie } = await signUp(app);
    expect((await app.request("/api/auth/list-sessions", { headers: { cookie } })).status).toBe(
      404,
    );
    for (const path of ["revoke-session", "revoke-sessions", "revoke-other-sessions"]) {
      expect((await post(`/api/auth/${path}`, { token: "x" }, cookie)).status).toBe(404);
    }
  });

  it("leaves the token out of /get-session", async () => {
    const { cookie } = await signUp(app);
    const res = await app.request("/api/auth/get-session", { headers: { cookie } });
    const body = (await res.json()) as {
      session: Record<string, unknown>;
      user: { email: string };
    };
    expect(body.user.email).toBeTruthy();
    expect(body.session.id).toBeTruthy();
    expect(body.session).not.toHaveProperty("token");
  });
});

describe("Better Auth rate limits", () => {
  const limited = createTestApp({ rateLimit: true });
  afterAll(limited.close);

  it("limits reset requests per client and keeps the count in the database", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await limited.app.request("/api/auth/request-password-reset", {
        method: "POST",
        headers: { ...JSON_HEADERS, "x-forwarded-for": "203.0.113.7" },
        body: JSON.stringify({ email: fresh() }),
      });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
    const rows = await limited.db.select().from(rateLimit);
    expect(rows.some((r) => r.key.includes("203.0.113.7"))).toBe(true);
  });
});
