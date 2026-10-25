import { isCurrencyCode, money } from "@strictbudget/engine";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { accountsQueryOptions } from "@/lib/accounts";
import { aiAttachmentUrl } from "@/lib/ai";
import { useBudget } from "@/lib/budget-context";
import { categoriesQueryOptions } from "@/lib/categories";
import { payeesQueryOptions } from "@/lib/transactions";

type Args = Record<string, unknown>;

const monthName = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

const isRecord = (v: unknown): v is Args =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `"interestRate"` → "Interest rate". */
function humanize(key: string): string {
  const words = key
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Fields that only steer the request (concurrency checks, the client's date, internals). */
const HIDDEN = new Set([
  "today",
  "expectedVersion",
  "expectedAssigned",
  "approved",
  "restore",
  "fxRate",
  "baseAmount",
  "transferSide",
  "fromTransactionId",
]);

/** Money fields, in the budget's currency unless the change names another. */
const MONEY: Record<string, string> = {
  amount: "Amount",
  assigned: "Assign",
  balance: "Balance",
  transferAmount: "Transfer amount",
  minimumPayment: "Minimum payment",
  escrowAmount: "Escrow",
};

/**
 * What a change the assistant wants to make will do, field by field, as the app shows it: names
 * instead of ids, amounts and dates in the budget's formats. Fields it can't put in words (an id
 * it doesn't know) are left out; the assistant's own summary sits above this.
 */
export function AiChangePreview({ toolName, args }: { toolName: string; args: unknown }) {
  const { budget, formatAmount, formatDate } = useBudget();
  const accounts = useQuery(accountsQueryOptions(budget.id));
  const categories = useQuery(categoriesQueryOptions(budget.id));
  const payees = useQuery(payeesQueryOptions(budget.id));

  const accountName = (id: unknown) => accounts.data?.accounts.find((a) => a.id === id)?.name;
  const categoryName = (id: unknown) =>
    categories.data?.groups.flatMap((g) => g.categories).find((c) => c.id === id)?.name;
  const groupName = (id: unknown) => categories.data?.groups.find((g) => g.id === id)?.name;
  const payeeName = (id: unknown) => payees.data?.payees.find((p) => p.id === id)?.name;

  const input = isRecord(args) ? args : {};
  const body = isRecord(input.body) ? input.body : {};
  // Path parameters (the category being assigned to, the month) and body fields together.
  const fields: Args = { ...input, ...body };
  delete fields.body;
  delete fields.summary;
  const accountCurrency = (id: unknown) =>
    accounts.data?.accounts.find((a) => a.id === id)?.currency ?? null;
  /**
   * The currency a money field is in, or null when it can't be known (the row is left out rather
   * than shown in a currency it may not be in). A transaction's amount is in its account's
   * currency and a transfer amount in the other account's; a new account's in its own; money in
   * categories (assigning, moving) is in the budget's.
   */
  const currencyOf = (key: string): string | null => {
    if (toolName === "createAccount") {
      return isCurrencyCode(body.currency) ? body.currency : budget.currency;
    }
    if (key === "transferAmount") return accountCurrency(fields.transferAccountId);
    if (key === "amount" && /Transaction/.test(toolName)) return accountCurrency(fields.accountId);
    if (key === "balance" || key === "minimumPayment" || key === "escrowAmount") {
      return accountCurrency(fields.accountId);
    }
    return budget.currency;
  };

  const rows: Array<[string, ReactNode]> = [];
  // A file from the conversation going onto a transaction: show the file itself.
  if (toolName === "attachFileToTransaction" && typeof fields.attachmentId === "string") {
    rows.push([
      "File",
      <img
        src={aiAttachmentUrl(budget.id, fields.attachmentId)}
        alt=""
        className="max-h-24 rounded-sm bg-muted object-contain"
        onError={(e) => {
          e.currentTarget.hidden = true;
        }}
      />,
    ]);
  }
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined || value === "" || HIDDEN.has(key)) continue;
    if (key in MONEY && (typeof value === "string" || typeof value === "number")) {
      let minor: bigint;
      try {
        minor = BigInt(value);
      } catch {
        continue;
      }
      const currency = currencyOf(key);
      if (!currency || !isCurrencyCode(currency)) continue;
      const label = key === "amount" ? (minor < 0n ? "Outflow" : "Inflow") : MONEY[key];
      const shown = formatAmount(money(minor < 0n && key === "amount" ? -minor : minor, currency));
      rows.push([label ?? humanize(key), <span className="tabular-nums">{shown}</span>]);
      continue;
    }
    const named =
      key === "accountId"
        ? ["Account", accountName(value)]
        : key === "transferAccountId"
          ? ["Transfer with", accountName(value)]
          : key === "categoryId" || key === "pairedCategoryId"
            ? ["Category", categoryName(value)]
            : key === "fromCategoryId"
              ? ["From", categoryName(value)]
              : key === "toCategoryId"
                ? ["To", categoryName(value)]
                : key === "groupId"
                  ? ["Group", groupName(value)]
                  : key === "payeeId"
                    ? ["Payee", payeeName(value)]
                    : null;
    if (named) {
      if (named[1]) rows.push([named[0] as string, named[1]]);
      continue;
    }
    // Any other id this preview can't name means nothing to a person.
    if (/Id$/.test(key) || key === "id") continue;
    if (key === "payeeName") rows.push(["Payee", String(value)]);
    else if ((key === "date" || key === "dateFirst") && typeof value === "string")
      rows.push([key === "date" ? "Date" : "First date", formatDate(value)]);
    else if (key === "month" && typeof value === "string" && /^\d{4}-\d{2}/.test(value))
      rows.push(["Month", monthName.format(new Date(`${value.slice(0, 7)}-01T00:00:00`))]);
    else if (key === "subtransactions" && Array.isArray(value))
      rows.push(["Split", `${value.length} parts`]);
    else if (typeof value === "boolean") rows.push([humanize(key), value ? "Yes" : "No"]);
    else if (typeof value === "string" || typeof value === "number")
      rows.push([
        humanize(key),
        key === "type" || key === "frequency" ? humanize(String(value)) : String(value),
      ]);
  }

  if (rows.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-md bg-muted/60 p-3">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 wrap-break-word font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
