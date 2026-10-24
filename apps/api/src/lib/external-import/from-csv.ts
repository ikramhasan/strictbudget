import { FLAG_COLORS } from "@strictbudget/db/schema";
import {
  type AccountType,
  accountFamily,
  type BudgetFormatSettings,
  type CurrencyCode,
  hasPaymentCategory,
  NUMBER_FORMAT_SPECS,
  parseAmount,
} from "@strictbudget/engine";
import Papa from "papaparse";
import { BACKUP_FORMAT, BACKUP_VERSION, type Backup } from "../backup/schema";
import { AppError } from "../errors";
import {
  categoryFor,
  EXTERNAL_CARD_GROUP,
  EXTERNAL_HIDDEN_GROUP,
  EXTERNAL_INTERNAL_PAYEES,
} from "./convert";
import type { Conversion } from "./from-api";

// The source's export files:
// "<plan> - Plan.csv" (Month, Category Group/Category, Category Group, Category, Assigned,
// Activity, Available) and "<plan> - Register.csv" (Account, Flag, Date, Payee, Category
// Group/Category, Category Group, Category, Memo, Outflow, Inflow, Cleared); tab-separated for
// currencies with a decimal comma. They don't say each account's type, link transfers or keep
// targets, scheduled transactions or approvals, and a flag is written as its name.

const PLAN_COLUMNS = ["Month", "Category Group", "Category", "Assigned"] as const;
const REGISTER_COLUMNS = [
  "Account",
  "Flag",
  "Date",
  "Payee",
  "Category Group",
  "Category",
  "Memo",
  "Outflow",
  "Inflow",
  "Cleared",
] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TRANSFER = "Transfer : ";
const SPLIT = /^Split \((\d+)\/(\d+)\) ?([\s\S]*)$/;

export interface CsvSettings extends BudgetFormatSettings {
  currency: CurrencyCode;
  /** Each account's type, by name; ones left out are guessed. */
  accountTypes?: Record<string, AccountType>;
}

type Row = Record<string, string>;

function parseRows(text: string, file: string, columns: readonly string[]): Row[] {
  const parsed = Papa.parse<Row>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: true,
  });
  const fields = parsed.meta.fields ?? [];
  const missing = columns.filter((c) => !fields.includes(c));
  if (missing.length > 0) {
    throw new AppError(
      400,
      "EXTERNAL_FILE_INVALID",
      `The ${file} file isn't YNAB's: it has no ${missing.map((m) => `"${m}"`).join(", ")} column`,
    );
  }
  return parsed.data;
}

/** The source's formula guard put a backslash before a leading + - = @; take it off again. */
const text = (value: string | undefined) => (value ?? "").replace(/^\\([+\-=@])/, "$1");

/** "$1,234.56", "12,00€", "-$5.00": the number, in the budget's number format, as minor units. */
function amountOf(
  value: string | undefined,
  settings: Pick<CsvSettings, "currency" | "numberFormat">,
): bigint {
  const decimal = NUMBER_FORMAT_SPECS[settings.numberFormat].decimal;
  const raw = (value ?? "").replace(new RegExp(`[^0-9\\-${decimal === "," ? "," : "."}]`, "g"), "");
  if (raw === "" || raw === "-") return 0n;
  try {
    return parseAmount(raw, settings.currency, settings.numberFormat).amount;
  } catch {
    throw new AppError(
      400,
      "EXTERNAL_FILE_INVALID",
      `"${value}" isn't an amount in that number format`,
    );
  }
}

/** A date in the budget's date format as YYYY-MM-DD. */
function dateOf(value: string | undefined, settings: CsvSettings): string {
  const format = settings.dateFormat;
  const digits = (value ?? "").trim();
  const at = (token: string) => {
    const i = format.indexOf(token);
    return digits.slice(i, i + token.length);
  };
  const [y, m, d] = [at("YYYY"), at("MM"), at("DD")];
  if (
    !/^\d{4}$/.test(y) ||
    !/^\d{2}$/.test(m) ||
    !/^\d{2}$/.test(d) ||
    digits.length !== format.length
  ) {
    throw new AppError(
      400,
      "EXTERNAL_FILE_INVALID",
      `"${value}" isn't a date in the format ${format}`,
    );
  }
  return `${y}-${m}-${d}`;
}

/** "Oct 2026" as 2026-10-01. */
function monthOfLabel(value: string | undefined): string {
  const [name, year] = (value ?? "").trim().split(/\s+/);
  const index = MONTHS.indexOf(name ?? "");
  if (index < 0 || !/^\d{4}$/.test(year ?? "")) {
    throw new AppError(400, "EXTERNAL_FILE_INVALID", `"${value}" isn't a month like "Oct 2026"`);
  }
  return `${year}-${String(index + 1).padStart(2, "0")}-01`;
}

/** The accounts in the register, each with its type: the one given, or a guess. */
export function csvAccounts(
  registerText: string,
  planText: string,
  settings: Pick<CsvSettings, "currency" | "numberFormat" | "accountTypes">,
) {
  const accountTypes = settings.accountTypes ?? {};
  const register = parseRows(registerText, "register", REGISTER_COLUMNS);
  const plan = parseRows(planText, "plan", PLAN_COLUMNS);
  const cardNames = new Set(
    plan.filter((r) => r["Category Group"] === EXTERNAL_CARD_GROUP).map((r) => r.Category ?? ""),
  );
  const names: string[] = [];
  const categorized = new Set<string>();
  const balance = new Map<string, bigint>();
  for (const r of register) {
    const name = r.Account ?? "";
    if (!names.includes(name)) names.push(name);
    if (r.Category) categorized.add(name);
    balance.set(
      name,
      (balance.get(name) ?? 0n) + amountOf(r.Inflow, settings) - amountOf(r.Outflow, settings),
    );
  }
  // A card with no transactions is only in the plan file, as its payment category.
  for (const name of cardNames) if (!names.includes(name)) names.push(name);
  return names.sort().map((name) => {
    const given = accountTypes[name];
    const guess: AccountType = cardNames.has(name)
      ? "credit_card"
      : categorized.has(name)
        ? "checking"
        : (balance.get(name) ?? 0n) < 0n
          ? "liability"
          : "asset";
    return { name, type: given ?? guess, guessed: !given };
  });
}

/**
 * The export files in the backup layout: accounts (of the types given or guessed),
 * category groups and categories as the plan file lists them (hidden ones in a "Hidden Categories"
 * group: the file doesn't say which group they were in), every month's assigned amounts, and the
 * register's transactions with splits rebuilt from their "Split (i/n)" memos and transfers paired
 * by account, date and amount.
 */
export function fromExternalCsv(
  input: { plan: string; register: string; name: string },
  settings: CsvSettings,
  now = new Date(),
): Conversion & { accounts: ReturnType<typeof csvAccounts> } {
  const warnings: string[] = [];
  const currency = settings.currency;
  const plan = parseRows(input.plan, "plan", PLAN_COLUMNS);
  const register = parseRows(input.register, "register", REGISTER_COLUMNS);
  const accountList = csvAccounts(input.register, input.plan, settings);

  const accounts: Backup["accounts"] = accountList.map((a, i) => ({
    id: `account:${a.name}`,
    name: a.name,
    type: a.type,
    note: "",
    sortOrder: i,
    closed: false,
    starredSortOrder: null,
    currency,
    interestRate: null,
    minimumPayment: null,
    escrowAmount: null,
    lastReconciledAt: null,
    pairedCategoryId: null,
    paidOffBannerDismissed: false,
    migratedToAccountId: null,
  }));
  const typeOf = new Map(accountList.map((a) => [a.name, a.type]));
  if (accountList.some((a) => a.guessed)) {
    warnings.push(
      `Account types were guessed for ${accountList
        .filter((a) => a.guessed)
        .map((a) => `"${a.name}"`)
        .join(", ")} (YNAB's files don't say).`,
    );
  }
  if (accountList.some((a) => accountFamily(a.type) === "loan")) {
    warnings.push("Loan accounts come over without interest rates, minimum payments or escrow.");
  }

  // Groups and categories in the plan file's order.
  const groups: Backup["categoryGroups"] = [
    { id: "internal", name: "Internal", sortOrder: 0, hidden: false, internal: true, kind: null },
  ];
  const categories: Backup["categories"] = [
    {
      id: "rta",
      groupId: "internal",
      name: "Inflow: Ready to Assign",
      note: "",
      sortOrder: 0,
      hidden: false,
      internalKind: "ready_to_assign",
      linkedAccountId: null,
    },
    {
      id: "uncategorized",
      groupId: "internal",
      name: "Uncategorized",
      note: "",
      sortOrder: 1,
      hidden: false,
      internalKind: "uncategorized",
      linkedAccountId: null,
    },
  ];
  const categoryKey = (group: string, name: string) => `${group}\u0000${name}`;
  const categoryIds = new Map<string, string>();
  const addCategory = (group: string, name: string) => {
    const key = categoryKey(group, name);
    const existing = categoryIds.get(key);
    if (existing) return existing;
    const card = group === EXTERNAL_CARD_GROUP;
    let groupRow = groups.find((g) => g.name === group && !g.internal);
    if (!groupRow) {
      groupRow = {
        id: `group:${group}`,
        name: group,
        sortOrder: card ? -1 : groups.length,
        hidden: false,
        internal: false,
        kind: card ? "credit_card_payments" : null,
      };
      groups.push(groupRow);
    }
    const linked =
      card && hasPaymentCategory(typeOf.get(name) ?? "checking") ? `account:${name}` : null;
    const id = `category:${key}`;
    categories.push({
      id,
      groupId: groupRow.id,
      name,
      note: "",
      sortOrder: categories.filter((c) => c.groupId === groupRow.id).length,
      hidden: group === EXTERNAL_HIDDEN_GROUP,
      internalKind: null,
      linkedAccountId: linked,
    });
    categoryIds.set(key, id);
    return id;
  };
  const assignments: Backup["assignments"] = [];
  let firstMonth: string | null = null;
  for (const r of plan) {
    const month = monthOfLabel(r.Month);
    if (!firstMonth || month < firstMonth) firstMonth = month;
    const id = addCategory(text(r["Category Group"]), text(r.Category));
    const amount = amountOf(r.Assigned, settings);
    if (amount !== 0n)
      assignments.push({ categoryId: id, month, amount: amount.toString(), currency });
  }
  if (plan.some((r) => r["Category Group"] === EXTERNAL_HIDDEN_GROUP)) {
    warnings.push(
      "Hidden categories are in a \"Hidden Categories\" group: YNAB's files don't say which group they were in.",
    );
  }
  // Every card needs a payment category.
  for (const a of accounts) {
    if (!hasPaymentCategory(a.type) || categories.some((c) => c.linkedAccountId === a.id)) continue;
    const id = addCategory(EXTERNAL_CARD_GROUP, a.name);
    const row = categories.find((c) => c.id === id);
    if (row) row.linkedAccountId = a.id;
  }
  for (const c of categories) {
    const group = groups.find((g) => g.id === c.groupId);
    if (group?.kind === "credit_card_payments" && !c.linkedAccountId) {
      warnings.push(`The credit card payment category "${c.name}" has no card of that name.`);
    }
  }

  // Payees by name (names that differ only in case are one).
  const payees: Backup["payees"] = accounts.map((a) => ({
    id: `transfer:${a.name}`,
    name: `Transfer : ${a.name}`,
    internalKind: null,
    transferAccountId: a.id,
    hidden: false,
    categorization: "auto",
    defaultCategoryId: null,
    carriedCategoryId: null,
  }));
  const payeeIds = new Map<string, string>();
  const payeeOf = (name: string): string | null => {
    if (!name) return null;
    const key = name.toLowerCase();
    const existing = payeeIds.get(key);
    if (existing) return existing;
    const id = `payee:${key}`;
    payees.push({
      id,
      name,
      internalKind: EXTERNAL_INTERNAL_PAYEES[name as keyof typeof EXTERNAL_INTERNAL_PAYEES] ?? null,
      transferAccountId: null,
      hidden: false,
      categorization: "auto",
      defaultCategoryId: null,
      carriedCategoryId: null,
    });
    payeeIds.set(key, id);
    return id;
  };
  const categoryOfRow = (r: Row) => {
    const group = text(r["Category Group"]);
    const name = text(r.Category);
    if (!group && !name) return null;
    if (group === "Inflow" && name === "Ready to Assign") return "rta";
    return addCategory(group, name);
  };

  // Rows, splits gathered back together.
  interface Line {
    payee: string;
    categoryId: string | null;
    memo: string;
    amount: bigint;
  }
  interface Entry {
    id: string;
    account: string;
    date: string;
    flag: string;
    cleared: string;
    payee: string;
    categoryId: string | null;
    memo: string;
    amount: bigint;
    lines: Line[];
  }
  const entries: Entry[] = [];
  let open: { entry: Entry; count: number } | null = null;
  for (const [i, r] of register.entries()) {
    const amount = amountOf(r.Inflow, settings) - amountOf(r.Outflow, settings);
    const memo = text(r.Memo);
    const split = SPLIT.exec(memo);
    const base = {
      account: r.Account ?? "",
      date: dateOf(r.Date, settings),
      flag: r.Flag ?? "",
      cleared: r.Cleared ?? "",
    };
    const line: Line = {
      payee: text(r.Payee),
      categoryId: categoryOfRow(r),
      memo: split ? (split[3] ?? "") : memo,
      amount,
    };
    if (
      split &&
      split[1] !== "1" &&
      open &&
      open.entry.account === base.account &&
      open.entry.date === base.date
    ) {
      open.entry.lines.push(line);
      open.entry.amount += amount;
      if (open.entry.lines.length === open.count) open = null;
      continue;
    }
    const entry: Entry = { id: `row:${i}`, ...base, ...line, lines: split ? [line] : [] };
    entries.push(entry);
    open = split && Number(split[2]) > 1 ? { entry, count: Number(split[2]) } : null;
  }
  // A split's payee: its lines' when they agree, else the most common one.
  for (const e of entries) {
    if (e.lines.length === 0) continue;
    const counts = new Map<string, number>();
    for (const l of e.lines) counts.set(l.payee, (counts.get(l.payee) ?? 0) + 1);
    e.payee = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    e.memo = "";
    e.categoryId = null;
  }

  // Transfers, paired by account, date and amount.
  const accountNamed = (payee: string) =>
    payee.startsWith(TRANSFER) && typeOf.has(payee.slice(TRANSFER.length))
      ? payee.slice(TRANSFER.length)
      : null;
  const pairedWith = new Map<string, string>();
  const lineLinks = new Map<string, string>();
  const findOther = (account: string, other: string, date: string, amount: bigint) =>
    entries.find(
      (e) =>
        e.account === other &&
        e.lines.length === 0 &&
        accountNamed(e.payee) === account &&
        e.date === date &&
        e.amount === -amount &&
        !pairedWith.has(e.id) &&
        !lineLinks.has(e.id),
    );
  let unpaired = 0;
  for (const e of entries) {
    if (e.lines.length > 0) {
      for (const [n, l] of e.lines.entries()) {
        const other = accountNamed(l.payee);
        if (!other) continue;
        const match = findOther(e.account, other, e.date, l.amount);
        if (match) lineLinks.set(match.id, `${e.id}:line:${n}`);
        else unpaired++;
      }
      continue;
    }
    const other = accountNamed(e.payee);
    if (!other || pairedWith.has(e.id) || lineLinks.has(e.id)) continue;
    const match = findOther(e.account, other, e.date, e.amount);
    if (match) {
      pairedWith.set(e.id, match.id);
      pairedWith.set(match.id, e.id);
    } else unpaired++;
  }
  if (unpaired > 0) {
    warnings.push(
      `${unpaired} transfer rows had no other side to pair with; they come over as ordinary transactions.`,
    );
  }

  const flags = new Set<string>(FLAG_COLORS);
  const unknownFlags = new Set<string>();
  const flagOf = (flag: string) => {
    if (!flag) return null;
    const color = flag.toLowerCase();
    if (flags.has(color)) return color as Backup["transactions"][number]["flag"];
    unknownFlags.add(flag);
    return null;
  };
  const clearedOf = (value: string): Backup["transactions"][number]["cleared"] =>
    value === "Cleared" ? "cleared" : value === "Reconciled" ? "reconciled" : "uncleared";
  const transferPayee = (name: string) => `transfer:${name}`;
  const isLinked = (e: Entry) => pairedWith.has(e.id) || lineLinks.has(e.id);

  const transactions: Backup["transactions"] = [];
  const subTransactions: Backup["subTransactions"] = [];
  for (const e of entries) {
    const type = typeOf.get(e.account) ?? "checking";
    const linked = isLinked(e);
    const other = linked ? accountNamed(e.payee) : null;
    const otherType = other ? (typeOf.get(other) ?? null) : null;
    transactions.push({
      id: e.id,
      accountId: `account:${e.account}`,
      date: e.date,
      amount: e.amount.toString(),
      currency,
      baseAmount: e.amount.toString(),
      fxRate: null,
      fxRateManual: false,
      payeeId: other ? transferPayee(other) : payeeOf(e.payee),
      categoryId:
        e.lines.length > 0
          ? null
          : categoryFor({
              accountType: type,
              transferType: otherType,
              startingBalance: e.payee === "Starting Balance",
              amount: e.amount,
              categoryId: e.categoryId,
              readyToAssignId: "rta",
              uncategorizedId: "uncategorized",
            }),
      memo: e.memo,
      cleared: clearedOf(e.cleared),
      flag: flagOf(e.flag),
      approved: true,
      transferTransactionId: pairedWith.get(e.id) ?? null,
      transferSubTransactionId: lineLinks.get(e.id) ?? null,
    });
    for (const [n, l] of e.lines.entries()) {
      const lineOther = accountNamed(l.payee);
      const lineLinked = lineOther && [...lineLinks.values()].includes(`${e.id}:line:${n}`);
      const lineOtherType = lineLinked ? (typeOf.get(lineOther) ?? null) : null;
      subTransactions.push({
        id: `${e.id}:line:${n}`,
        transactionId: e.id,
        sortOrder: n,
        amount: l.amount.toString(),
        currency,
        baseAmount: l.amount.toString(),
        payeeId: lineLinked
          ? transferPayee(lineOther)
          : l.payee === e.payee
            ? null
            : payeeOf(l.payee),
        categoryId: categoryFor({
          accountType: type,
          transferType: lineOtherType,
          startingBalance: false,
          amount: l.amount,
          categoryId: l.categoryId,
          readyToAssignId: "rta",
          uncategorizedId: "uncategorized",
        }),
        memo: l.memo,
      });
    }
  }
  if (unknownFlags.size > 0) {
    warnings.push(
      `Flags named ${[...unknownFlags].map((f) => `"${f}"`).join(", ")} were left off: YNAB's files write a named flag by its name, not its colour.`,
    );
  }
  warnings.push(
    "YNAB's files don't carry targets, scheduled transactions, approvals, loan details, account notes, or accounts without transactions (other than credit cards).",
  );

  const first = firstMonth ?? `${now.toISOString().slice(0, 7)}-01`;
  return {
    accounts: accountList,
    warnings,
    backup: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: now.toISOString(),
      budget: {
        name: input.name,
        currency,
        numberFormat: settings.numberFormat,
        currencySymbolPosition: settings.currencySymbolPosition,
        dateFormat: settings.dateFormat,
        createdAt: `${first}T00:00:00.000Z`,
        expectedIncome: null,
        expectedIncomeCurrency: null,
        loanSimulatorBannerDismissed: false,
        aiEnabled: false,
        aiAssistantButton: false,
        viewOrder: null,
      },
      categoryGroups: groups,
      categories,
      accounts,
      loanTerms: [],
      loanCharges: [],
      payees,
      payeeRules: [],
      flagNames: [],
      assignments,
      moneyMoves: [],
      targets: [],
      monthNotes: [],
      views: [],
      transactions,
      subTransactions,
      scheduledTransactions: [],
      scheduledSubTransactions: [],
      fxRateOverrides: [],
      accountImportIds: [],
    },
  };
}
