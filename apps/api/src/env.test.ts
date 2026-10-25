import { describe, expect, it } from "vitest";
import { isPreviewDeploy, parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:5173",
  WEB_ORIGIN: "http://localhost:5173",
};

describe("parseEnv", () => {
  it("applies defaults", () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe("development");
  });

  it("coerces PORT", () => {
    expect(parseEnv({ ...valid, PORT: "8080" }).PORT).toBe(8080);
  });

  it("fails fast naming the bad variables", () => {
    expect(() =>
      parseEnv({ ...valid, DATABASE_URL: undefined, BETTER_AUTH_SECRET: "short" }),
    ).toThrow(/DATABASE_URL[\s\S]*BETTER_AUTH_SECRET|BETTER_AUTH_SECRET[\s\S]*DATABASE_URL/);
  });
});

describe("parseEnv: email", () => {
  it("treats empty email settings as unset outside production", () => {
    const env = parseEnv({ ...valid, RESEND_API_KEY: "", FROM_EMAIL: "" });
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.FROM_EMAIL).toBeUndefined();
  });

  it("is self-hosted unless told otherwise", () => {
    expect(parseEnv(valid).STRICTBUDGET_DEPLOYMENT).toBe("self-hosted");
    expect(parseEnv({ ...valid, STRICTBUDGET_DEPLOYMENT: "" }).STRICTBUDGET_DEPLOYMENT).toBe(
      "self-hosted",
    );
    expect(parseEnv({ ...valid, STRICTBUDGET_DEPLOYMENT: "cloud" }).STRICTBUDGET_DEPLOYMENT).toBe(
      "cloud",
    );
    expect(() => parseEnv({ ...valid, STRICTBUDGET_DEPLOYMENT: "hosted" })).toThrow(
      /STRICTBUDGET_DEPLOYMENT/,
    );
  });

  it("leaves email optional for a self-hosted production server", () => {
    expect(parseEnv({ ...valid, NODE_ENV: "production" }).RESEND_API_KEY).toBeUndefined();
  });

  it("requires the Resend key and sender in cloud production", () => {
    const cloud = { ...valid, NODE_ENV: "production", STRICTBUDGET_DEPLOYMENT: "cloud" };
    expect(() => parseEnv(cloud)).toThrow(/RESEND_API_KEY[\s\S]*FROM_EMAIL/);
    expect(parseEnv({ ...cloud, RESEND_API_KEY: "re_x", FROM_EMAIL: "a.dev" }).NODE_ENV).toBe(
      "production",
    );
  });

  it("requires a sender with a Resend key", () => {
    expect(() => parseEnv({ ...valid, RESEND_API_KEY: "re_x" })).toThrow(/FROM_EMAIL/);
  });

  it("rejects a key that isn't a Resend key", () => {
    expect(() => parseEnv({ ...valid, RESEND_API_KEY: "sk_live_x" })).toThrow(/RESEND_API_KEY/);
  });
});

describe("parseEnv: Railway PR environments", () => {
  const railway = {
    ...valid,
    BETTER_AUTH_URL: "https://strictbudget.example.com",
    WEB_ORIGIN: "https://strictbudget.example.com",
    RAILWAY_ENVIRONMENT_ID: "env-1",
    RAILWAY_PUBLIC_DOMAIN: "strictbudget-pr-7.up.railway.app",
  };

  it("serves a PR branch's deploy on its own Railway domain", () => {
    const env = parseEnv({ ...railway, RAILWAY_GIT_BRANCH: "feature/x" });
    expect(env.BETTER_AUTH_URL).toBe("https://strictbudget-pr-7.up.railway.app");
    expect(env.WEB_ORIGIN).toBe("https://strictbudget-pr-7.up.railway.app");
  });

  it("keeps the configured URLs for main, manual deploys and other hosts", () => {
    for (const source of [
      { ...railway, RAILWAY_GIT_BRANCH: "main" },
      railway,
      { ...valid, RAILWAY_GIT_BRANCH: "feature/x" },
    ]) {
      expect(isPreviewDeploy(source)).toBe(false);
      expect(parseEnv(source).WEB_ORIGIN).toBe(source.WEB_ORIGIN);
    }
  });
});
