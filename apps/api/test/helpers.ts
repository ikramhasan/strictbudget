import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createDb, type Database, sql } from "@strictbudget/db";
import type { App } from "../src/app";
import { createApp } from "../src/app";
import { type Env, parseEnv } from "../src/env";
import { type AuthOptions, createAuth } from "../src/lib/auth";
import { ChangeBus } from "../src/lib/change-bus";
import { QueuedEmailSender } from "../src/lib/email/queue";
import {
  type EmailKind,
  type EmailMessage,
  MemoryEmailSender,
  ThrottledEmailSender,
} from "../src/lib/email/sender";
import { FakeFxProvider } from "../src/lib/fx/fake";
import { Jobs } from "../src/lib/jobs";
import { jobHandlers } from "../src/lib/jobs/handlers";
import { MemoryStorage, type ObjectStorage } from "../src/lib/storage";
import { loadRootEnv } from "../src/load-env";
import type { AppDeps } from "../src/types";
import { workerDatabaseUrl } from "./worker-db";

export function testEnv(): Env {
  loadRootEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
  const worker = Number(process.env.VITEST_POOL_ID);
  return parseEnv({
    NODE_ENV: "test",
    DATABASE_URL: worker ? workerDatabaseUrl(url, worker) : url,
    BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-chars-long",
    BETTER_AUTH_URL: "http://localhost:3000",
    WEB_ORIGIN: "http://localhost:5173",
  });
}

/**
 * Better Auth's scrypt hash with a tiny work factor. The real one (N=16384, r=16) takes ~70 ms per
 * hash, and nearly every test hashes twice (sign-up, sign-in); a wrong password still fails.
 */
function cheapScrypt(password: string, salt: string): Buffer {
  return scryptSync(password.normalize("NFKC"), salt, 64, { N: 16, r: 1, p: 1 });
}
const testPassword = {
  hash: async (password: string) => {
    const salt = randomBytes(16).toString("hex");
    return `${salt}:${cheapScrypt(password, salt).toString("hex")}`;
  },
  verify: async ({ hash, password }: { hash: string; password: string }) => {
    const [salt = "", key = ""] = hash.split(":");
    const expected = Buffer.from(key, "hex");
    const actual = cheapScrypt(password, salt);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  },
};

const outboxes = new WeakMap<App, MemoryEmailSender>();
const appDeps = new WeakMap<App, AppDeps>();

export function createTestApp({
  serverDate = () => null,
  fxProviders = [new FakeFxProvider()],
  externalPlans,
  storage = new MemoryStorage(),
  aiAdapter,
  envOverrides = {},
  sendsEmail = true,
  ...authOptions
}: Partial<Pick<AppDeps, "serverDate" | "fxProviders" | "externalPlans" | "aiAdapter">> & {
  storage?: ObjectStorage | null;
  /** False: a server that sends no email (self-hosted production without Resend). */
  sendsEmail?: boolean;
} & AuthOptions & { envOverrides?: Partial<Env> } = {}) {
  const env = { ...testEnv(), ...envOverrides };
  const { db, listen, close } = createDb(env.DATABASE_URL, { max: 2 });
  // Real throttling over an in-memory outbox, so tests can read what was sent.
  const outbox = new MemoryEmailSender();
  const email = sendsEmail ? new ThrottledEmailSender(outbox, db) : null;
  // The real queue, without a worker: tests run queued jobs on demand (`runJobs`).
  const jobs = new Jobs(env.DATABASE_URL, { worker: false, max: 2 });
  // Tests pick their own `today`, so the server's date doesn't bound it unless a test sets one.
  const deps: AppDeps = {
    db,
    env,
    email,
    jobs,
    auth: createAuth(db, env, email && new QueuedEmailSender(jobs, db, env), {
      password: testPassword,
      ...authOptions,
    }),
    changes: new ChangeBus(listen),
    serverDate,
    fxProviders,
    externalPlans,
    storage,
    aiAdapter,
  };
  const app = createApp(deps);
  outboxes.set(app, outbox);
  appDeps.set(app, deps);
  return {
    app,
    db,
    env,
    outbox,
    fxProviders,
    jobs,
    storage,
    close: async () => {
      await jobs.stop();
      await close();
    },
  };
}

/** Runs the jobs `app` has queued that are due now (sending its emails into the outbox). */
export async function runJobs(app: App): Promise<number> {
  const deps = appDeps.get(app);
  if (!deps) throw new Error("not an app from createTestApp");
  return deps.jobs.runQueued(jobHandlers, deps);
}

/** Every email `app` sent to `to` (optionally of one kind), oldest first, once queued ones ran. */
export async function emailsTo(app: App, to: string, kind?: EmailKind): Promise<EmailMessage[]> {
  const outbox = outboxes.get(app);
  if (!outbox) throw new Error("not an app from createTestApp");
  await runJobs(app);
  return outbox.outbox.filter((m) => m.to === to && (!kind || m.kind === kind));
}

/** `value`, or a failed test when it's missing. */
export function one<T>(value: T | undefined, what = "value"): T {
  if (value === undefined) throw new Error(`expected a ${what}`);
  return value;
}

/** The token in an email's link (links carry it in the URL fragment). */
export function linkToken(maybeMessage: EmailMessage | undefined): string {
  const message = one(maybeMessage, "sent email");
  const url = message.text.match(/https?:\/\/\S+#\S+/)?.[0];
  if (!url) throw new Error(`no link with a token in "${message.subject}"`);
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get("token");
  if (!token) throw new Error(`no token in ${url}`);
  return token;
}

const ORIGIN = { origin: "http://localhost:5173" };

export async function signIn(app: App, email: string, password: string): Promise<string> {
  const res = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", ...ORIGIN },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

/**
 * Empties every table in the public schema (future tables included automatically). DELETE, not
 * TRUNCATE: a test leaves a few rows, and TRUNCATE swaps every table's files (~55 ms for all of
 * them against ~10 ms). The replica role skips foreign-key triggers, so the order doesn't matter
 * (it needs a superuser, which the compose and CI test user is).
 */
export async function resetDatabase(db: Database): Promise<void> {
  await db.execute(sql`
    DO $$
    DECLARE t text;
    BEGIN
      PERFORM set_config('session_replication_role', 'replica', true);
      FOR t IN SELECT quote_ident(tablename) FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE 'DELETE FROM ' || t;
      END LOOP;
    END $$;
  `);
}

/**
 * Signs up, confirms the address through the emailed link and signs in, the way a person would
 * (sign-up alone gives no session until the email is confirmed). On a server that sends no email
 * (`sendsEmail: false`), signs straight in.
 */
export async function signUp(
  app: App,
  input: { email?: string; password?: string; name?: string } = {},
): Promise<{ cookie: string; email: string; password: string }> {
  const email = input.email ?? `user-${crypto.randomUUID()}@example.com`;
  const password = input.password ?? "correct-horse-battery";
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", ...ORIGIN },
    body: JSON.stringify({ email, password, name: input.name ?? "Test User" }),
  });
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  if (!appDeps.get(app)?.email)
    return { cookie: await signIn(app, email, password), email, password };
  const sent = (await emailsTo(app, email, "verify-email")).at(-1);
  if (!sent) throw new Error(`no verification email for ${email}`);
  const verified = await app.request(
    `/api/auth/verify-email?token=${encodeURIComponent(linkToken(sent))}`,
  );
  if (verified.status !== 200) throw new Error(`verify failed: ${verified.status}`);
  return { cookie: await signIn(app, email, password), email, password };
}

export interface TestBudget {
  id: string;
  name: string;
  currency: string;
  numberFormat: string;
  currencySymbolPosition: string;
  dateFormat: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

export const budgetInput = {
  name: "Household",
  currency: "USD",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
} as const;

export async function createBudget(
  app: App,
  cookie: string,
  input: Partial<Record<keyof typeof budgetInput, string>> = {},
): Promise<TestBudget> {
  const res = await app.request("/v1/budgets", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ ...budgetInput, ...input }),
  });
  if (res.status !== 201)
    throw new Error(`create budget failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as TestBudget;
}

/**
 * Shares a budget with a new user the way people do: the owner invites them, they sign up and
 * accept the emailed link. `role` is the invitation's (editor unless given).
 */
export async function shareBudget(
  app: App,
  ownerCookie: string,
  budgetId: string,
  { name = "Pat", role }: { name?: string; role?: string } = {},
): Promise<{ cookie: string; email: string; userId: string }> {
  const email = `member-${crypto.randomUUID()}@example.com`;
  const invited = await app.request(`/v1/budgets/${budgetId}/invitations`, {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ name, email, ...(role ? { role } : {}) }),
  });
  if (invited.status !== 201) throw new Error(`invite failed: ${invited.status}`);
  const person = await signUp(app, { email, name });
  const token = linkToken((await emailsTo(app, email, "budget-invitation")).at(-1));
  const accepted = await app.request("/v1/invitations/accept", {
    method: "POST",
    headers: { cookie: person.cookie, "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (accepted.status !== 200) throw new Error(`accept failed: ${accepted.status}`);
  const members = (await (
    await app.request(`/v1/budgets/${budgetId}/members`, { headers: { cookie: ownerCookie } })
  ).json()) as { members: { userId: string; email: string }[] };
  const userId = members.members.find((m) => m.email === email)?.userId;
  if (!userId) throw new Error("the new member isn't listed");
  return { cookie: person.cookie, email, userId };
}
