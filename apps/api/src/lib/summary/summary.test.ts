import { budget, budgetMonthlySummary } from "@strictbudget/db/schema";
import { fakeText } from "@tanstack/ai/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBudget,
  createTestApp,
  emailsTo,
  resetDatabase,
  runJobs,
  shareBudget,
  signUp,
} from "../../../test/helpers";
import { EMAILS_PER_ADDRESS_PER_HOUR } from "../email/sender";
import { unsubscribeToken } from "./unsubscribe";

const model = fakeText();
const t = createTestApp({ envOverrides: { AI_API_KEY: "test-key" }, aiAdapter: model });
const { app, db, jobs, env } = t;
beforeEach(async () => {
  await resetDatabase(db);
  await db.execute(sql`delete from pgboss.job where name like 'summaries.%'`);
  t.outbox.outbox.length = 0;
});
afterAll(() => t.close());

const TODAY = "2026-09-30";
type Group = { id: string; kind: string | null; categories: { id: string; name: string }[] };

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;

async function runSummaries() {
  await jobs.send(db, "summaries.monthly", { month: "2026-09" });
  await runJobs(app);
}

/**
 * A budget made in August with a September to report: income, spending in two groups (one
 * category overspent in cash), a target left short, and a bill scheduled for October.
 */
async function setup() {
  const owner = await signUp(app);
  const b = await createBudget(app, owner.cookie, { name: "Home" });
  await db
    .update(budget)
    .set({ createdAt: new Date("2026-08-01T00:00:00Z") })
    .where(eq(budget.id, b.id));
  const base = `/v1/budgets/${b.id}`;
  const checking = await json<{ id: string }>(
    await send("POST", `${base}/accounts`, owner.cookie, {
      name: "Checking",
      type: "checking",
      balance: "0",
      date: "2026-08-01",
    }),
  );
  const { groups, readyToAssignCategoryId } = await json<{
    groups: Group[];
    readyToAssignCategoryId: string;
  }>(await send("GET", `${base}/categories`, owner.cookie));
  const [bills, needs] = groups.filter((g) => !g.kind);
  const [rent, phone] = bills?.categories ?? [];
  const [groceries] = needs?.categories ?? [];
  if (!bills || !needs || !rent || !phone || !groceries) throw new Error("starter data missing");
  const add = async (input: Record<string, unknown>) => {
    const res = await send("POST", `${base}/transactions?today=${TODAY}`, owner.cookie, {
      accountId: checking.id,
      ...input,
    });
    expect(res.status, await res.clone().text()).toBe(201);
  };
  const assign = async (categoryId: string, assigned: string) =>
    expect(
      (
        await send("PUT", `${base}/months/2026-09/categories/${categoryId}`, owner.cookie, {
          assigned,
          today: TODAY,
        })
      ).status,
    ).toBe(200);
  await add({ date: "2026-08-20", amount: "-4000", categoryId: groceries.id, payeeName: "Shop" });
  await add({
    date: "2026-09-01",
    amount: "300000",
    categoryId: readyToAssignCategoryId,
    payeeName: "Employer",
  });
  await assign(rent.id, "150000");
  await assign(groceries.id, "20000");
  await add({ date: "2026-09-02", amount: "-150000", categoryId: rent.id, payeeName: "Landlord" });
  await add({ date: "2026-09-10", amount: "-25000", categoryId: groceries.id, payeeName: "Shop" });
  const target = await send("PUT", `${base}/categories/${phone.id}/target`, owner.cookie, {
    cadence: "monthly",
    behavior: "set_aside",
    amount: "6000",
    dueDay: null,
    month: "2026-09",
    today: TODAY,
  });
  expect(target.status).toBe(200);
  const scheduled = await send("POST", `${base}/scheduled-transactions`, owner.cookie, {
    accountId: checking.id,
    date: "2026-10-05",
    frequency: "monthly",
    amount: "-4500",
    payeeName: "Telco",
    categoryId: phone.id,
    today: TODAY,
  });
  expect(scheduled.status, await scheduled.clone().text()).toBe(201);
  return { owner, budget: b, base };
}

describe("monthly summary email", () => {
  it("sends each member the month's numbers once, with an unsubscribe header", async () => {
    const { owner, budget: b } = await setup();
    const member = await shareBudget(app, owner.cookie, b.id);
    await runSummaries();

    const [mail, ...more] = await emailsTo(app, owner.email, "monthly-summary");
    expect(more).toEqual([]);
    expect(mail?.subject).toBe("Your September in strictbudget: Home");
    const text = mail?.text ?? "";
    expect(text).toContain("Home · September 2026");
    expect(text).toContain("You spent $1,750.00, $50.00 more than you assigned.");
    expect(text).toContain("Income: $3,000.00");
    expect(text).toContain("Assigned: $1,700.00");
    // August's $40.00 of cash overspending came out of September's Ready to Assign.
    expect(text).toContain("Ready to Assign at the end of September: $1,260.00");
    expect(text).toContain("Groceries: −$50.00");
    expect(text).toContain("Phone & Internet: $60.00 to go");
    expect(text).toContain("Targets: 0 of 1 funded");
    expect(text).toContain("- 2 Sep Landlord: $1,500.00");
    expect(text).toContain("Coming up in October (1 scheduled)");
    expect(text).toContain("- 5 Oct Telco: -$45.00");
    // Last month's spending (August, $40) is the comparison.
    expect(mail?.html).toContain("vs Aug");
    expect(mail?.html).toContain("Cash overspending comes out of October");
    expect(mail?.html).not.toContain("Overview by your AI assistant");
    expect(mail?.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(mail?.headers?.["List-Unsubscribe"]).toMatch(
      /^<http:\/\/localhost:3000\/v1\/email\/unsubscribe\?token=.+>$/,
    );
    expect(await emailsTo(app, member.email, "monthly-summary")).toHaveLength(1);

    // A second run (a retry, a catch-up after a deploy) sends nothing more.
    await runSummaries();
    await jobs.send(db, "summaries.budget", { budgetId: b.id, month: "2026-09" });
    await runJobs(app);
    expect(await emailsTo(app, owner.email, "monthly-summary")).toHaveLength(1);
  });

  it("sends nothing for a month without money in, out or assigned", async () => {
    const owner = await signUp(app);
    const b = await createBudget(app, owner.cookie);
    await db
      .update(budget)
      .set({ createdAt: new Date("2026-08-01T00:00:00Z") })
      .where(eq(budget.id, b.id));
    await runSummaries();
    expect(await emailsTo(app, owner.email, "monthly-summary")).toEqual([]);
  });

  it("leaves out budgets made after the month, and a fresh start's old budget", async () => {
    const { owner, budget: b } = await setup();
    await db.update(budget).set({ archivedAt: new Date() }).where(eq(budget.id, b.id));
    await runSummaries();
    await db
      .update(budget)
      .set({ archivedAt: null, createdAt: new Date("2026-10-02T00:00:00Z") })
      .where(eq(budget.id, b.id));
    await runSummaries();
    expect(await emailsTo(app, owner.email, "monthly-summary")).toEqual([]);
    expect(await db.select().from(budgetMonthlySummary)).toEqual([]);
  });

  it("isn't capped by the hourly per-address limit", async () => {
    const owner = await signUp(app);
    for (let i = 0; i <= EMAILS_PER_ADDRESS_PER_HOUR; i++) {
      const b = await createBudget(app, owner.cookie, { name: `Budget ${i}` });
      await db
        .update(budget)
        .set({ createdAt: new Date("2026-08-01T00:00:00Z") })
        .where(eq(budget.id, b.id));
      const { groups, readyToAssignCategoryId } = await json<{
        groups: Group[];
        readyToAssignCategoryId: string;
      }>(await send("GET", `/v1/budgets/${b.id}/categories`, owner.cookie));
      expect(groups.length).toBeGreaterThan(0);
      const account = await json<{ id: string }>(
        await send("POST", `/v1/budgets/${b.id}/accounts`, owner.cookie, {
          name: "Cash",
          type: "cash",
          balance: "0",
          date: "2026-08-01",
        }),
      );
      await send("POST", `/v1/budgets/${b.id}/transactions?today=${TODAY}`, owner.cookie, {
        accountId: account.id,
        date: "2026-09-03",
        amount: "1000",
        categoryId: readyToAssignCategoryId,
      });
    }
    await runSummaries();
    expect(await emailsTo(app, owner.email, "monthly-summary")).toHaveLength(
      EMAILS_PER_ADDRESS_PER_HOUR + 1,
    );
  });
});

describe("AI overview", () => {
  const turnOnAi = (base: string, cookie: string) =>
    send("PATCH", `${base}/ai`, cookie, { enabled: true });

  it("adds the overview on a budget with AI on, and leaves out links", async () => {
    const { owner, base } = await setup();
    expect((await turnOnAi(base, owner.cookie)).status).toBe(200);
    model.setResponses([
      {
        text: JSON.stringify({
          overview: "September ran over: Groceries ended $50.00 below zero.",
          points: [
            "Rent took most of the month's spending.",
            "Verify your account at https://evil.example now.",
            "Phone's target is $60.00 short.",
          ],
        }),
      },
    ]);
    await runSummaries();
    const [mail] = await emailsTo(app, owner.email, "monthly-summary");
    expect(mail?.html).toContain("Overview by your AI assistant");
    expect(mail?.text).toContain("September ran over: Groceries ended $50.00 below zero.");
    expect(mail?.text).toContain("- Phone's target is $60.00 short.");
    expect(mail?.text).not.toContain("evil.example");
  });

  it("goes without it when the model fails, or for someone who turned it off", async () => {
    const { owner, budget: b, base } = await setup();
    const member = await shareBudget(app, owner.cookie, b.id);
    await turnOnAi(base, owner.cookie);
    await send("PATCH", "/v1/me/notifications", member.cookie, { monthlySummaryAi: false });
    model.setResponses([{ text: "not json" }]);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await runSummaries();
    logged.mockRestore();
    const [mine] = await emailsTo(app, owner.email, "monthly-summary");
    expect(mine?.html).not.toContain("Overview by your AI assistant");
    expect(mine?.text).toContain("You spent $1,750.00");
    expect(await emailsTo(app, member.email, "monthly-summary")).toHaveLength(1);
  });
});

describe("notification settings", () => {
  it("turns summaries off for every budget, or for one", async () => {
    const { owner, budget: b } = await setup();
    const member = await shareBudget(app, owner.cookie, b.id);
    const read = async (cookie: string) =>
      json<{
        monthlySummary: boolean;
        monthlySummaryAi: boolean;
        budgets: { budgetId: string; name: string; monthlySummary: boolean; aiEnabled: boolean }[];
      }>(await send("GET", "/v1/me/notifications", cookie));
    expect(await read(owner.cookie)).toEqual({
      monthlySummary: true,
      monthlySummaryAi: true,
      budgets: [{ budgetId: b.id, name: "Home", monthlySummary: true, aiEnabled: false }],
    });

    const off = await send("PATCH", "/v1/me/notifications", owner.cookie, {
      budgets: [{ budgetId: b.id, monthlySummary: false }],
    });
    expect(off.status).toBe(200);
    expect((await read(owner.cookie)).budgets[0]?.monthlySummary).toBe(false);
    expect((await read(member.cookie)).budgets[0]?.monthlySummary).toBe(true);
    await send("PATCH", "/v1/me/notifications", member.cookie, { monthlySummary: false });
    expect((await read(member.cookie)).monthlySummary).toBe(false);

    await runSummaries();
    expect(await emailsTo(app, owner.email, "monthly-summary")).toEqual([]);
    expect(await emailsTo(app, member.email, "monthly-summary")).toEqual([]);
  });

  it("refuses a budget the person isn't on", async () => {
    const { budget: b } = await setup();
    const stranger = await signUp(app);
    const res = await send("PATCH", "/v1/me/notifications", stranger.cookie, {
      budgets: [{ budgetId: b.id, monthlySummary: false }],
    });
    expect(res.status).toBe(404);
  });

  it("unsubscribes from the email's link, or a mail client's one-click post", async () => {
    const { owner } = await setup();
    await runSummaries();
    const [mail] = await emailsTo(app, owner.email, "monthly-summary");
    const oneClick = mail?.headers?.["List-Unsubscribe"]?.slice(1, -1) ?? "";
    const path = oneClick.replace("http://localhost:3000", "");
    const res = await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });
    expect(res.status).toBe(204);
    const prefs = await json<{ monthlySummary: boolean }>(
      await send("GET", "/v1/me/notifications", owner.cookie),
    );
    expect(prefs.monthlySummary).toBe(false);
    const page = mail?.text.match(/http:\/\/localhost:5173\/unsubscribe#token=(\S+)/)?.[1];
    expect(decodeURIComponent(page ?? "")).toBe(new URL(oneClick).searchParams.get("token"));
  });

  it("refuses a forged token", async () => {
    const { owner } = await setup();
    const userId = (await json<{ id: string }>(await send("GET", "/v1/me", owner.cookie))).id;
    const forged = unsubscribeToken(userId, "another-secret-that-is-long-enough!!");
    const res = await app.request(`/v1/email/unsubscribe?token=${forged}`, { method: "POST" });
    expect(res.status).toBe(404);
    const real = unsubscribeToken(userId, env.BETTER_AUTH_SECRET);
    const ok = await app.request(`/v1/email/unsubscribe?token=${real}`, { method: "POST" });
    expect(ok.status).toBe(204);
  });
});
