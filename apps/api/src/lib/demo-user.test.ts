import { createDb } from "@strictbudget/db";
import { budgetAccount, budgetMember, transaction, user } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase, testEnv } from "../../test/helpers";
import { DEMO_USER, seedDemoUser } from "./demo-user";

const env = testEnv();
const { db, close } = createDb(env.DATABASE_URL, { max: 1 });
afterAll(close);
beforeEach(() => resetDatabase(db));

describe("seedDemoUser", () => {
  it("creates the confirmed demo user and its sample budget, once", async () => {
    // The sign-up's confirmation email goes to the console.
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await seedDemoUser(env)).toEqual({ user: true, budget: true });
    expect(await seedDemoUser(env)).toEqual({ user: false, budget: false });

    const rows = await db.select().from(user).where(eq(user.email, DEMO_USER.email));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.emailVerified).toBe(true);
    const members = await db
      .select()
      .from(budgetMember)
      .where(eq(budgetMember.userId, rows[0]?.id ?? ""));
    expect(members).toHaveLength(1);
    const budgetId = members[0]?.budgetId ?? "";
    expect(await db.$count(budgetAccount, eq(budgetAccount.budgetId, budgetId))).toBe(4);
    expect(await db.$count(transaction, eq(transaction.budgetId, budgetId))).toBeGreaterThan(10);
  });
});
