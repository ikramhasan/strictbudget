import { newId } from "@strictbudget/db";
import { budgetMember, category } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type View = { id: string; name: string; categoryIds: string[] };
type ViewList = { order: string[]; views: View[] };
type ErrorBody = { error: { code: string; message: string } };

const PRESETS = ["underfunded", "overfunded", "available", "snoozed"];

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;

async function setup() {
  const owner = await signUp(app);
  const budget = await createBudget(app, owner.cookie);
  const base = `/v1/budgets/${budget.id}`;
  const categories = await json<{
    groups: { categories: { id: string }[] }[];
    readyToAssignCategoryId: string;
  }>(await send("GET", `${base}/categories`, owner.cookie));
  const ids = categories.groups.flatMap((g) => g.categories.map((c) => c.id));
  const list = async (cookie = owner.cookie) =>
    json<ViewList>(await send("GET", `${base}/views`, cookie));
  const create = (body: unknown, cookie = owner.cookie) =>
    send("POST", `${base}/views`, cookie, body);
  return { owner, budget, base, ids, rta: categories.readyToAssignCategoryId, list, create };
}

describe("custom views", () => {
  it("lists the presets in their default order until views are added", async () => {
    const { list } = await setup();
    expect(await list()).toEqual({ order: PRESETS, views: [] });
  });

  it("creates, renames, changes and deletes a view", async () => {
    const { base, ids, owner, list, create } = await setup();
    const [a, b, c] = ids;
    const res = await create({ name: "  Bills  ", categoryIds: [a, b, a] });
    expect(res.status).toBe(201);
    const view = await json<View>(res);
    expect(view).toMatchObject({ name: "Bills", categoryIds: [a, b] });
    expect(await list()).toEqual({ order: [...PRESETS, view.id], views: [view] });

    const path = `${base}/views/${view.id}`;
    const renamed = await json<View>(
      await send("PATCH", path, owner.cookie, { name: "Fixed", categoryIds: [c] }),
    );
    expect(renamed).toEqual({ id: view.id, name: "Fixed", categoryIds: [c] });
    // A view with no categories is allowed.
    expect(
      (await json<View>(await send("PATCH", path, owner.cookie, { categoryIds: [] }))).categoryIds,
    ).toEqual([]);

    expect((await send("DELETE", path, owner.cookie)).status).toBe(204);
    expect(await list()).toEqual({ order: PRESETS, views: [] });
    expect((await send("DELETE", path, owner.cookie)).status).toBe(404);
  });

  it("refuses a blank name and a name any view has, ignoring case", async () => {
    const { base, owner, create } = await setup();
    expect((await create({ name: "   ", categoryIds: [] })).status).toBe(400);
    const first = await json<View>(await create({ name: "Bills", categoryIds: [] }));
    for (const name of ["bills", "ALL", "Snoozed", "overfunded", "money available"]) {
      const res = await create({ name, categoryIds: [] });
      expect(res.status).toBe(409);
      expect((await json<ErrorBody>(res)).error).toEqual({
        code: "VIEW_NAME_TAKEN",
        message: "This view name already exists.",
      });
    }
    const other = await json<View>(await create({ name: "Fun", categoryIds: [] }));
    expect(
      (await send("PATCH", `${base}/views/${other.id}`, owner.cookie, { name: "BILLS" })).status,
    ).toBe(409);
    // Keeping its own name (or changing its case) is fine.
    expect(
      (await send("PATCH", `${base}/views/${first.id}`, owner.cookie, { name: "BILLS" })).status,
    ).toBe(200);
  });

  it("only takes the budget's own regular categories", async () => {
    const { ids, rta, create } = await setup();
    const other = await setup();
    expect((await create({ name: "A", categoryIds: [rta] })).status).toBe(400);
    expect((await create({ name: "B", categoryIds: [other.ids[0]] })).status).toBe(400);
    expect((await create({ name: "C", categoryIds: [ids[0], "nope"] })).status).toBe(400);
  });

  it("allows 12 custom views", async () => {
    const { create, list } = await setup();
    for (let i = 1; i <= 12; i++) {
      expect((await create({ name: `V${i}`, categoryIds: [] })).status).toBe(201);
    }
    const res = await create({ name: "V13", categoryIds: [] });
    expect(res.status).toBe(409);
    expect((await json<ErrorBody>(res)).error).toEqual({
      code: "VIEW_LIMIT",
      message: "You have reached the maximum number of custom views available.",
    });
    expect((await list()).views).toHaveLength(12);
  });

  it("comes along on a fresh start, onto the new categories and in the same order", async () => {
    const { base, ids, owner, budget, create } = await setup();
    const [a, b, c] = ids;
    const v1 = await json<View>(await create({ name: "V1", categoryIds: [a, b] }));
    const v2 = await json<View>(await create({ name: "V2", categoryIds: [c] }));
    const order = [v2.id, ...PRESETS, v1.id];
    await send("PUT", `${base}/views/order`, owner.cookie, { order });

    const fresh = await json<{ id: string }>(
      await send("POST", `/v1/budgets/${budget.id}/fresh-start`, owner.cookie, {
        date: "2026-10-15",
        name: "Fresh",
      }),
    );
    const freshBase = `/v1/budgets/${fresh.id}`;
    const copied = await json<ViewList>(await send("GET", `${freshBase}/views`, owner.cookie));
    const names = (id: string) => copied.views.find((v) => v.id === id)?.name ?? id;
    expect(copied.order.map(names)).toEqual(["V2", ...PRESETS, "V1"]);

    const categories = await json<{ groups: { categories: { id: string; name: string }[] }[] }>(
      await send("GET", `${freshBase}/categories`, owner.cookie),
    );
    const nameOf = new Map(
      categories.groups.flatMap((g) => g.categories.map((cat) => [cat.id, cat.name] as const)),
    );
    const oldNames = await json<{ groups: { categories: { id: string; name: string }[] }[] }>(
      await send("GET", `${base}/categories`, owner.cookie),
    );
    const oldNameOf = new Map(
      oldNames.groups.flatMap((g) => g.categories.map((cat) => [cat.id, cat.name] as const)),
    );
    const v1Copy = copied.views.find((v) => v.name === "V1");
    expect(v1Copy?.id).not.toBe(v1.id);
    expect(v1Copy?.categoryIds.map((id) => nameOf.get(id))).toEqual(
      [a, b].map((id) => oldNameOf.get(id ?? "")),
    );
  });

  it("reorders presets and custom views together; new views go last", async () => {
    const { base, owner, create, list } = await setup();
    const a = await json<View>(await create({ name: "A", categoryIds: [] }));
    const order = [a.id, "snoozed", "underfunded", "available", "overfunded"];
    const res = await send("PUT", `${base}/views/order`, owner.cookie, { order });
    expect(res.status).toBe(200);
    expect((await json<ViewList>(res)).order).toEqual(order);

    const b = await json<View>(await create({ name: "B", categoryIds: [] }));
    expect((await list()).order).toEqual([...order, b.id]);
    await send("DELETE", `${base}/views/${a.id}`, owner.cookie);
    expect((await list()).order).toEqual([
      "snoozed",
      "underfunded",
      "available",
      "overfunded",
      b.id,
    ]);

    // Every view exactly once.
    for (const bad of [
      ["snoozed", "underfunded", "available", "overfunded"],
      ["snoozed", "underfunded", "available", "overfunded", b.id, b.id],
      ["snoozed", "underfunded", "available", "all", b.id],
      ["snoozed", "underfunded", "available", "overfunded", b.id, "x"],
    ]) {
      expect((await send("PUT", `${base}/views/order`, owner.cookie, { order: bad })).status).toBe(
        400,
      );
    }
  });

  it("keeps hidden categories and drops deleted ones", async () => {
    const { base, ids, owner, create, list } = await setup();
    const [a, b] = ids as [string, string];
    const view = await json<View>(await create({ name: "A", categoryIds: [a, b] }));
    await send("PATCH", `${base}/categories/${a}`, owner.cookie, { hidden: true });
    expect((await list()).views[0]?.categoryIds).toEqual([a, b]);
    await db.delete(category).where(eq(category.id, b));
    expect((await list()).views[0]?.categoryIds).toEqual([a]);
    expect(view.id).toBe((await list()).views[0]?.id);
  });

  it("is shared with partners and hidden from non-members", async () => {
    const { budget, base, create, list } = await setup();
    const view = await json<View>(await create({ name: "A", categoryIds: [] }));
    const partner = await signUp(app);
    const me = await json<{ id: string }>(await send("GET", "/v1/me", partner.cookie));
    await db
      .insert(budgetMember)
      .values({ id: newId(), budgetId: budget.id, userId: me.id, role: "editor" });
    expect((await list(partner.cookie)).views).toEqual([view]);
    expect(
      (await send("PATCH", `${base}/views/${view.id}`, partner.cookie, { name: "B" })).status,
    ).toBe(200);

    const stranger = await signUp(app);
    expect((await send("GET", `${base}/views`, stranger.cookie)).status).toBe(404);
    expect((await create({ name: "C", categoryIds: [] }, stranger.cookie)).status).toBe(404);
    expect((await send("DELETE", `${base}/views/${view.id}`, stranger.cookie)).status).toBe(404);
    expect(
      (
        await send("PUT", `${base}/views/order`, stranger.cookie, {
          order: [...PRESETS, view.id],
        })
      ).status,
    ).toBe(404);
  });
});
