import { newId } from "@strictbudget/db";
import { budgetMember, category, categoryGroup } from "@strictbudget/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";
import { STARTER_CATEGORIES } from "../../lib/starter-categories";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Category = { id: string; groupId: string; name: string; note: string; hidden: boolean };
type Group = { id: string; name: string; hidden: boolean; categories: Category[] };
type Tree = { groups: Group[] };
type ErrorBody = { error: { code: string } };

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function setup() {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie);
  const base = `/v1/budgets/${budget.id}`;
  const tree = async (): Promise<Tree> => {
    const res = await send("GET", `${base}/categories`, cookie);
    expect(res.status).toBe(200);
    return (await res.json()) as Tree;
  };
  return { cookie, budget, base, tree };
}

const names = (t: Tree) => t.groups.map((g) => [g.name, g.categories.map((c) => c.name)]);

describe("categories", () => {
  it("seeds a new budget with the starter template", async () => {
    const { tree } = await setup();
    expect(names(await tree())).toEqual(STARTER_CATEGORIES.map((g) => [g.group, g.categories]));
    expect((await tree()).groups.map((g) => g.name)).toEqual(["Bills", "Needs", "Wants"]);
    expect(STARTER_CATEGORIES.flatMap((g) => g.categories)).toHaveLength(12);
  });

  it("starts every starter category with an emoji", () => {
    for (const name of STARTER_CATEGORIES.flatMap((g) => g.categories)) {
      expect(name, name).toMatch(/^\p{Extended_Pictographic}\uFE0F? \S/u);
    }
  });

  it("creates hidden internal categories that the list never shows", async () => {
    const { budget, tree } = await setup();
    const internal = await db
      .select({ kind: category.internalKind, name: category.name })
      .from(category)
      .where(and(eq(category.budgetId, budget.id), isNotNull(category.internalKind)));
    expect(internal).toEqual(
      expect.arrayContaining([
        { kind: "ready_to_assign", name: "Inflow: Ready to Assign" },
        { kind: "uncategorized", name: "Uncategorized" },
      ]),
    );
    const listed = (await tree()).groups.flatMap((g) => g.categories.map((c) => c.name));
    expect(listed).not.toContain("Inflow: Ready to Assign");
  });

  it("adds groups and categories at the end", async () => {
    const { cookie, base, tree } = await setup();
    const res = await send("POST", `${base}/category-groups`, cookie, { name: " Kids " });
    expect(res.status).toBe(201);
    const group = (await res.json()) as Group;
    expect(group).toMatchObject({ name: "Kids", hidden: false, categories: [] });

    for (const name of ["Childcare", "Toys"]) {
      const created = await send("POST", `${base}/categories`, cookie, { groupId: group.id, name });
      expect(created.status).toBe(201);
    }
    expect((await tree()).groups.at(-1)).toMatchObject({
      name: "Kids",
      categories: [{ name: "Childcare" }, { name: "Toys" }],
    });
  });

  it("renames, notes and hides a category", async () => {
    const { cookie, base, tree } = await setup();
    const groceries = (await tree()).groups[1]?.categories[0];
    const res = await send("PATCH", `${base}/categories/${groceries?.id}`, cookie, {
      name: "Food",
      note: "Includes household supplies",
      hidden: true,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      name: "Food",
      note: "Includes household supplies",
      hidden: true,
    });
    expect((await tree()).groups[1]?.categories[0]).toMatchObject({ name: "Food", hidden: true });
  });

  it("renames and hides a group", async () => {
    const { cookie, base, tree } = await setup();
    const bills = (await tree()).groups[0];
    const res = await send("PATCH", `${base}/category-groups/${bills?.id}`, cookie, {
      name: "Fixed",
      hidden: true,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Group;
    expect(body).toMatchObject({ name: "Fixed", hidden: true });
    expect(body.categories).toHaveLength(3);
  });

  it("moves a group before another, and to the end", async () => {
    const { cookie, base, tree } = await setup();
    const [bills, , wants] = (await tree()).groups;

    let res = await send("POST", `${base}/category-groups/${wants?.id}/move`, cookie, {
      beforeGroupId: bills?.id,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Tree).groups.slice(0, 3).map((g) => g.name)).toEqual([
      "Wants",
      "Bills",
      "Needs",
    ]);

    res = await send("POST", `${base}/category-groups/${bills?.id}/move`, cookie, {
      beforeGroupId: null,
    });
    expect((await tree()).groups.map((g) => g.name)).toEqual(["Wants", "Needs", "Bills"]);
  });

  it("moves a category within its group and into another group", async () => {
    const { cookie, base, tree } = await setup();
    const [bills, needs] = (await tree()).groups;
    const [rent, phone] = bills?.categories ?? [];
    const transportation = needs?.categories[1];

    await send("POST", `${base}/categories/${phone?.id}/move`, cookie, {
      groupId: bills?.id,
      beforeCategoryId: rent?.id,
    });
    const res = await send("POST", `${base}/categories/${transportation?.id}/move`, cookie, {
      groupId: bills?.id,
      beforeCategoryId: null,
    });
    expect(res.status).toBe(200);

    const [billsAfter, needsAfter] = (await tree()).groups;
    expect(billsAfter?.categories.map((c) => c.name)).toEqual([
      "📱 Phone & Internet",
      "🏠 Rent/Mortgage",
      "⚡️ Utilities",
      "🚘 Transportation",
    ]);
    expect(billsAfter?.categories.at(-1)?.groupId).toBe(bills?.id);
    expect(needsAfter?.categories.map((c) => c.name)).toEqual([
      "🛒 Groceries",
      "🩺 Medical expenses",
      "😌 Emergency fund",
    ]);

    // A later insert into the old group still lands at the end, after the renumbering.
    await send("POST", `${base}/categories`, cookie, { groupId: needs?.id, name: "Coffee" });
    expect((await tree()).groups[1]?.categories.map((c) => c.name)).toEqual([
      "🛒 Groceries",
      "🩺 Medical expenses",
      "😌 Emergency fund",
      "Coffee",
    ]);
  });

  it("rejects a move before a category from a different group", async () => {
    const { cookie, base, tree } = await setup();
    const [bills, frequent] = (await tree()).groups;
    const res = await send("POST", `${base}/categories/${bills?.categories[0]?.id}/move`, cookie, {
      groupId: bills?.id,
      beforeCategoryId: frequent?.categories[0]?.id,
    });
    expect(res.status).toBe(400);
  });

  it("deletes a category, and a group with its categories", async () => {
    const { cookie, base, tree } = await setup();
    const [bills, frequent] = (await tree()).groups;
    expect(
      (await send("DELETE", `${base}/categories/${bills?.categories[0]?.id}`, cookie)).status,
    ).toBe(204);
    expect((await send("DELETE", `${base}/category-groups/${frequent?.id}`, cookie)).status).toBe(
      204,
    );

    const after = await tree();
    expect(after.groups.map((g) => g.name)).not.toContain("Needs");
    expect(after.groups[0]?.categories.map((c) => c.name)).not.toContain("🏠 Rent/Mortgage");
    const orphans = await db
      .select()
      .from(category)
      .where(eq(category.groupId, frequent?.id ?? ""));
    expect(orphans).toEqual([]);
  });

  it("reports what deleting a category would move", async () => {
    const { cookie, base, tree } = await setup();
    const [rent, electric] = (await tree()).groups[0]?.categories ?? [];
    if (!rent || !electric) throw new Error("starter data missing");
    const account = (await (
      await send("POST", `${base}/accounts`, cookie, {
        name: "Checking",
        type: "checking",
        balance: "10000",
        date: "2026-10-01",
      })
    ).json()) as { id: string };
    await send("PUT", `${base}/months/2026-10/categories/${rent.id}`, cookie, {
      assigned: "500",
      today: "2026-10-02",
    });
    const split = await send("POST", `${base}/transactions`, cookie, {
      accountId: account.id,
      date: "2026-10-02",
      amount: "-300",
      categoryId: null,
      subtransactions: [
        { amount: "-100", categoryId: electric.id },
        { amount: "-200", categoryId: electric.id },
      ],
    });
    expect(split.status).toBe(201);
    await send("POST", `${base}/transactions`, cookie, {
      accountId: account.id,
      date: "2026-10-02",
      amount: "-50",
      categoryId: electric.id,
    });
    const after = (await tree()).groups[0]?.categories ?? [];
    expect(after.find((c) => c.id === rent.id)).toMatchObject({
      hasTransactions: false,
      transactionCount: 0,
      hasAssignedMoney: true,
    });
    // Split lines count one by one.
    expect(after.find((c) => c.id === electric.id)).toMatchObject({
      hasTransactions: true,
      transactionCount: 3,
      hasAssignedMoney: false,
    });
  });

  it("rejects blank names", async () => {
    const { cookie, base } = await setup();
    const res = await send("POST", `${base}/category-groups`, cookie, { name: "  " });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe("VALIDATION_ERROR");
  });

  it("treats internal groups and categories as not found", async () => {
    const { cookie, budget, base } = await setup();
    const [internalGroup] = await db
      .select()
      .from(categoryGroup)
      .where(and(eq(categoryGroup.budgetId, budget.id), eq(categoryGroup.internal, true)));
    const [readyToAssign] = await db
      .select()
      .from(category)
      .where(and(eq(category.budgetId, budget.id), eq(category.internalKind, "ready_to_assign")));

    const attempts = [
      send("PATCH", `${base}/categories/${readyToAssign?.id}`, cookie, { name: "Mine" }),
      send("DELETE", `${base}/categories/${readyToAssign?.id}`, cookie),
      send("POST", `${base}/categories/${readyToAssign?.id}/move`, cookie, {
        groupId: internalGroup?.id,
        beforeCategoryId: null,
      }),
      send("PATCH", `${base}/category-groups/${internalGroup?.id}`, cookie, { hidden: false }),
      send("DELETE", `${base}/category-groups/${internalGroup?.id}`, cookie),
      send("POST", `${base}/categories`, cookie, { groupId: internalGroup?.id, name: "Sneaky" }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);
  });

  it("keeps each budget's categories to its members", async () => {
    const owner = await setup();
    const other = await setup();
    const ownerCategory = (await owner.tree()).groups[0]?.categories[0];
    const ownerGroup = (await owner.tree()).groups[0];

    expect((await send("GET", `${owner.base}/categories`, other.cookie)).status).toBe(404);
    // A member of another budget can't reach this budget's rows through their own budget.
    const attempts = [
      send("PATCH", `${other.base}/categories/${ownerCategory?.id}`, other.cookie, { name: "x" }),
      send("DELETE", `${other.base}/category-groups/${ownerGroup?.id}`, other.cookie),
      send("POST", `${other.base}/categories`, other.cookie, {
        groupId: ownerGroup?.id,
        name: "x",
      }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);
    expect((await owner.tree()).groups[0]?.categories[0]?.name).toBe("🏠 Rent/Mortgage");
  });

  it("lets a partner with editor access manage categories", async () => {
    const owner = await setup();
    const partner = await signUp(app);
    const me = (await (await send("GET", "/v1/me", partner.cookie)).json()) as { id: string };
    await db
      .insert(budgetMember)
      .values({ id: newId(), budgetId: owner.budget.id, userId: me.id, role: "editor" });

    const res = await send("POST", `${owner.base}/category-groups`, partner.cookie, {
      name: "Shared",
    });
    expect(res.status).toBe(201);
  });

  it("deletes categories with the budget", async () => {
    const { cookie, budget, base } = await setup();
    expect((await send("DELETE", base, cookie)).status).toBe(204);
    const left = await db.select().from(category).where(eq(category.budgetId, budget.id));
    expect(left).toEqual([]);
  });
});
