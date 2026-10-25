import { createDb } from "@strictbudget/db";
import { auditEvent, monthNote, transaction } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBudget,
  createTestApp,
  resetDatabase,
  shareBudget,
  signUp,
  testEnv,
} from "../../../test/helpers";
import { AppError } from "../../lib/errors";
import { requireAuth } from "../../middleware/require-auth";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Values = Record<string, string | null>;
type Event = {
  id: string;
  at: string;
  actor: { userId: string; name: string | null; avatarColor: number | null } | null;
  source: string | null;
  entity: string;
  rowId: string;
  op: "insert" | "update" | "delete";
  before: Values | null;
  after: Values | null;
};
type Page = { events: Event[]; nextCursor: string | null };

const TODAY = "2026-10-01";

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;

async function setup() {
  const owner = await signUp(app, { name: "Owner" });
  const budget = await createBudget(app, owner.cookie);
  const base = `/v1/budgets/${budget.id}`;
  const pat = await shareBudget(app, owner.cookie, budget.id);
  const account = await json<{ id: string }>(
    await send("POST", `${base}/accounts`, owner.cookie, {
      name: "Checking",
      type: "checking",
      balance: "100000",
      date: TODAY,
    }),
  );
  const activity = async (query = "", cookie = owner.cookie) =>
    json<Page>(await send("GET", `${base}/activity${query}`, cookie));
  return { owner, pat, budget, base, account, activity };
}

describe("the budget's change history", () => {
  it("logs who inserted, changed and deleted each row, with the row before and after", async () => {
    const { owner, pat, base, account, activity } = await setup();
    const created = await send("POST", `${base}/transactions`, owner.cookie, {
      accountId: account.id,
      date: TODAY,
      amount: "-9007199254740993",
      payeeName: "Big Spender",
      categoryId: null,
    });
    expect(created.status).toBe(201);
    const { id } = await json<{ id: string }>(created);
    expect(
      (await send("PATCH", `${base}/transactions/${id}`, pat.cookie, { memo: "by Pat" })).status,
    ).toBe(200);
    expect((await send("DELETE", `${base}/transactions/${id}`, pat.cookie)).status).toBe(204);

    const { events } = await activity("?entity=transaction");
    const mine = events.filter((e) => e.rowId === id);
    expect(mine.map((e) => [e.op, e.actor?.name, e.actor?.avatarColor])).toEqual([
      ["delete", "Pat", 2],
      ["update", "Pat", 2],
      ["insert", "Owner", 1],
    ]);
    const [deleted, updated, inserted] = mine;
    // Money comes back as exact text, beyond what a JS number holds.
    expect(inserted?.after?.amount).toBe("-9007199254740993");
    expect(inserted?.before).toBeNull();
    expect(updated?.before?.memo).toBe("");
    expect(updated?.after?.memo).toBe("by Pat");
    expect(deleted?.after).toBeNull();
    expect(deleted?.before?.memo).toBe("by Pat");
  });

  it("filters by member and pages with a cursor, newest first", async () => {
    const { owner, pat, base, activity } = await setup();
    for (const month of ["2026-10", "2026-11", "2026-12"]) {
      await send("PUT", `${base}/months/${month}/note`, pat.cookie, { note: `note ${month}` });
    }
    const patOnly = await activity(`?member=${pat.userId}`);
    expect(patOnly.events.every((e) => e.actor?.userId === pat.userId)).toBe(true);
    expect(patOnly.events.filter((e) => e.entity === "month_note")).toHaveLength(3);

    const first = await activity(`?member=${pat.userId}&entity=month_note&limit=2`);
    expect(first.events.map((e) => e.after?.note)).toEqual(["note 2026-12", "note 2026-11"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await activity(
      `?member=${pat.userId}&entity=month_note&limit=2&cursor=${first.nextCursor}`,
    );
    expect(second.events.map((e) => e.after?.note)).toEqual(["note 2026-10"]);
    expect(second.nextCursor).toBeNull();

    const bad = await send("GET", `${base}/activity?cursor=nope`, owner.cookie);
    expect(bad.status).toBe(400);
  });

  it("skips bookkeeping-only changes and keeps secrets out", async () => {
    const { owner, budget, base, activity } = await setup();
    // Opening a budget stamps last_used_at only.
    await send("GET", base, owner.cookie);
    const { events } = await activity();
    expect(events.filter((e) => e.entity === "budget_member" && e.op === "update")).toEqual([]);
    const invitation = events.find((e) => e.entity === "budget_invitation");
    expect(invitation?.after).not.toHaveProperty("token_hash");
    expect(invitation?.after?.budget_id).toBe(budget.id);
  });

  it("forgets a deleted user's id but keeps the shared budget's history", async () => {
    const { pat, base, account, activity } = await setup();
    const created = await send("POST", `${base}/transactions`, pat.cookie, {
      accountId: account.id,
      date: TODAY,
      amount: "-100",
      payeeName: "Shop",
      categoryId: null,
    });
    const { id } = await json<{ id: string }>(created);
    expect(
      (await send("POST", "/v1/me/delete", pat.cookie, { password: "correct-horse-battery" }))
        .status,
    ).toBe(204);
    const insert = (await activity("?entity=transaction")).events.find((e) => e.rowId === id);
    expect(insert).toMatchObject({ op: "insert", actor: null });
    const [row] = await db.select().from(transaction).where(eq(transaction.id, id));
    expect(row).toMatchObject({ createdByUserId: null, updatedByUserId: null });
    expect(
      await db.select().from(auditEvent).where(eq(auditEvent.actorUserId, pat.userId)),
    ).toEqual([]);
  });

  it("shows invitations only to the owner, as the members list does", async () => {
    const { owner, pat, budget, base, activity } = await setup();
    const viewer = await shareBudget(app, owner.cookie, budget.id, { name: "Vi", role: "viewer" });
    const invited = (events: Event[]) => events.filter((e) => e.entity === "budget_invitation");
    expect(invited((await activity()).events).length).toBeGreaterThan(0);
    expect(invited((await activity("", pat.cookie)).events)).toEqual([]);
    expect(invited((await activity("?entity=budget_invitation", viewer.cookie)).events)).toEqual(
      [],
    );
    expect((await send("GET", `${base}/activity`, viewer.cookie)).status).toBe(200);
  });

  it("is only for the budget's members", async () => {
    const { base } = await setup();
    const stranger = await signUp(app);
    expect((await send("GET", `${base}/activity`, stranger.cookie)).status).toBe(404);
  });

  it("goes with a deleted budget", async () => {
    const { owner, budget, base } = await setup();
    expect((await send("DELETE", base, owner.cookie)).status).toBe(204);
    expect(await db.select().from(auditEvent).where(eq(auditEvent.budgetId, budget.id))).toEqual(
      [],
    );
  });

  it("lists one transaction's history with its split lines, deleted or not", async () => {
    const { owner, pat, base, account } = await setup();
    const { id } = await json<{ id: string }>(
      await send("POST", `${base}/transactions`, owner.cookie, {
        accountId: account.id,
        date: TODAY,
        amount: "-3000",
        payeeName: "Shop",
        categoryId: null,
        subtransactions: [
          { amount: "-1000", categoryId: null, memo: "a" },
          { amount: "-2000", categoryId: null, memo: "b" },
        ],
      }),
    );
    await send("PATCH", `${base}/transactions/${id}`, pat.cookie, { memo: "split" });
    await send("DELETE", `${base}/transactions/${id}`, pat.cookie);
    const { events } = await json<{ events: Event[] }>(
      await send("GET", `${base}/transactions/${id}/history`, owner.cookie),
    );
    expect(events[0]).toMatchObject({ entity: "transaction", op: "insert" });
    expect(events.filter((e) => e.entity === "sub_transaction" && e.op === "insert")).toHaveLength(
      2,
    );
    expect(events.at(-1)).toMatchObject({ entity: "transaction", op: "delete" });
    expect(events.find((e) => e.after?.memo === "split")?.actor?.name).toBe("Pat");
  });
});

describe("who entered a transaction", () => {
  type Ref = { userId: string; name: string | null; avatarColor: number | null } | null;
  type Txn = { id: string; enteredBy: Ref; changedBy: Ref; version: number };

  it("names who entered it and, once changed, who changed it last", async () => {
    const { owner, pat, base, account } = await setup();
    const entered = await json<Txn>(
      await send("POST", `${base}/transactions`, owner.cookie, {
        accountId: account.id,
        date: TODAY,
        amount: "-100",
        payeeName: "Shop",
        categoryId: null,
      }),
    );
    expect(entered).toMatchObject({
      enteredBy: { name: "Owner", avatarColor: 1 },
      changedBy: null,
      version: 1,
    });
    const changed = await json<Txn>(
      await send("PATCH", `${base}/transactions/${entered.id}`, pat.cookie, { memo: "x" }),
    );
    expect(changed).toMatchObject({
      enteredBy: { name: "Owner" },
      changedBy: { userId: pat.userId, name: "Pat", avatarColor: 2 },
    });
    expect(changed.version).toBeGreaterThan(1);
    // A split's (or transfer's) own writes on create aren't a change.
    const split = await json<Txn>(
      await send("POST", `${base}/transactions`, owner.cookie, {
        accountId: account.id,
        date: TODAY,
        amount: "-300",
        payeeName: "Shop",
        categoryId: null,
        subtransactions: [
          { amount: "-100", categoryId: null },
          { amount: "-200", categoryId: null },
        ],
      }),
    );
    expect(split).toMatchObject({ enteredBy: { name: "Owner" }, changedBy: null });
    const { transactions } = await json<{ transactions: Txn[] }>(
      await send("GET", `${base}/transactions?accountId=${account.id}`, owner.cookie),
    );
    expect(transactions.find((t) => t.id === entered.id)).toMatchObject({
      enteredBy: { name: "Owner" },
      changedBy: { name: "Pat" },
    });
  });
});

describe("undo conflicts between partners", () => {
  type Txn = { id: string; version: number; memo: string };
  const errorCode = async (res: Response) =>
    (await json<{ error: { code: string; message: string } }>(res)).error;

  it("refuses a stale edit, delete or bulk change, naming who changed it", async () => {
    const { owner, pat, base, account } = await setup();
    const mine = await json<Txn>(
      await send("POST", `${base}/transactions`, owner.cookie, {
        accountId: account.id,
        date: TODAY,
        amount: "-100",
        payeeName: "Shop",
        categoryId: null,
      }),
    );
    // Pat edits it after the owner did.
    const theirs = await json<Txn>(
      await send("PATCH", `${base}/transactions/${mine.id}`, pat.cookie, { memo: "Pat's" }),
    );
    expect(theirs.version).toBeGreaterThan(mine.version);

    const stale = await send("PATCH", `${base}/transactions/${mine.id}`, owner.cookie, {
      memo: "",
      expectedVersion: mine.version,
    });
    expect(stale.status).toBe(409);
    expect(await errorCode(stale)).toEqual({
      code: "STALE_VERSION",
      message: "Pat changed this transaction since, so it wasn't changed back.",
    });
    const staleDelete = await send(
      "DELETE",
      `${base}/transactions/${mine.id}?expectedVersion=${mine.version}`,
      owner.cookie,
    );
    expect(staleDelete.status).toBe(409);
    const staleBulk = await send("POST", `${base}/transactions/bulk`, owner.cookie, {
      selection: { ids: [mine.id] },
      action: { type: "flag", flag: "red" },
      expectedVersions: { [mine.id]: mine.version },
    });
    expect(staleBulk.status).toBe(409);

    // Nothing was overwritten; the current version goes through.
    const ok = await send("PATCH", `${base}/transactions/${mine.id}`, owner.cookie, {
      memo: "",
      expectedVersion: theirs.version,
    });
    expect(ok.status).toBe(200);
    const bulk = await json<{ versions: Record<string, number> }>(
      await send("POST", `${base}/transactions/bulk`, owner.cookie, {
        selection: { ids: [mine.id] },
        action: { type: "flag", flag: "red" },
        expectedVersions: { [mine.id]: (await json<Txn>(ok)).version },
      }),
    );
    expect(bulk.versions[mine.id]).toBeGreaterThan(theirs.version);
    const deleted = await send(
      "DELETE",
      `${base}/transactions/${mine.id}?expectedVersion=${bulk.versions[mine.id]}`,
      owner.cookie,
    );
    expect(deleted.status).toBe(204);
  });

  it("reads previousVersions under the row lock, after a partner's save it waited on", async () => {
    const { owner, base, account } = await setup();
    const row = await json<Txn>(
      await send("POST", `${base}/transactions`, owner.cookie, {
        accountId: account.id,
        date: TODAY,
        amount: "-100",
        payeeName: "Shop",
        categoryId: null,
      }),
    );
    // A partner's write holds the row on its own connection while the owner's edit arrives.
    const other = createDb(testEnv().DATABASE_URL, { max: 1 });
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    let locked: () => void = () => {};
    const isLocked = new Promise<void>((r) => {
      locked = r;
    });
    const partner = other.db.transaction(async (tx) => {
      await tx.update(transaction).set({ memo: "partner" }).where(eq(transaction.id, row.id));
      locked();
      await held;
    });
    await isLocked;
    const edit = send("PATCH", `${base}/transactions/${row.id}`, owner.cookie, { flag: "red" });
    await new Promise((r) => setTimeout(r, 300));
    release();
    await partner;
    await other.close();
    const saved = await json<Txn & { previousVersions: Record<string, number> }>(await edit);
    // The step this edit reports starts after the partner's, so it never covers it.
    expect(saved.previousVersions[row.id]).toBe(row.version + 1);
    expect(saved.version).toBe(row.version + 2);
  });

  it("names the partner when the user's own edits sit on top of their change", async () => {
    const { owner, pat, base, account } = await setup();
    const row = await json<Txn>(
      await send("POST", `${base}/transactions`, owner.cookie, {
        accountId: account.id,
        date: TODAY,
        amount: "-100",
        payeeName: "Shop",
        categoryId: null,
      }),
    );
    await send("PATCH", `${base}/transactions/${row.id}`, pat.cookie, { amount: "-200" });
    await send("PATCH", `${base}/transactions/${row.id}`, owner.cookie, { memo: "mine" });
    const stale = await send("PATCH", `${base}/transactions/${row.id}`, owner.cookie, {
      amount: "-100",
      expectedVersion: row.version,
    });
    expect(stale.status).toBe(409);
    expect((await errorCode(stale)).message).toBe(
      "Pat changed this transaction since, so it wasn't changed back.",
    );
  });

  it("returns a transfer's other side's version, so undoing both sides isn't refused", async () => {
    const { owner, base, account } = await setup();
    const savings = await json<{ id: string }>(
      await send("POST", `${base}/accounts`, owner.cookie, {
        name: "Savings",
        type: "savings",
        balance: "0",
        date: TODAY,
      }),
    );
    type Side = Txn & {
      transferTransactionId: string;
      transferSide: { id: string; version: number };
    };
    const out = await json<Side>(
      await send("POST", `${base}/transactions`, owner.cookie, {
        accountId: account.id,
        date: TODAY,
        amount: "-500",
        categoryId: null,
        transferAccountId: savings.id,
      }),
    );
    // A memo edit on one side is copied to the other, moving its version too.
    const edited = await json<Side>(
      await send("PATCH", `${base}/transactions/${out.id}`, owner.cookie, {
        memo: "move",
        expectedVersion: out.version,
      }),
    );
    expect(edited.transferSide.id).toBe(out.transferTransactionId);
    // What both sides were at just before, so the client knows these steps were its own.
    expect(
      (edited as Side & { previousVersions: Record<string, number> }).previousVersions,
    ).toEqual({ [out.id]: out.version, [out.transferTransactionId]: out.transferSide.version });
    expect(edited.transferSide.version).toBeGreaterThan(out.transferSide.version);
    const otherSide = await send(
      "PATCH",
      `${base}/transactions/${out.transferTransactionId}`,
      owner.cookie,
      { memo: "", expectedVersion: edited.transferSide.version },
    );
    expect(otherSide.status).toBe(200);
  });

  it("refuses to set back an assigned amount a partner changed since", async () => {
    const { owner, pat, base } = await setup();
    const { groups } = await json<{
      groups: { kind: string | null; categories: { id: string }[] }[];
    }>(await send("GET", `${base}/categories`, owner.cookie));
    const categoryId = groups.find((g) => !g.kind)?.categories[0]?.id ?? "";
    const assign = (cookie: string, body: Record<string, unknown>) =>
      send("PUT", `${base}/months/2026-10/categories/${categoryId}`, cookie, {
        today: TODAY,
        ...body,
      });
    expect((await assign(owner.cookie, { assigned: "1000" })).status).toBe(200);
    expect((await assign(pat.cookie, { assigned: "2500" })).status).toBe(200);
    // The owner's undo of their own 0 → 1000 expects 1000.
    const stale = await assign(owner.cookie, { assigned: "0", expectedAssigned: "1000" });
    expect(stale.status).toBe(409);
    expect((await errorCode(stale)).message).toBe(
      "Pat changed this assigned amount since, so it wasn't changed back.",
    );
    expect((await assign(owner.cookie, { assigned: "0", expectedAssigned: "2500" })).status).toBe(
      200,
    );
  });
});

describe("request transactions", () => {
  it("keeps nothing a failed write request wrote, log included", async () => {
    // Its own app: routes can't be added once one has served a request.
    const boom = createTestApp();
    // A route that writes, then fails the way a handler's validation does.
    boom.app.post("/v1/budgets/:budgetId/test-boom", requireAuth, async (c) => {
      await c.var.deps.db.insert(monthNote).values({
        id: crypto.randomUUID(),
        budgetId: c.req.param("budgetId"),
        month: "2026-10-01",
        note: "should vanish",
      });
      throw new AppError(409, "BOOM", "Failed after writing");
    });
    try {
      const { cookie } = await signUp(boom.app);
      const budget = await createBudget(boom.app, cookie);
      const res = await boom.app.request(`/v1/budgets/${budget.id}/test-boom`, {
        method: "POST",
        headers: { cookie },
      });
      expect(res.status).toBe(409);
      expect(await db.select().from(monthNote).where(eq(monthNote.budgetId, budget.id))).toEqual(
        [],
      );
      const notes = await db
        .select()
        .from(auditEvent)
        .where(eq(auditEvent.tableName, "month_note"));
      expect(notes).toEqual([]);
    } finally {
      await boom.close();
    }
  });

  it("logs a scheduled occurrence entered on someone's read with no actor", async () => {
    const { owner, base, account, activity } = await setup();
    const res = await send("POST", `${base}/scheduled-transactions`, owner.cookie, {
      accountId: account.id,
      frequency: "monthly",
      date: "2026-10-05",
      amount: "-500",
      payeeName: "Gym",
      categoryId: null,
      today: TODAY,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    await send("GET", `${base}/transactions?today=2026-10-06`, owner.cookie);
    const entered = (await activity("?entity=transaction")).events.find(
      (e) => e.op === "insert" && e.after?.amount === "-500",
    );
    expect(entered).toMatchObject({ actor: null, source: "scheduled" });
    const [row] = await db.select().from(transaction).where(eq(transaction.amount, -500n));
    expect(row?.createdByUserId).toBeNull();
  });
});
