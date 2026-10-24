import { afterAll, describe, expect, it } from "vitest";
import { createTestApp, emailsTo, linkToken } from "../../test/helpers";

/** Signs up and in with the given headers on every request; returns the session's recorded IP. */
async function sessionIp(
  app: ReturnType<typeof createTestApp>["app"],
  headers: Record<string, string>,
) {
  const email = `ip-${crypto.randomUUID()}@example.com`;
  const password = "correct-horse-battery";
  const base = { "content-type": "application/json", origin: "http://localhost:5173", ...headers };
  await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: base,
    body: JSON.stringify({ email, password, name: "Ip" }),
  });
  const token = linkToken((await emailsTo(app, email, "verify-email"))[0]);
  await app.request(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);
  const signIn = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: base,
    body: JSON.stringify({ email, password }),
  });
  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const res = await app.request("/v1/me/sessions", { headers: { cookie } });
  const { sessions } = (await res.json()) as { sessions: { ipAddress: string | null }[] };
  return sessions[0]?.ipAddress;
}

const railway = createTestApp({ envOverrides: { CLIENT_IP_HEADER: "x-real-ip" } });
const plain = createTestApp();
afterAll(async () => {
  await railway.close();
  await plain.close();
});

describe("client IP", () => {
  const headers = { "x-real-ip": "198.51.100.9", "x-forwarded-for": "203.0.113.1" };

  it("reads CLIENT_IP_HEADER when set (Railway's x-real-ip), not x-forwarded-for", async () => {
    expect(await sessionIp(railway.app, headers)).toBe("198.51.100.9");
  });

  it("reads x-forwarded-for otherwise", async () => {
    expect(await sessionIp(plain.app, headers)).toBe("203.0.113.1");
  });
});
