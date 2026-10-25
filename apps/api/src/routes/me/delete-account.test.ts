import { sql } from "@strictbudget/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBudget,
  createTestApp,
  emailsTo,
  linkToken,
  resetDatabase,
  signUp,
} from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

function send(method: string, path: string, cookie: string | null, body?: unknown) {
  return app.request(path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      "content-type": "application/json",
      origin: "http://localhost:5173",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function share(budgetId: string, owner: string, invitee: { email: string; cookie: string }) {
  await send("POST", `/v1/budgets/${budgetId}/invitations`, owner, {
    name: "P",
    email: invitee.email,
  });
  const token = linkToken((await emailsTo(app, invitee.email, "budget-invitation")).at(-1));
  await send("POST", "/v1/invitations/accept", invitee.cookie, { token });
}

async function fill(budgetId: string, cookie: string) {
  const account = (await (
    await send("POST", `/v1/budgets/${budgetId}/accounts`, cookie, {
      name: "Checking",
      type: "checking",
      balance: "10000",
      date: "2026-10-01",
    })
  ).json()) as { id: string };
  await send("POST", `/v1/budgets/${budgetId}/transactions`, cookie, {
    accountId: account.id,
    date: "2026-10-02",
    amount: "-500",
    payeeName: "Shop",
    categoryId: null,
  });
}

/** Rows left in any table with a budget_id column for these budgets. */
async function rowsFor(budgetIds: string[]) {
  const tables = await db.execute<{ table_name: string }>(sql`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'budget_id'`);
  let total = 0;
  for (const { table_name } of tables) {
    const [row] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(table_name)}
          where budget_id in (${sql.join(
            budgetIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
    );
    total += row?.n ?? 0;
  }
  const [budgets] = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from budget where id in (${sql.join(
      budgetIds.map((id) => sql`${id}`),
      sql`, `,
    )})`,
  );
  return total + (budgets?.n ?? 0);
}

describe("deleting an account", () => {
  it("needs the password", async () => {
    const user = await signUp(app);
    const res = await send("POST", "/v1/me/delete", user.cookie, { password: "wrong-password" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INVALID_PASSWORD");
    expect((await send("GET", "/v1/me", user.cookie)).status).toBe(200);
  });

  it("deletes owned budgets, shared ones included, and leaves others' budgets", async () => {
    const me = await signUp(app);
    const partner = await signUp(app);
    const mine = await createBudget(app, me.cookie, { name: "Mine" });
    const sharedMine = await createBudget(app, me.cookie, { name: "Mine, shared" });
    const theirs = await createBudget(app, partner.cookie, { name: "Theirs" });
    await fill(mine.id, me.cookie);
    await fill(sharedMine.id, me.cookie);
    await fill(theirs.id, partner.cookie);
    await share(sharedMine.id, me.cookie, partner);
    await share(theirs.id, partner.cookie, me);
    await send("PATCH", "/v1/me/preferences", me.cookie, { keyboardShortcuts: false });

    const userId = ((await (await send("GET", "/v1/me", me.cookie)).json()) as { id: string }).id;
    const res = await send("POST", "/v1/me/delete", me.cookie, { password: me.password });
    expect(res.status).toBe(204);

    expect((await send("GET", "/v1/me", me.cookie)).status).toBe(401);
    const signIn = await send("POST", "/api/auth/sign-in/email", null, {
      email: me.email,
      password: me.password,
    });
    expect(signIn.status).not.toBe(200);

    expect(await rowsFor([mine.id, sharedMine.id])).toBe(0);
    for (const table of ["user", "session", "account", "user_preference", "budget_member"]) {
      const column = table === "user" ? "id" : "user_id";
      const [row] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)}
            where ${sql.identifier(column)} = ${userId}`,
      );
      expect(row?.n, table).toBe(0);
    }

    // The partner keeps their own budget (without this person) and loses the deleted one.
    const list = (await (await send("GET", "/v1/budgets", partner.cookie)).json()) as {
      budgets: { name: string }[];
    };
    expect(list.budgets.map((b) => b.name)).toEqual(["Theirs"]);
    const members = (await (
      await send("GET", `/v1/budgets/${theirs.id}/members`, partner.cookie)
    ).json()) as { members: unknown[] };
    expect(members.members).toHaveLength(1);
    expect(await rowsFor([theirs.id])).toBeGreaterThan(0);
  });
});
