import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";
import { isAboutCategory, templateCategoryNote } from "../../lib/category-template-notes";
import { CATEGORY_TEMPLATES } from "../../lib/category-templates";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Target = {
  cadence: string;
  behavior: string;
  amount: string;
  dueDate: string | null;
  repeatEvery: number | null;
  startMonth: string;
};
type Category = { id: string; name: string; target: Target | null };
type Group = { id: string; name: string; kind: string | null; categories: Category[] };
type TemplateList = {
  templates: {
    id: string;
    name: string;
    categoryCount: number;
    groups: { name: string; categories: { id: string; name: string; amount: string }[] }[];
  }[];
};
type ImportResult = { added: number; categories: { groups: Group[] } };

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;

async function setup(currency = "USD") {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie, { currency });
  const base = `/v1/budgets/${budget.id}`;
  const importTemplate = (templateId: string, categoryIds: string[]) =>
    send("POST", `${base}/category-templates/${templateId}/import`, cookie, {
      categoryIds,
      month: "2026-10",
    });
  const groups = async () =>
    (await json<{ groups: Group[] }>(await send("GET", `${base}/categories`, cookie))).groups;
  return { cookie, base, importTemplate, groups };
}

const allIds = (templateId: string) => {
  const t = CATEGORY_TEMPLATES.find((x) => x.id === templateId);
  if (!t) throw new Error(`no template ${templateId}`);
  return t.groups.flatMap((g, gi) => g.categories.map((_, ci) => `${gi}.${ci}`));
};

describe("category templates", () => {
  it("lists the template gallery with amounts in the budget's minor units", async () => {
    const { cookie, base } = await setup();
    const res = await send("GET", `${base}/category-templates`, cookie);
    expect(res.status).toBe(200);
    const { templates } = await json<TemplateList>(res);
    expect(templates).toHaveLength(39);
    const moving = templates.find((t) => t.id === "moving");
    expect(moving?.categoryCount).toBe(23);
    expect(moving?.groups.map((g) => g.name)).toEqual([
      "Before You Move",
      "Supplies & Services",
      "Helpers & Hospitality",
      "Transportation & Travel",
      "Unexpected",
    ]);
    expect(moving?.groups[0]?.categories[0]).toEqual({
      id: "0.0",
      name: "💰 Security Deposit",
      amount: "100000",
    });
  });

  it("scales example amounts by the currency's exponent", async () => {
    const { cookie, base } = await setup("JPY");
    const { templates } = await json<TemplateList>(
      await send("GET", `${base}/category-templates`, cookie),
    );
    const moving = templates.find((t) => t.id === "moving");
    expect(moving?.groups[0]?.categories[0]?.amount).toBe("1000");
  });

  it("adds new groups at the bottom with balance targets, nothing assigned", async () => {
    const { importTemplate, groups } = await setup();
    const before = (await groups()).map((g) => g.name);
    // Unticking Security Deposit and the whole Unexpected group.
    const picked = allIds("moving").filter((id) => id !== "0.0" && !id.startsWith("4."));
    const res = await importTemplate("moving", picked);
    expect(res.status).toBe(200);
    const body = await json<ImportResult>(res);
    expect(body.added).toBe(17);
    const after = body.categories.groups;
    expect(after.map((g) => g.name)).toEqual([
      ...before,
      "Before You Move",
      "Supplies & Services",
      "Helpers & Hospitality",
      "Transportation & Travel",
    ]);
    const move = after.find((g) => g.name === "Before You Move");
    expect(move?.categories.map((c) => c.name)).toEqual([
      "🗓️ First Month's Rent",
      "📈 Rent/Mortgage Difference",
      "📝 Application Fees",
      "🔌 Utility Set-Up Fees",
      "🛡️ Renter’s/Home Insurance",
    ]);
    expect(move?.categories[0]?.target).toMatchObject({
      cadence: "custom",
      behavior: "balance",
      amount: "120000",
      dueDate: null,
      repeatEvery: null,
      startMonth: "2026-10",
    });
  });

  it("adds a template category without an amount with no target", async () => {
    const { importTemplate } = await setup();
    const body = await json<ImportResult>(await importTemplate("kid", allIds("kid")));
    const readMe = body.categories.groups.find((g) => g.name === "ReadMe!");
    expect(readMe?.categories.map((c) => [c.name, c.target])).toEqual([
      ["📋 About This Template", null],
    ]);
  });

  it("imports our note on each About This Template category", async () => {
    const { importTemplate, groups } = await setup();
    await importTemplate("kid", allIds("kid"));
    const notes = (await groups()).flatMap((g) =>
      g.categories.map((c) => [c.name, (c as Category & { note: string }).note] as const),
    );
    const about = notes.find(([name]) => name === "📋 About This Template");
    expect(about?.[1]).toBe(templateCategoryNote("kid", "📋 About This Template"));
    expect(about?.[1]).toMatch(/spend, some to save and some to give/);
    expect(notes.filter(([name]) => name !== "📋 About This Template" && name.length > 0)).toEqual(
      expect.arrayContaining([["🍭 Spend", ""]]),
    );

    const again = await json<ImportResult>(await importTemplate("kid", allIds("kid")));
    expect(again.added).toBe(0);
  });

  it("has a note for every About This Template category in the gallery", () => {
    const missing = CATEGORY_TEMPLATES.flatMap((t) =>
      t.groups.flatMap((g) =>
        g.categories
          .filter((c) => isAboutCategory(c.name) && !templateCategoryNote(t.id, c.name))
          .map((c) => `${t.id}: ${c.name}`),
      ),
    );
    expect(missing).toEqual([]);
    const abouts = CATEGORY_TEMPLATES.filter((t) =>
      t.groups.some((g) => g.categories.some((c) => c.name.includes("About This Template"))),
    );
    // Both spellings ("📋 About…", "📋About…") are recognised.
    expect(abouts).toHaveLength(29);
  });

  it("fills an existing group's missing categories at its top and skips the rest", async () => {
    const { cookie, base, importTemplate, groups } = await setup();
    await importTemplate("moving", allIds("moving"));
    const move = (await groups()).find((g) => g.name === "Before You Move");
    const truck = (await groups())
      .find((g) => g.name === "Supplies & Services")
      ?.categories.find((c) => c.name === "🚚 Moving Truck");
    const pizza = (await groups())
      .find((g) => g.name === "Helpers & Hospitality")
      ?.categories.find((c) => c.name === "🍕 Pizza & Drinks");
    const fees = move?.categories.find((c) => c.name === "📝 Application Fees");
    if (!move || !truck || !pizza || !fees) throw new Error("import missing");
    await send("PATCH", `${base}/categories/${fees.id}`, cookie, { name: "x renamed" });
    await send("PATCH", `${base}/categories/${pizza.id}`, cookie, { name: "🍕 pizza & drinks" });
    await send("PUT", `${base}/categories/${truck.id}/target`, cookie, {
      cadence: "custom",
      behavior: "balance",
      amount: "99900",
      dueDate: null,
      repeat: null,
      month: "2026-10",
    });

    const body = await json<ImportResult>(await importTemplate("moving", allIds("moving")));
    expect(body.added).toBe(1);
    const after = body.categories.groups;
    expect(after.filter((g) => g.name === "Before You Move")).toHaveLength(1);
    expect(after.find((g) => g.name === "Before You Move")?.categories.map((c) => c.name)).toEqual([
      "📝 Application Fees",
      "💰 Security Deposit",
      "🗓️ First Month's Rent",
      "📈 Rent/Mortgage Difference",
      "x renamed",
      "🔌 Utility Set-Up Fees",
      "🛡️ Renter’s/Home Insurance",
    ]);
    const supplies = after.find((g) => g.name === "Supplies & Services");
    expect(supplies?.categories.find((c) => c.id === truck.id)?.target?.amount).toBe("99900");
    const helpers = after.find((g) => g.name === "Helpers & Hospitality");
    expect(helpers?.categories.map((c) => c.name)).toContain("🍕 pizza & drinks");
    expect(helpers?.categories).toHaveLength(3);
  });

  it("counts hidden groups and categories as already there", async () => {
    const { cookie, base, importTemplate, groups } = await setup();
    await importTemplate("moving", allIds("moving"));
    const unexpected = (await groups()).find((g) => g.name === "Unexpected");
    const supplies = (await groups()).find((g) => g.name === "Supplies & Services");
    const truck = supplies?.categories.find((c) => c.name === "🚚 Moving Truck");
    const settle = unexpected?.categories.find((c) => c.name === "🔑 Settling in Fund");
    if (!unexpected || !truck || !settle) throw new Error("import missing");
    await send("PATCH", `${base}/category-groups/${unexpected.id}`, cookie, { hidden: true });
    await send("PATCH", `${base}/categories/${truck.id}`, cookie, { hidden: true });
    await send("PATCH", `${base}/categories/${settle.id}`, cookie, { name: "x settle" });

    const body = await json<ImportResult>(await importTemplate("moving", allIds("moving")));
    expect(body.added).toBe(1);
    const after = body.categories.groups as (Group & { hidden: boolean })[];
    expect(after.filter((g) => g.name === "Unexpected")).toHaveLength(1);
    const filled = after.find((g) => g.name === "Unexpected");
    expect(filled?.hidden).toBe(true);
    expect(filled?.categories[0]?.name).toBe("🔑 Settling in Fund");
    const trucks = after
      .find((g) => g.name === "Supplies & Services")
      ?.categories.filter((c) => c.name === "🚚 Moving Truck");
    expect(trucks?.map((c) => c.id)).toEqual([truck.id]);
  });

  it("puts several missing categories at the top in the template's order", async () => {
    const { cookie, base, importTemplate, groups } = await setup();
    await importTemplate("moving", allIds("moving"));
    const travel = (await groups()).find((g) => g.name === "Transportation & Travel");
    for (const c of travel?.categories.slice(1) ?? []) {
      await send("PATCH", `${base}/categories/${c.id}`, cookie, { name: `x ${c.name}` });
    }
    const body = await json<ImportResult>(await importTemplate("moving", allIds("moving")));
    expect(
      body.categories.groups
        .find((g) => g.name === "Transportation & Travel")
        ?.categories.map((c) => c.name),
    ).toEqual(["🛏️ Hotel", "🥪 Grab & Go Meals", "⛽ Fuel", "x 🛏️ Hotel", "x 🥪 Grab & Go Meals"]);
  });

  it("adds a category again when the plan has it only in another group", async () => {
    const { cookie, base, importTemplate, groups } = await setup();
    await importTemplate("moving", allIds("moving"));
    const all = await groups();
    const fuel = all
      .find((g) => g.name === "Transportation & Travel")
      ?.categories.find((c) => c.name === "⛽ Fuel");
    const bills = all.find((g) => g.name === "Bills");
    if (!fuel || !bills) throw new Error("setup missing");
    await send("POST", `${base}/categories/${fuel.id}/move`, cookie, {
      groupId: bills.id,
      beforeCategoryId: null,
    });
    const body = await json<ImportResult>(await importTemplate("moving", allIds("moving")));
    expect(body.added).toBe(1);
    const names = body.categories.groups.flatMap((g) => g.categories.map((c) => c.name));
    expect(names.filter((n) => n === "⛽ Fuel")).toHaveLength(2);
  });

  it("matches an existing group ignoring case", async () => {
    const { cookie, base, importTemplate } = await setup();
    await send("POST", `${base}/category-groups`, cookie, { name: "unexpected" });
    const body = await json<ImportResult>(await importTemplate("moving", ["4.0"]));
    const names = body.categories.groups.map((g) => g.name);
    expect(names.filter((n) => n.toLowerCase() === "unexpected")).toEqual(["unexpected"]);
    expect(body.categories.groups.find((g) => g.name === "unexpected")?.categories).toHaveLength(1);
  });

  it("does nothing when nothing is picked", async () => {
    const { importTemplate, groups } = await setup();
    const before = await groups();
    const body = await json<ImportResult>(await importTemplate("moving", []));
    expect(body.added).toBe(0);
    expect(body.categories.groups).toEqual(before);
  });

  it("rejects ids outside the template and unknown templates", async () => {
    const { importTemplate } = await setup();
    const bad = await importTemplate("moving", ["9.9"]);
    expect(bad.status).toBe(400);
    expect((await json<{ error: { code: string } }>(bad)).error.code).toBe("BAD_REQUEST");
    expect((await importTemplate("no-such-template", [])).status).toBe(404);
  });

  it("hides a budget's templates from non-members", async () => {
    const { base } = await setup();
    const other = await signUp(app);
    expect((await send("GET", `${base}/category-templates`, other.cookie)).status).toBe(404);
    expect(
      (
        await send("POST", `${base}/category-templates/moving/import`, other.cookie, {
          categoryIds: ["0.0"],
          month: "2026-10",
        })
      ).status,
    ).toBe(404);
  });
});
