import type { components } from "@strictbudget/api-client";
import { type CurrencyCode, type Money, money } from "@strictbudget/engine";
import { format, parse } from "date-fns";

export type ActivityEvent = components["schemas"]["ActivityEvent"];
type Values = NonNullable<ActivityEvent["before"]>;

export interface ActivityLookups {
  account: (id: string) => string | undefined;
  category: (id: string) => string | undefined;
  group: (id: string) => string | undefined;
  payee: (id: string) => string | undefined;
  member: (userId: string) => string | undefined;
  formatAmount: (m: Money) => string;
  formatDate: (isoDate: string) => string;
  /** The budget's currency, for rows that carry none. */
  currency: CurrencyCode;
}

export interface ActivityChange {
  label: string;
  before: string | null;
  after: string | null;
}

/** Where an entry's subject is in the app: a category on the plan, or a transaction in its register. */
export type ActivityTarget =
  | { kind: "category"; categoryId: string /** "2026-11" */; month?: string }
  | { kind: "transaction"; accountId: string; transactionId: string };

export interface ActivityLine {
  /** "added a transaction", "changed the category", "deleted a payee rule"… */
  action: string;
  /** What it was about: "Groceries · $30.00", "Rent (Nov 2026)"… */
  subject: string | null;
  changes: ActivityChange[];
  /** Set when the subject still exists and can be opened. */
  target?: ActivityTarget;
}

const NOUNS: Record<string, string> = {
  transaction: "transaction",
  sub_transaction: "split line",
  transaction_attachment: "attachment",
  scheduled_transaction: "scheduled transaction",
  scheduled_sub_transaction: "scheduled split line",
  category: "category",
  category_group: "category group",
  category_assignment: "assigned amount",
  category_target: "target",
  month_note: "month note",
  budget_account: "account",
  account_logo: "account logo",
  loan_terms: "loan details",
  loan_charge: "loan charge",
  payee: "payee",
  payee_rule: "payee rule",
  flag_name: "flag name",
  budget: "budget",
  budget_member: "member",
  budget_invitation: "invitation",
  budget_view: "view",
  fx_rate_override: "exchange rate",
};

export const ACTIVITY_ENTITIES: { value: string; label: string }[] = [
  { value: "transaction,sub_transaction,transaction_attachment", label: "Transactions" },
  { value: "category_assignment", label: "Assigned money" },
  { value: "scheduled_transaction,scheduled_sub_transaction", label: "Scheduled transactions" },
  { value: "category,category_group,category_target", label: "Categories and targets" },
  { value: "budget_account,account_logo,loan_terms,loan_charge", label: "Accounts" },
  { value: "payee,payee_rule", label: "Payees" },
  {
    value:
      "budget,budget_member,budget_invitation,budget_view,month_note,flag_name,fx_rate_override",
    label: "Budget and sharing",
  },
];

/** Columns that are never worth showing: ids, bookkeeping, and amounts shown another way. */
const HIDDEN = new Set([
  "id",
  "budget_id",
  "created_at",
  "updated_at",
  "version",
  "created_by_user_id",
  "updated_by_user_id",
  "created_by_agent_id",
  "updated_by_agent_id",
  "last_used_at",
  "sort_order",
  "currency",
  "base_amount",
  "fx_rate_manual",
  "transfer_transaction_id",
  "transfer_sub_transaction_id",
  "transaction_id",
  "scheduled_transaction_id",
  "inviter_id",
  "user_id",
  "token_hash",
  "storage_key",
  "content_type",
  "byte_size",
  // A payee's bookkeeping, updated behind the scenes as transactions are entered.
  "internal_kind",
  "categorization",
  "carried_category_id",
  "auto_category_id",
  "auto_category_saved",
]);

const LABELS: Record<string, string> = {
  account_id: "Account",
  category_id: "Category",
  group_id: "Group",
  payee_id: "Payee",
  default_category_id: "Default category",
  amount: "Amount",
  memo: "Memo",
  date: "Date",
  date_next: "Next date",
  date_first: "First date",
  cleared: "Status",
  flag: "Flag",
  approved: "Approval",
  name: "Name",
  note: "Note",
  hidden: "Visibility",
  closed: "Status",
  month: "Month",
  role: "Role",
  status: "Status",
  email: "Email",
  frequency: "Repeat",
  fx_rate: "Exchange rate",
  rate: "Exchange rate",
  file_name: "File",
  interest_rate: "Interest rate",
  operator: "Match",
  text: "Text",
};

const humanize = (column: string) =>
  LABELS[column] ?? (column.charAt(0).toUpperCase() + column.slice(1)).replaceAll("_", " ");

const MONEY = new Set(["amount", "balance", "minimum_payment", "escrow_amount"]);

/** Yes/no columns, worded as what they mean: [when true, when false]. */
const BOOLEANS: Record<string, [string, string]> = {
  approved: ["Approved", "Not approved"],
  hidden: ["Hidden", "Shown"],
  closed: ["Closed", "Open"],
};

/** What a new row has unless someone chose otherwise, not worth listing on an insert. */
const DEFAULTS: Record<string, string> = {
  approved: "true",
  hidden: "false",
  closed: "false",
  cleared: "uncleared",
};

/** Columns holding a fixed set of words ("set_aside", "every_other_week"), written as words. */
const ENUMS = new Set([
  "cleared",
  "flag",
  "color",
  "frequency",
  "cadence",
  "behavior",
  "repeat_unit",
  "role",
  "status",
  "delivery",
  "kind",
  "type",
  "operator",
  "pace",
  "auto_assign_method",
]);

const EMPTY = "—";

const words = (value: string) =>
  (value.charAt(0).toUpperCase() + value.slice(1)).replaceAll("_", " ");

/** "2026-11-01" (a month's first day) as "Nov 2026". */
const monthOfDate = (value: string) =>
  format(parse(value.slice(0, 7), "yyyy-MM", new Date()), "MMM yyyy");

const isMonthColumn = (column: string) => column === "month" || column.endsWith("_month");

function show(
  column: string,
  value: string | null,
  row: Values,
  l: ActivityLookups,
): string | null {
  if (value === null || value === "") return null;
  if (MONEY.has(column) && /^-?\d+$/.test(value)) {
    const currency = (row.currency as CurrencyCode | null) ?? l.currency;
    return l.formatAmount(money(BigInt(value), currency));
  }
  if (column === "account_id") return l.account(value) ?? "a deleted account";
  if (column === "category_id" || column === "default_category_id")
    return l.category(value) ?? "a deleted category";
  if (column === "group_id") return l.group(value) ?? "a deleted group";
  if (column === "payee_id") return l.payee(value) ?? "a deleted payee";
  if (isMonthColumn(column) && /^\d{4}-\d{2}/.test(value)) return monthOfDate(value);
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}|$)/.test(value)) return l.formatDate(value.slice(0, 10));
  const phrases = BOOLEANS[column];
  if (phrases && (value === "true" || value === "false"))
    return value === "true" ? phrases[0] : phrases[1];
  if (value === "true") return "Yes";
  if (value === "false") return "No";
  if (column === "interest_rate" && /^\d+(\.\d+)?$/.test(value)) return `${trimZeros(value)}%`;
  if (column === "rate" || column === "fx_rate") return trimZeros(value);
  if (column === "operator" && value === "is") return "Is exactly";
  if (ENUMS.has(column) && /^[a-z]+(_[a-z]+)*$/.test(value)) return words(value);
  return value;
}

/** "5.250" as "5.25", "1.000000000000" as "1". */
const trimZeros = (value: string) => (value.includes(".") ? value.replace(/\.?0+$/, "") : value);

function subjectOf(entity: string, row: Values, l: ActivityLookups): string | null {
  const amount = row.amount ? show("amount", row.amount, row, l) : null;
  switch (entity) {
    case "transaction":
    case "scheduled_transaction": {
      const payee = row.payee_id ? show("payee_id", row.payee_id, row, l) : null;
      return [payee, amount].filter(Boolean).join(" · ") || null;
    }
    case "sub_transaction":
    case "scheduled_sub_transaction": {
      // A split line is told apart by its category; its payee is usually the transaction's.
      const payee = row.payee_id ? show("payee_id", row.payee_id, row, l) : null;
      const category = row.category_id ? show("category_id", row.category_id, row, l) : null;
      return [payee, category, amount].filter(Boolean).join(" · ") || null;
    }
    case "category_assignment":
    case "category_target": {
      const name = row.category_id ? show("category_id", row.category_id, row, l) : null;
      const month = row.month ? ` (${monthOfDate(row.month)})` : "";
      return name ? `${name}${month}` : null;
    }
    case "transaction_attachment":
      return row.file_name ?? null;
    case "month_note":
      return row.month ? monthOfDate(row.month) : null;
    case "budget_member":
      return row.user_id ? (l.member(row.user_id) ?? "someone who has left") : null;
    case "budget_invitation":
      return [row.name, row.email].filter(Boolean).join(" · ") || null;
    case "loan_terms":
    case "loan_charge": {
      const account = row.account_id ? show("account_id", row.account_id, row, l) : null;
      const kind = row.kind ? show("kind", row.kind, row, l) : null;
      const month = row.month ? ` (${monthOfDate(row.month)})` : "";
      return account ? `${[account, kind].filter(Boolean).join(" · ")}${month}` : null;
    }
    case "account_logo":
      return row.account_id ? show("account_id", row.account_id, row, l) : null;
    case "payee_rule": {
      const payee = row.payee_id ? show("payee_id", row.payee_id, row, l) : null;
      const rule = row.text ? `${row.operator === "is" ? "is" : "contains"} “${row.text}”` : null;
      return [payee, rule].filter(Boolean).join(" · ") || null;
    }
    case "flag_name":
      return row.name || (row.color ? show("color", row.color, row, l) : null);
    case "fx_rate_override":
      return row.currency && row.date
        ? `${row.currency} on ${l.formatDate(row.date)}`
        : (row.currency ?? null);
    default:
      return row.name || null;
  }
}

export function changesOf(event: ActivityEvent, l: ActivityLookups): ActivityChange[] {
  const before = event.before ?? {};
  const after = event.after ?? {};
  const columns = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changes: ActivityChange[] = [];
  for (const column of columns) {
    if (HIDDEN.has(column)) continue;
    const b = before[column] ?? null;
    const a = after[column] ?? null;
    if (event.op === "update") {
      if ((b ?? "") === (a ?? "")) continue;
      // A blank on either side of a change reads as a dash.
      changes.push({
        label: humanize(column),
        before: show(column, b, before, l) ?? EMPTY,
        after: show(column, a, after, l) ?? EMPTY,
      });
      continue;
    }
    // Inserts and deletes only list what the row had, leaving out blanks and the usual defaults.
    const value = event.op === "insert" ? a : b;
    if (value === null || value === "" || DEFAULTS[column] === value) continue;
    const shown = show(column, value, event.op === "insert" ? after : before, l);
    changes.push({
      label: humanize(column),
      before: event.op === "insert" ? null : shown,
      after: event.op === "delete" ? null : shown,
    });
  }
  return changes;
}

/**
 * Inserts that bring a deleted row back: undoing a delete restores the row with its own id, so an
 * insert after a delete of the same row is a restore. Returns those inserts' event ids.
 */
export function restoredEvents(events: readonly ActivityEvent[]): ReadonlySet<string> {
  const key = (e: ActivityEvent) => `${e.entity}:${e.rowId}`;
  // Event ids are UUIDv7, so they sort in the order the changes were made.
  const firstDelete = new Map<string, string>();
  for (const e of events) {
    if (e.op !== "delete") continue;
    const seen = firstDelete.get(key(e));
    if (seen === undefined || e.id < seen) firstDelete.set(key(e), e.id);
  }
  const restored = new Set<string>();
  for (const e of events) {
    const deleted = e.op === "insert" ? firstDelete.get(key(e)) : undefined;
    if (deleted !== undefined && deleted < e.id) restored.add(e.id);
  }
  return restored;
}

/** Where `event`'s subject is, while it exists: deleted rows, and rows whose names are gone, have none. */
function targetOf(event: ActivityEvent, l: ActivityLookups): ActivityTarget | undefined {
  const row = event.after;
  if (event.op === "delete" || !row) return undefined;
  if (event.entity === "transaction") {
    const accountId = row.account_id;
    return accountId && l.account(accountId)
      ? { kind: "transaction", accountId, transactionId: event.rowId }
      : undefined;
  }
  const categoryId =
    event.entity === "category"
      ? event.rowId
      : event.entity === "category_assignment" || event.entity === "category_target"
        ? row.category_id
        : null;
  if (!categoryId || !l.category(categoryId)) return undefined;
  const month = event.entity === "category_assignment" ? row.month?.slice(0, 7) : undefined;
  return { kind: "category", categoryId, ...(month ? { month } : {}) };
}

/**
 * `related`: the other changes saved with it (groupEvents), so a transaction whose category was
 * cleared as it was split reads "Split" rather than a blank. `restored`: an insert that brought a
 * deleted row back (`restoredEvents`), which reads "restored", without its fields again.
 */
export function describeEvent(
  event: ActivityEvent,
  l: ActivityLookups,
  related: readonly ActivityEvent[] = [],
  restored = false,
): ActivityLine {
  const noun = NOUNS[event.entity] ?? humanize(event.entity).toLowerCase();
  const row = event.after ?? event.before ?? {};
  const subject = subjectOf(event.entity, row, l);
  const target = targetOf(event, l);
  const split =
    event.entity === "transaction" &&
    related.some((e) => e.entity === "sub_transaction" && e.op === "insert");
  const changes = changesOf(event, l).map((c) =>
    split && c.label === "Category" && c.after === EMPTY ? { ...c, after: "Split" } : c,
  );
  if (event.entity === "budget_member") {
    const action =
      event.op === "insert"
        ? "added a member"
        : event.op === "delete"
          ? "removed a member"
          : "changed a member";
    return { action, subject, changes: event.op === "update" ? changes : [] };
  }
  if (event.entity === "category_assignment" && event.op !== "delete") {
    return {
      action: "changed an assigned amount",
      subject,
      changes: changes.filter((c) => c.label === "Amount"),
      ...(target ? { target } : {}),
    };
  }
  const article = /^[aeiou]/.test(noun) ? "an" : "a";
  const linked = target ? { target } : {};
  if (restored) return { action: `restored ${article} ${noun}`, subject, changes: [], ...linked };
  const verb = event.op === "insert" ? "added" : event.op === "delete" ? "deleted" : "changed";
  return { action: `${verb} ${article} ${noun}`, subject, changes, ...linked };
}

export interface ActivityMoveSide {
  categoryId: string;
  name: string;
  /** Left out once the category is deleted. */
  target?: ActivityTarget;
}

/** Money moved between two categories: "moved $18.75 from Vacation to Entertainment". */
export interface ActivityMove {
  amount: string;
  from: ActivityMoveSide;
  to: ActivityMoveSide;
  /** "Nov 2026" */
  month: string;
}

/**
 * A move (or a cover) as one entry: a save that only changed two categories' Assigned in the same
 * month, one down by exactly what the other went up.
 */
export function moveOf(group: readonly ActivityEvent[], l: ActivityLookups): ActivityMove | null {
  if (group.length !== 2) return null;
  const sides = group.map((e) => {
    if (e.entity !== "category_assignment") return null;
    const row = e.after ?? e.before;
    const amount = (r: Values | null) =>
      r?.amount && /^-?\d+$/.test(r.amount) ? BigInt(r.amount) : 0n;
    if (!row?.category_id || !row.month) return null;
    return {
      event: e,
      categoryId: row.category_id,
      month: row.month.slice(0, 7),
      currency: (row.currency as CurrencyCode | null) ?? l.currency,
      delta: amount(e.after) - amount(e.before),
    };
  });
  const [a, b] = sides;
  if (!a || !b || a.month !== b.month || a.categoryId === b.categoryId) return null;
  if (a.currency !== b.currency || a.delta === 0n || a.delta + b.delta !== 0n) return null;
  const [from, to] = a.delta < 0n ? [a, b] : [b, a];
  const side = (s: typeof a): ActivityMoveSide => {
    const name = l.category(s.categoryId);
    return {
      categoryId: s.categoryId,
      name: name ?? "a deleted category",
      ...(name ? { target: { kind: "category", categoryId: s.categoryId, month: s.month } } : {}),
    };
  };
  return {
    amount: l.formatAmount(money(to.delta, to.currency)),
    from: side(from),
    to: side(to),
    month: monthOfDate(to.month),
  };
}

const LEADS = ["transaction", "scheduled_transaction"];

/**
 * Whether `event` was saved with `group`: one save doesn't change a row twice (beyond filling in a
 * row it adds, which a restore never needs), and never both adds and deletes transactions, so a
 * delete and its undo a second later are two entries.
 */
function savedWith(
  group: readonly ActivityEvent[],
  event: ActivityEvent,
  restored: ReadonlySet<string>,
) {
  // One updates the row the other added, as a save does while it writes it. The two share a
  // timestamp, and ids made in the same millisecond aren't in order, so either may come first.
  const fillIn = (a: ActivityEvent, b: ActivityEvent) =>
    a.op === "insert" && !restored.has(a.id) && b.op === "update";
  const sameRow = (a: ActivityEvent, b: ActivityEvent) =>
    a.entity === b.entity && a.rowId === b.rowId && !fillIn(a, b) && !fillIn(b, a);
  return group.every(
    (other) =>
      !sameRow(other, event) &&
      !(
        LEADS.includes(other.entity) &&
        LEADS.includes(event.entity) &&
        other.op !== "update" &&
        event.op !== "update" &&
        other.op !== event.op
      ),
  );
}

/**
 * Changes saved together (one transaction with its split lines and new payee, one Auto-Assign)
 * as one entry: one request's changes, or for changes made outside a request (`requestId` null),
 * the same job within a couple of seconds, in list order. The lead is the
 * transaction when there is one; changes with nothing to show (bookkeeping only) are left out, as
 * are a restored transaction's split lines, which come back with it. `restored` says which events
 * brought a deleted row back (`restoredEvents`).
 */
export function groupEvents(
  events: readonly ActivityEvent[],
  l: ActivityLookups,
): { lead: ActivityEvent; rest: ActivityEvent[]; restored: ReadonlySet<string> }[] {
  const restored = restoredEvents(events);
  const shown = events.filter((e) => e.op !== "update" || changesOf(e, l).length > 0);
  const actorKey = (e: ActivityEvent) =>
    `${e.source}:${e.actor?.userId ?? ""}:${e.actor?.agent?.name ?? ""}`;
  const groups: ActivityEvent[][] = [];
  for (const event of shown) {
    const group = groups.at(-1);
    const first = group?.[0];
    const together =
      first &&
      (first.requestId || event.requestId
        ? first.requestId === event.requestId
        : actorKey(first) === actorKey(event) &&
          Math.abs(Date.parse(first.at) - Date.parse(event.at)) <= 2000);
    if (group && together && savedWith(group, event, restored)) {
      group.push(event);
    } else {
      groups.push([event]);
    }
  }
  return groups.map((group) => {
    const lead = group.find((e) => LEADS.includes(e.entity)) ?? (group[0] as ActivityEvent);
    const rest = group.filter(
      (e) =>
        e !== lead &&
        !(restored.has(lead.id) && e.entity === "sub_transaction" && e.op === "insert"),
    );
    return { lead, rest, restored };
  });
}

/** Who made a change, for the line: the member, or why nobody did. */
export function actorName(event: ActivityEvent): string {
  if (event.actor) {
    const name = event.actor.name ?? "A deleted user";
    // An agent (an MCP client or Agent Auth agent) acting for the member.
    return event.actor.agent ? agentFor(event.actor.agent.name, name) : name;
  }
  if (event.source === "scheduled") return "Scheduled transactions";
  return "strictbudget";
}

/** "Claude Code for Ada": an agent's change, made on a member's behalf. */
export function agentFor(agentName: string, memberName: string): string {
  return `${agentName} for ${memberName}`;
}

export const activityQueryPrefix = ["activity"] as const;
