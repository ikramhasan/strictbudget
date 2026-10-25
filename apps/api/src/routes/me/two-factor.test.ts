import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

const ORIGIN = { origin: "http://localhost:5173" };

function post(path: string, cookie: string | null, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { ...ORIGIN, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}
const cookiesOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

async function codeFor(totpURI: string) {
  const secret = new URL(totpURI).searchParams.get("secret") ?? "";
  return createOTP(new TextDecoder().decode(base32.decode(secret))).totp();
}

async function enable(cookie: string, password: string) {
  const res = await post("/api/auth/two-factor/enable", cookie, { password });
  expect(res.status).toBe(200);
  const { totpURI, backupCodes } = (await res.json()) as {
    totpURI: string;
    backupCodes: string[];
  };
  const verified = await post("/api/auth/two-factor/verify-totp", cookie, {
    code: await codeFor(totpURI),
  });
  expect(verified.status).toBe(200);
  // Turning it on replaces this device's session.
  return { totpURI, backupCodes, cookie: cookiesOf(verified) || cookie };
}

const me = async (cookie: string) =>
  (await (await app.request("/v1/me", { headers: { cookie } })).json()) as {
    twoFactorEnabled: boolean;
  };

describe("two-step verification", () => {
  it("sets up an authenticator app with one emergency backup code", async () => {
    const user = await signUp(app);
    expect((await me(user.cookie)).twoFactorEnabled).toBe(false);
    const { totpURI, backupCodes, cookie } = await enable(user.cookie, user.password);
    expect(totpURI).toMatch(/^otpauth:\/\/totp\/strictbudget:/);
    expect(backupCodes).toHaveLength(1);
    expect((await me(cookie)).twoFactorEnabled).toBe(true);
  });

  it("asks for a code at sign-in, from the app or the backup code (once)", async () => {
    const user = await signUp(app);
    const { totpURI, backupCodes } = await enable(user.cookie, user.password);

    const signIn = () =>
      post("/api/auth/sign-in/email", null, { email: user.email, password: user.password });
    const first = await signIn();
    expect(((await first.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
    const pending = cookiesOf(first);
    expect((await app.request("/v1/me", { headers: { cookie: pending } })).status).toBe(401);

    const wrong = await post("/api/auth/two-factor/verify-totp", pending, { code: "000000" });
    expect(wrong.status).toBe(401);
    const ok = await post("/api/auth/two-factor/verify-totp", pending, {
      code: await codeFor(totpURI),
    });
    expect(ok.status).toBe(200);
    expect((await me(cookiesOf(ok))).twoFactorEnabled).toBe(true);

    const second = cookiesOf(await signIn());
    const backup = await post("/api/auth/two-factor/verify-backup-code", second, {
      code: backupCodes[0],
    });
    expect(backup.status).toBe(200);
    // The backup code is used up.
    const third = cookiesOf(await signIn());
    expect(
      (await post("/api/auth/two-factor/verify-backup-code", third, { code: backupCodes[0] }))
        .status,
    ).not.toBe(200);
  });

  it("turns off with a code from the app, not a password", async () => {
    const user = await signUp(app);
    const { totpURI, cookie } = await enable(user.cookie, user.password);
    const wrong = await post("/v1/me/two-factor/disable", cookie, { code: "000000" });
    expect(wrong.status).toBe(403);
    expect(((await wrong.json()) as { error: { code: string } }).error.code).toBe("INVALID_CODE");
    // The plugin's password-based endpoint is closed.
    expect(
      (await post("/api/auth/two-factor/disable", cookie, { password: user.password })).status,
    ).toBe(404);

    const off = await post("/v1/me/two-factor/disable", cookie, { code: await codeFor(totpURI) });
    expect(off.status).toBe(204);
    expect((await me(cookie)).twoFactorEnabled).toBe(false);
    const again = await post("/api/auth/sign-in/email", null, {
      email: user.email,
      password: user.password,
    });
    expect(((await again.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(
      undefined,
    );
    const twice = await post("/v1/me/two-factor/disable", cookie, { code: "123456" });
    expect(((await twice.json()) as { error: { code: string } }).error.code).toBe(
      "TWO_FACTOR_NOT_ENABLED",
    );
  });
});
