import { formatAmount } from "@strictbudget/engine";
import { describe, expect, it } from "vitest";
import { type ActivityEvent, type ActivityLookups, actorName, describeEvent } from "./activity";

const lookups: ActivityLookups = {
  account: (id) => ({ chk: "Checking" })[id],
  category: (id) => ({ groc: "Groceries", rent: "Rent" })[id],
  group: () => undefined,
  payee: (id) => ({ shop: "Shop" })[id],
  member: (id) => ({ pat: "Pat" })[id],
  formatAmount: (m) =>
    formatAmount(m, {
      numberFormat: "comma_dot",
      currencySymbolPosition: "before",
      dateFormat: "MM/DD/YYYY",
    }),
  formatDate: (d) => d,
  currency: "USD",
};

const event = (over: Partial<ActivityEvent>): ActivityEvent => ({
  id: "e",
  at: "2026-10-16T12:00:00.000Z",
  actor: { userId: "pat", name: "Pat", avatarColor: 2, removed: false, picture: null, agent: null },
  source: null,
  entity: "transaction",
  rowId: "t",
  op: "update",
  before: null,
  after: null,
  ...over,
});

const txn = {
  id: "t",
  budget_id: "b",
  account_id: "chk",
  payee_id: "shop",
  category_id: "groc",
  amount: "-123456",
  currency: "USD",
  memo: "",
  updated_at: "2026-10-16 12:00:00+00",
  version: "1",
};

describe("Activity lines", () => {
  it("words a changed transaction with only what changed, ids as names and money exact", () => {
    const line = describeEvent(
      event({
        before: txn,
        after: {
          ...txn,
          category_id: "rent",
          memo: "split",
          amount: "-9007199254740993",
          version: "2",
        },
      }),
      lookups,
    );
    expect(line.action).toBe("changed a transaction");
    expect(line.subject).toBe("Shop · -$90,071,992,547,409.93");
    expect(line.changes).toEqual([
      { label: "Category", before: "Groceries", after: "Rent" },
      { label: "Amount", before: "-$1,234.56", after: "-$90,071,992,547,409.93" },
      { label: "Memo", before: "(blank)", after: "split" },
    ]);
  });

  it("lists what a new row had, and names deleted things", () => {
    const line = describeEvent(
      event({ op: "insert", after: { ...txn, category_id: "gone", memo: "" } }),
      lookups,
    );
    expect(line.action).toBe("added a transaction");
    expect(line.changes).toContainEqual({
      label: "Category",
      before: null,
      after: "a deleted category",
    });
  });

  it("words assigned money and membership", () => {
    const assigned = describeEvent(
      event({
        entity: "category_assignment",
        before: { category_id: "groc", month: "2026-10-01", amount: "1000", currency: "USD" },
        after: { category_id: "groc", month: "2026-10-01", amount: "2500", currency: "USD" },
      }),
      lookups,
    );
    expect(assigned).toEqual({
      action: "changed an assigned amount",
      subject: "Groceries (2026-10)",
      changes: [{ label: "Amount", before: "$10.00", after: "$25.00" }],
    });
    const joined = describeEvent(
      event({ entity: "budget_member", op: "insert", after: { user_id: "pat", role: "editor" } }),
      lookups,
    );
    expect(joined).toEqual({ action: "added a member", subject: "Pat", changes: [] });
  });

  it("names who made a change, or why nobody did", () => {
    expect(actorName(event({}))).toBe("Pat");
    expect(actorName(event({ actor: null, source: "scheduled" }))).toBe("Scheduled transactions");
    expect(
      actorName(
        event({
          actor: {
            userId: "x",
            name: null,
            avatarColor: null,
            removed: true,
            picture: null,
            agent: null,
          },
        }),
      ),
    ).toBe("A deleted user");
    expect(
      actorName(
        event({
          actor: {
            userId: "pat",
            name: "Pat",
            avatarColor: 2,
            removed: false,
            picture: null,
            agent: { id: "a", name: "Claude Code", kind: "mcp" },
          },
        }),
      ),
    ).toBe("Claude Code for Pat");
  });
});
