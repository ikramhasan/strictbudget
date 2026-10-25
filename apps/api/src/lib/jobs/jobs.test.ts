import { sql } from "@strictbudget/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, emailsTo, resetDatabase, runJobs } from "../../../test/helpers";
import type { AppDeps } from "../../types";
import { enqueueEmail } from "../email/queue";
import {
  EMAILS_PER_ADDRESS_PER_HOUR,
  type EmailMessage,
  ThrottledEmailSender,
} from "../email/sender";
import { seal, unseal } from "../sealed";
import { jobHandlers } from "./handlers";
import { installJobs } from "./install";

const { app, db, env, jobs, outbox, close } = createTestApp();
afterAll(close);

const message = (to: string): EmailMessage => ({
  kind: "verify-email",
  to,
  subject: "Confirm",
  text: "https://example.com/#token=secret-token-value",
  html: "<p>Confirm</p>",
});

async function emailJobs() {
  return (await db.execute(sql`
    select state, data::text as data from pgboss.job where name = 'email.send' order by created_on
  `)) as unknown as { state: string; data: string }[];
}

beforeEach(async () => {
  await resetDatabase(db);
  await db.execute(sql`delete from pgboss.job`);
  outbox.outbox.length = 0;
});

describe("background jobs", () => {
  it("queues an email and sends it when the job runs", async () => {
    await enqueueEmail(jobs, db, env, message("queued@example.com"));
    expect(outbox.outbox).toHaveLength(0);
    expect(await emailJobs()).toHaveLength(1);

    expect(await emailsTo(app, "queued@example.com")).toHaveLength(1);
    expect(await runJobs(app)).toBe(0);
  });

  it("keeps the queued email sealed: no address or token in the job table", async () => {
    await enqueueEmail(jobs, db, env, message("sealed@example.com"));
    const [job] = await emailJobs();
    expect(job?.data).not.toContain("sealed@example.com");
    expect(job?.data).not.toContain("secret-token-value");
  });

  it("drops a job queued in a transaction that rolls back", async () => {
    await expect(
      db.transaction(async (tx) => {
        await enqueueEmail(jobs, tx, env, message("rolled-back@example.com"));
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await emailJobs()).toHaveLength(0);
  });

  it("retries a send that failed", async () => {
    await enqueueEmail(jobs, db, env, message("retry@example.com"));
    let calls = 0;
    const failingOnce: AppDeps["email"] = {
      async send(m) {
        calls++;
        if (calls === 1) throw new Error("provider down");
        outbox.outbox.push(m);
      },
    };
    const deps = { db, env, jobs, email: failingOnce } as AppDeps;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await jobs.runQueued(jobHandlers, deps);
    expect(calls).toBe(1);
    // The failed attempt is logged with its queue and attempt (pg-boss itself logs nothing).
    expect(logged).toHaveBeenCalledWith(
      "Job failed",
      expect.objectContaining({ queue: "email.send", attempt: 1 }),
      expect.any(Error),
    );
    logged.mockRestore();
    expect((await emailJobs()).map((j) => j.state)).toEqual(["retry"]);

    // The retry waits (backoff); bring it forward instead of waiting.
    await db.execute(sql`update pgboss.job set start_after = now() where name = 'email.send'`);
    await jobs.runQueued(jobHandlers, deps);
    expect(calls).toBe(2);
    expect(outbox.outbox.map((m) => m.to)).toEqual(["retry@example.com"]);
    expect((await emailJobs()).map((j) => j.state)).toEqual(["completed"]);
  });

  it("still sends an email that failed more often than the hourly limit allows", async () => {
    await enqueueEmail(jobs, db, env, message("outage@example.com"));
    const failures = EMAILS_PER_ADDRESS_PER_HOUR + 2;
    let calls = 0;
    const provider: AppDeps["email"] = {
      async send(m) {
        calls++;
        if (calls <= failures) throw new Error("provider down");
        outbox.outbox.push(m);
      },
    };
    // The real throttle: a failed attempt must not use up the address's limit.
    const email: AppDeps["email"] = new ThrottledEmailSender(provider, db);
    const deps = { db, env, jobs, email } as AppDeps;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let attempt = 0; attempt <= failures; attempt++) {
      await jobs.runQueued(jobHandlers, deps);
      await db.execute(sql`update pgboss.job set start_after = now() where name = 'email.send'`);
    }
    logged.mockRestore();
    expect(calls).toBe(failures + 1);
    expect(outbox.outbox.map((m) => m.to)).toEqual(["outage@example.com"]);
  });

  it("drops, without retrying, an email sealed under another secret", async () => {
    const other = { BETTER_AUTH_SECRET: "a-rotated-away-secret-that-is-long-enough!" };
    await enqueueEmail(jobs, db, other, message("rotated@example.com"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await runJobs(app);
    logged.mockRestore();
    expect(outbox.outbox).toHaveLength(0);
    expect((await emailJobs()).map((j) => j.state)).toEqual(["completed"]);
  });

  it("installs again over an installed queue without error", async () => {
    await installJobs(env.DATABASE_URL);
    const [queue] = (await db.execute(sql`
      select retry_limit from pgboss.queue where name = 'email.send'
    `)) as unknown as { retry_limit: number }[];
    expect(queue?.retry_limit).toBe(8);
  });
});

describe("sealed values", () => {
  it("opens with the same secret and purpose only", () => {
    const sealed = seal({ a: 1 }, env.BETTER_AUTH_SECRET, "one");
    expect(unseal(sealed, env.BETTER_AUTH_SECRET, "one")).toEqual({ a: 1 });
    expect(() => unseal(sealed, env.BETTER_AUTH_SECRET, "two")).toThrow();
    expect(() => unseal(sealed, "another-secret-that-is-long-enough!!", "one")).toThrow();
  });
});
