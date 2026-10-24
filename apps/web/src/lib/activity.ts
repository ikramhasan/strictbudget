import type { components } from "@strictbudget/api-client";
import { type CurrencyCode, type Money, money } from "@strictbudget/engine";

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

export interface ActivityLine {
  /** "added a transaction", "changed the category", "deleted a payee rule"… */
  action: string;
  /** What it was about: "Groceries · $30.00", "Rent (Oct 2026)"… */
  subject: string | null;
  changes: ActivityChange[];
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
]);

const LABELS: Record<string, string> = {
  account_id: "Account",
  category_id: "Category",
  group_id: "Group",
  payee_id: "Payee",
  amount: "Amount",
  memo: "Memo",
  date: "Date",
  date_next: "Next date",
  cleared: "Cleared",
  flag: "Flag",
  approved: "Approved",
  name: "Name",
  note: "Note",
  hidden: "Hidden",
  closed: "Closed",
  month: "Month",
  role: "Role",
  status: "Status",
  email: "Email",
  frequency: "Repeat",
  fx_rate: "Exchange rate",
  file_name: "File",
};

const humanize = (column: string) =>
  LABELS[column] ?? (column.charAt(0).toUpperCase() + column.slice(1)).replaceAll("_", " ");

const MONEY = new Set(["amount", "balance", "minimum_payment", "escrow_amount"]);

function show(
  column: string,
  value: string | null,
  row: Values,
  l: ActivityLookups,
): string | null {
  if (value === null || value === "") return value === "" ? "(blank)" : null;
  if (MONEY.has(column) && /^-?\d+$/.test(value)) {
    const currency = (row.currency as CurrencyCode | null) ?? l.currency;
    return l.formatAmount(money(BigInt(value), currency));
  }
  if (column === "account_id") return l.account(value) ?? "a deleted account";
  if (column === "category_id") return l.category(value) ?? "a deleted category";
  if (column === "group_id") return l.group(value) ?? "a deleted group";
  if (column === "payee_id") return l.payee(value) ?? "a deleted payee";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return l.formatDate(value);
  if (value === "true") return "Yes";
  if (value === "false") return "No";
  return value;
}

function subjectOf(entity: string, row: Values, l: ActivityLookups): string | null {
  const amount = row.amount ? show("amount", row.amount, row, l) : null;
  switch (entity) {
    case "transaction":
    case "scheduled_transaction":
    case "sub_transaction":
    case "scheduled_sub_transaction": {
      const payee = row.payee_id ? show("payee_id", row.payee_id, row, l) : null;
      return [payee, amount].filter(Boolean).join(" · ") || null;
    }
    case "category_assignment":
    case "category_target": {
      const name = row.category_id ? show("category_id", row.category_id, row, l) : null;
      const month = row.month ? ` (${row.month.slice(0, 7)})` : "";
      return name ? `${name}${month}` : null;
    }
    case "transaction_attachment":
      return row.file_name ?? null;
    case "month_note":
      return row.month ? row.month.slice(0, 7) : null;
    case "budget_member":
      return row.user_id ? (l.member(row.user_id) ?? "someone who has left") : null;
    case "budget_invitation":
      return [row.name, row.email].filter(Boolean).join(" · ") || null;
    case "loan_terms":
    case "loan_charge":
    case "account_logo":
      return row.account_id ? show("account_id", row.account_id, row, l) : null;
    default:
      return row.name ?? null;
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
    if (event.op === "update" && b === a) continue;
    // Inserts and deletes only list what the row had.
    if (event.op !== "update" && (event.op === "insert" ? a : b) === null) continue;
    changes.push({
      label: humanize(column),
      before: event.op === "insert" ? null : show(column, b, before, l),
      after: event.op === "delete" ? null : show(column, a, after, l),
    });
  }
  return changes;
}

export function describeEvent(event: ActivityEvent, l: ActivityLookups): ActivityLine {
  const noun = NOUNS[event.entity] ?? humanize(event.entity).toLowerCase();
  const row = event.after ?? event.before ?? {};
  const subject = subjectOf(event.entity, row, l);
  const changes = changesOf(event, l);
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
    };
  }
  const verb = event.op === "insert" ? "added" : event.op === "delete" ? "deleted" : "changed";
  const article = /^[aeiou]/.test(noun) ? "an" : "a";
  return { action: `${verb} ${article} ${noun}`, subject, changes };
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
