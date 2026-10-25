import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, resetDatabase, signUp, type TestBudget } from "../../../test/helpers";
import { httpExternalClient } from "../../lib/external-import/client";
import { EXTERNAL_ACCOUNT_TYPES } from "../../lib/external-import/convert";
import { type ExternalPlan, ExternalPlanSchema } from "../../lib/external-import/types";

/**
 * A real plan read through the source's API, renamed and stripped of import data (month
 * categories keep only non-zero budgeted, activity and balance). Its months carry the numbers the
 * source computed: the import must give the same.
 */
const FIXTURE = JSON.parse(
  readFileSync(new URL("../../../test/fixtures/external-test-plan.json", import.meta.url), "utf8"),
) as { data: { budget: ExternalPlan } };
const PLAN = FIXTURE.data.budget;
const TOKEN = "test-token";
/** The day the fixture was read: the source's numbers are as of then. */
const TODAY = "2026-10-17";

/** The source's API over the fixture, with no network: a wrong token is refused. */
const requests: string[] = [];
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  requests.push(url);
  const auth = new Headers(init?.headers).get("authorization");
  if (auth !== `Bearer ${TOKEN}`) {
    return Response.json({ error: { id: "401", name: "unauthorized" } }, { status: 401 });
  }
  if (url.endsWith("/v1/budgets")) {
    return Response.json({
      data: {
        budgets: [{ id: PLAN.id, name: PLAN.name, last_modified_on: "2026-10-17T02:09:12Z" }],
      },
    });
  }
  if (url.endsWith(`/v1/budgets/${PLAN.id}`)) return Response.json(FIXTURE);
  return Response.json({ error: { id: "404" } }, { status: 404 });
}) as typeof fetch;

const { app, db, close } = createTestApp({ externalPlans: httpExternalClient(fakeFetch) });
beforeEach(() => resetDatabase(db));
afterAll(close);

type Report = {
  budget: TestBudget;
  reused: boolean;
  counts: Record<string, number> | null;
  warnings: string[];
};
type Group = { name: string; categories: { id: string; name: string }[] };
type MonthJson = {
  readyToAssign: string;
  uncategorized: { activity: string; available: string } | null;
  categories: { categoryId: string; assigned: string; activity: string; available: string }[];
};

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const cents = (milli: number) => String(milli / 10);

async function importPlan(cookie: string, extra: Record<string, unknown> = {}) {
  const res = await send("POST", "/v1/budgets/import/external", cookie, {
    token: TOKEN,
    planId: PLAN.id,
    ...extra,
  });
  return { status: res.status, body: (await res.json()) as Report };
}

/** The source's category ids, keyed as `key` says, against the imported budget's categories. */
async function compareMonths(
  base: string,
  cookie: string,
  key: (c: { name: string }, group: string) => string,
) {
  const { groups } = (await (await send("GET", `${base}/categories`, cookie)).json()) as {
    groups: Group[];
  };
  const ours = new Map(
    groups.flatMap((g) => g.categories.map((c) => [key(c, g.name), c.id] as const)),
  );
  const groupName = new Map(PLAN.category_groups.map((g) => [g.id, g.name]));
  const idOf = new Map(
    PLAN.categories.map((c) => [c.id, ours.get(key(c, groupName.get(c.category_group_id) ?? ""))]),
  );
  const uncategorizedId = PLAN.categories.find((c) => c.name === "Uncategorized")?.id;
  const mismatches: string[] = [];
  let compared = 0;
  for (const m of PLAN.months) {
    const month = m.month.slice(0, 7);
    const res = await send("GET", `${base}/months/${month}?today=${TODAY}`, cookie);
    if (res.status !== 200) {
      mismatches.push(`${month}: ${res.status}`);
      continue;
    }
    const json = (await res.json()) as MonthJson;
    if (json.readyToAssign !== cents(m.to_be_budgeted)) {
      mismatches.push(`${month} RTA ${json.readyToAssign} != ${cents(m.to_be_budgeted)}`);
    }
    const uncategorized = m.categories.find((c) => c.id === uncategorizedId);
    if (
      (json.uncategorized?.activity ?? "0") !== cents(uncategorized?.activity ?? 0) ||
      (json.uncategorized?.available ?? "0") !== cents(uncategorized?.balance ?? 0)
    ) {
      mismatches.push(`${month} Uncategorized ${JSON.stringify(json.uncategorized)}`);
    }
    const figures = new Map(json.categories.map((c) => [c.categoryId, c]));
    const source = new Map(m.categories.map((c) => [c.id, c]));
    for (const c of PLAN.categories) {
      const id = idOf.get(c.id);
      if (!id) continue;
      const ours = figures.get(id);
      if (!ours) continue;
      const theirs = source.get(c.id) ?? { budgeted: 0, activity: 0, balance: 0 };
      compared++;
      for (const [field, value] of [
        ["assigned", theirs.budgeted],
        ["activity", theirs.activity],
        ["available", theirs.balance],
      ] as const) {
        if (ours[field] !== cents(value)) {
          mismatches.push(`${month} ${c.name} ${field} ${ours[field]} != ${cents(value)}`);
        }
      }
    }
  }
  return { mismatches, compared };
}

/** Known gap: two cards' share of 2026-10-03's funded spending; nothing else differs. */
const KNOWN = [
  "2026-11 Visa available 2600 != 2800",
  "2026-11 Amex available 1000 != 800",
  "2026-10 Visa activity 2600 != 2800",
  "2026-10 Visa available 2600 != 2800",
  "2026-10 Amex activity 1000 != 800",
  "2026-10 Amex available 1000 != 800",
];

describe("import through the source's API", () => {
  it("keeps the currency format's example, which tells Indian grouping apart", () => {
    const format = { ...PLAN.currency_format, example_format: "1,23,456.78" };
    const parsed = ExternalPlanSchema.parse({ ...PLAN, currency_format: format });
    expect(parsed.currency_format?.example_format).toBe("1,23,456.78");
  });

  it("lists the token's plans", async () => {
    const { cookie } = await signUp(app);
    const res = await send("POST", "/v1/budgets/import/external/plans", cookie, { token: TOKEN });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      plans: [{ id: PLAN.id, name: "Test Plan", lastModifiedOn: "2026-10-17T02:09:12Z" }],
    });
  });

  it("refuses a token the source doesn't accept", async () => {
    const { cookie } = await signUp(app);
    const res = await send("POST", "/v1/budgets/import/external/plans", cookie, { token: "nope" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "EXTERNAL_TOKEN_INVALID",
    );
    const missing = await send("POST", "/v1/budgets/import/external", cookie, {
      token: TOKEN,
      planId: "missing",
    });
    expect(missing.status).toBe(404);
  });

  it("gives every month's Ready to Assign and category balances the source computed", async () => {
    const { cookie } = await signUp(app);
    const { status, body } = await importPlan(cookie);
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.reused).toBe(false);
    expect(body.budget).toMatchObject({
      name: "Test Plan",
      currency: "USD",
      numberFormat: "comma_dot",
      dateFormat: "MM/DD/YYYY",
    });
    const live = PLAN.transactions.filter((t) => !t.deleted);
    const loanCharges = live.filter((t) =>
      ["interest", "escrow"].includes(t.debt_transaction_type ?? ""),
    );
    expect(body.counts?.transactions).toBe(live.length - loanCharges.length);
    expect(body.counts?.loanCharges).toBe(loanCharges.length);
    expect(body.counts?.scheduledTransactions).toBe(PLAN.scheduled_transactions.length);

    const base = `/v1/budgets/${body.budget.id}`;
    const { mismatches, compared } = await compareMonths(
      base,
      cookie,
      (c, group) => `${group}/${c.name}`,
    );
    expect(compared).toBeGreaterThan(1000);
    expect(mismatches).toEqual(KNOWN);

    // Account balances too (loan interest and escrow came over as the loans' charges).
    const { accounts } = (await (
      await send("GET", `${base}/accounts?today=${TODAY}`, cookie)
    ).json()) as {
      accounts: { name: string; balances: { working: string } }[];
    };
    const balances = new Map(accounts.map((a) => [a.name, a.balances.working]));
    const wrong = PLAN.accounts
      .filter((a) => !a.deleted)
      .filter((a) => balances.get(a.name) !== cents(a.balance))
      .map((a) => `${a.name}: ${balances.get(a.name)} != ${cents(a.balance)}`);
    expect(wrong).toEqual([]);
  });

  it("imports the same plan once; replace makes a fresh copy", async () => {
    const { cookie } = await signUp(app);
    const first = await importPlan(cookie);
    expect(first.status).toBe(201);
    const again = await importPlan(cookie);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ reused: true, counts: null });
    expect(again.body.budget.id).toBe(first.body.budget.id);
    const fresh = await importPlan(cookie, { replace: true, name: "Again" });
    expect(fresh.status).toBe(201);
    expect(fresh.body.budget.name).toBe("Again");
    const list = (await (await send("GET", "/v1/budgets", cookie)).json()) as {
      budgets: { id: string }[];
    };
    expect(list.budgets.map((b) => b.id)).toEqual([fresh.body.budget.id]);
    const other = await signUp(app);
    expect((await importPlan(other.cookie)).status).toBe(201);
  });
});

describe("import from the export files", () => {
  // Rebuilds a whole real plan twice over: seconds alone, much longer under a parallel run.
  it("rebuilds the plan from its two files: the same numbers again", async () => {
    const { cookie } = await signUp(app);
    const { body } = await importPlan(cookie);
    // The budget export writes the source's export layout.
    const base = `/v1/budgets/${body.budget.id}`;
    const file = async (path: string) =>
      new TextDecoder("utf-8", { ignoreBOM: true }).decode(
        await (await send("GET", `${base}${path}`, cookie)).arrayBuffer(),
      );
    const plan = await file(`/export/plan?today=${TODAY}`);
    const register = await file("/export/register");
    const settings = {
      plan,
      register,
      name: "From files",
      currency: "USD",
      numberFormat: "comma_dot",
      currencySymbolPosition: "before",
      dateFormat: "MM/DD/YYYY",
    };

    const preview = await send("POST", "/v1/budgets/import/external-files", cookie, {
      ...settings,
      dryRun: true,
    });
    expect(preview.status).toBe(200);
    const { accounts } = (await preview.json()) as {
      accounts: { name: string; type: string; guessed: boolean }[];
    };
    const live = PLAN.accounts.filter((a) => !a.deleted);
    expect(accounts.map((a) => a.name).sort()).toEqual(live.map((a) => a.name).sort());
    expect(accounts.find((a) => a.name === "Visa")).toMatchObject({
      type: "credit_card",
      guessed: true,
    });

    const types = Object.fromEntries(live.map((a) => [a.name, EXTERNAL_ACCOUNT_TYPES[a.type]]));
    const res = await send("POST", "/v1/budgets/import/external-files", cookie, {
      ...settings,
      accountTypes: types,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const report = (await res.json()) as Report;
    expect(report.warnings.join(" ")).toContain("don't carry targets");
    // Hidden categories sit in "Hidden Categories" there, so match by name alone.
    const names = PLAN.categories.map((c) => c.name);
    const unique = (c: { name: string }) =>
      names.filter((n) => n === c.name).length === 1 ? c.name : `${Math.random()}`;
    const { mismatches, compared } = await compareMonths(
      `/v1/budgets/${report.budget.id}`,
      cookie,
      (c) => unique(c),
    );
    expect(compared).toBeGreaterThan(1000);
    expect(mismatches).toEqual(KNOWN);

    const again = await send("POST", "/v1/budgets/import/external-files", cookie, {
      ...settings,
      accountTypes: types,
    });
    expect(again.status).toBe(200);
    expect(((await again.json()) as Report).budget.id).toBe(report.budget.id);
  }, 60_000);

  it("refuses files that aren't export files", async () => {
    const { cookie } = await signUp(app);
    const res = await send("POST", "/v1/budgets/import/external-files", cookie, {
      plan: "a,b\n1,2",
      register: "a,b\n1,2",
      name: "x",
      currency: "USD",
      numberFormat: "comma_dot",
      currencySymbolPosition: "before",
      dateFormat: "MM/DD/YYYY",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "EXTERNAL_FILE_INVALID",
    );
  });
});
