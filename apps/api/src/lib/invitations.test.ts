import { sql } from "@strictbudget/db";
import { budgetInvitation } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBudget,
  createTestApp,
  emailsTo,
  linkToken,
  resetDatabase,
  runJobs,
  signUp,
} from "../../test/helpers";
import { Jobs } from "./jobs";
import { jobHandlers } from "./jobs/handlers";

const { app, db, env, jobs, close } = createTestApp();
beforeEach(async () => {
  await resetDatabase(db);
  await db.execute(sql`delete from pgboss.job`);
});
afterAll(close);

const DAY = 24 * 60 * 60 * 1000;

function post(path: string, cookie: string | null, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function invited() {
  const owner = await signUp(app, { name: "Owner" });
  const budget = await createBudget(app, owner.cookie);
  const email = `pat-${crypto.randomUUID()}@example.com`;
  const res = await post(`/v1/budgets/${budget.id}/invitations`, owner.cookie, {
    name: "Pat",
    email,
  });
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  const first = linkToken((await emailsTo(app, email, "budget-invitation"))[0]);
  return { owner, budget, email, id, first };
}

/** As if the invitation's clock had run on: it now expires `days` from now. */
const expiresIn = (id: string, days: number) =>
  db
    .update(budgetInvitation)
    .set({ expiresAt: new Date(Date.now() + days * DAY) })
    .where(eq(budgetInvitation.id, id));

async function remind() {
  await jobs.send(db, "invitations.remind", null);
  await runJobs(app);
}

describe("invitation reminder", () => {
  it("emails once when 3 days are left, with a new link that replaces the first", async () => {
    const { owner, email, id, first } = await invited();

    await expiresIn(id, 5);
    await remind();
    expect(await emailsTo(app, email, "budget-invitation-reminder")).toHaveLength(0);

    await expiresIn(id, 2.5);
    await remind();
    const reminders = await emailsTo(app, email, "budget-invitation-reminder");
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.text).toContain(owner.email);
    expect(reminders[0]?.text).toContain("expires in 3 days");

    await remind();
    expect(await emailsTo(app, email, "budget-invitation-reminder")).toHaveLength(1);

    const pat = await signUp(app, { email, name: "Pat" });
    expect((await post("/v1/invitations/accept", pat.cookie, { token: first })).status).toBe(404);
    const latest = linkToken(reminders[0]);
    expect((await post("/v1/invitations/accept", pat.cookie, { token: latest })).status).toBe(200);
  });

  it("skips expired, cancelled and accepted invitations", async () => {
    const { id, email } = await invited();
    await expiresIn(id, -1);
    await remind();
    await db
      .update(budgetInvitation)
      .set({ status: "canceled" })
      .where(eq(budgetInvitation.id, id));
    await expiresIn(id, 1);
    await remind();
    expect(await emailsTo(app, email, "budget-invitation-reminder")).toHaveLength(0);
  });

  it("reminds again after a resend, which starts a new 14 days", async () => {
    const { owner, budget, email, id } = await invited();
    await expiresIn(id, 2);
    await remind();
    const resent = await post(
      `/v1/budgets/${budget.id}/invitations/${id}/resend`,
      owner.cookie,
      {},
    );
    expect(resent.status).toBe(200);
    const [row] = await db.select().from(budgetInvitation).where(eq(budgetInvitation.id, id));
    expect(row?.remindedAt).toBeNull();
    await expiresIn(id, 2);
    await remind();
    expect(await emailsTo(app, email, "budget-invitation-reminder")).toHaveLength(2);
  });

  it("is scheduled hourly by the worker", async () => {
    const worker = new Jobs(env.DATABASE_URL, { worker: true, max: 2 });
    await worker.start();
    try {
      await worker.work(jobHandlers, { db, env, jobs: worker } as never);
      const rows = (await db.execute(sql`
        select cron, timezone from pgboss.schedule where name = 'invitations.remind'
      `)) as unknown as { cron: string; timezone: string }[];
      expect(rows).toEqual([{ cron: "0 * * * *", timezone: "UTC" }]);
    } finally {
      await worker.stop();
    }
  });
});

describe("invitation reminder: shared links", () => {
  it("sends none for an invitation whose link the owner shares, which keeps working", async () => {
    const owner = await signUp(app, { name: "Owner" });
    const budget = await createBudget(app, owner.cookie);
    const email = `pat-${crypto.randomUUID()}@example.com`;
    const res = await post(`/v1/budgets/${budget.id}/invitations`, owner.cookie, {
      name: "Pat",
      email,
      sendEmail: false,
    });
    const { id, link } = (await res.json()) as { id: string; link: string };

    await expiresIn(id, 2);
    await remind();
    expect(await emailsTo(app, email, "budget-invitation-reminder")).toHaveLength(0);
    const token = new URLSearchParams(new URL(link).hash.slice(1)).get("token");
    const pat = await signUp(app, { email, name: "Pat" });
    expect((await post("/v1/invitations/accept", pat.cookie, { token })).status).toBe(200);
  });
});
