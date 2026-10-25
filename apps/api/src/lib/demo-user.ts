import { createDb } from "@strictbudget/db";
import { budgetMember, user } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
import { createApp } from "../app";
import type { Env } from "../env";
import { createRuntime } from "../runtime";
import { createAuth } from "./auth";
import { seedDemoBudget } from "./demo-budget";
import { ConsoleEmailSender } from "./email/sender";

/** The dev and preview sign-in. Public on purpose: it only exists where anyone may use it. */
export const DEMO_USER = {
  email: "demo@strictbudget.app",
  password: "strictbudget-demo",
  name: "Demo User",
};

/**
 * Creates the demo user (already confirmed) unless it exists, and gives it the sample budget
 * (`seedDemoBudget`) unless it has a budget. Safe to run on every deploy.
 */
export async function seedDemoUser(env: Env): Promise<{ user: boolean; budget: boolean }> {
  const { db, close } = createDb(env.DATABASE_URL, { max: 1 });
  let userId: string;
  let hasBudget: boolean;
  const created = { user: false, budget: false };
  try {
    const existing = await db.query.user.findFirst({ where: eq(user.email, DEMO_USER.email) });
    if (existing) userId = existing.id;
    else {
      const res = await createAuth(db, env, new ConsoleEmailSender()).api.signUpEmail({
        body: DEMO_USER,
      });
      userId = res.user.id;
      created.user = true;
    }
    // No inbox to confirm, so it starts confirmed.
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, userId));
    hasBudget = Boolean(
      await db.query.budgetMember.findFirst({ where: eq(budgetMember.userId, userId) }),
    );
  } finally {
    await close();
  }
  if (hasBudget) return created;

  // Through the API, signed in like the browser would be.
  const runtime = await createRuntime(env, { worker: false });
  try {
    const app = createApp(runtime.deps);
    const res = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: env.WEB_ORIGIN },
      body: JSON.stringify({ email: DEMO_USER.email, password: DEMO_USER.password }),
    });
    if (!res.ok) throw new Error(`demo sign-in failed: ${res.status} ${await res.text()}`);
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    await seedDemoBudget(app, cookie);
    created.budget = true;
  } finally {
    await runtime.close();
  }
  return created;
}
