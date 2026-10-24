import {
  ACCOUNT_TYPES,
  type CsvDateFormat,
  type CurrencyCode,
  LOAN_CHARGE_KINDS,
  LOAN_CHARGE_STATUSES,
  PAYEE_CATEGORIZATIONS,
  PAYEE_RULE_OPERATORS,
  SCHEDULE_FREQUENCIES,
} from "@strictbudget/engine";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { budget } from "./budget";
import { category } from "./category";
import { timestamps } from "./columns";

// Better Auth owns the `account` table (logins), so this one is `budget_account`.
export const budgetAccount = pgTable(
  "budget_account",
  {
    id: text().primaryKey(),
    budgetId: text()
      .notNull()
      .references(() => budget.id, { onDelete: "cascade" }),
    name: text().notNull(),
    type: text({ enum: ACCOUNT_TYPES }).notNull(),
    note: text().notNull().default(""),
    /** Display order in the sidebar (ascending; gaps allowed). */
    sortOrder: integer().notNull(),
    closed: boolean().notNull().default(false),
    /**
     * Position in the sidebar's Starred group (ascending); null when not starred. Shared by
     * everyone on the budget. Closing the account clears it.
     */
    starredSortOrder: integer(),
    /** Currency of every native amount in this account; loans are always in the budget's. */
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    /** Loan accounts: annual interest rate in percent, e.g. "6.125". */
    interestRate: numeric({ precision: 6, scale: 3 }),
    /** Loan accounts: monthly minimum payment, in `currency` minor units. */
    minimumPayment: bigint({ mode: "bigint" }),
    /** Loan accounts: monthly escrow, in `currency` minor units. */
    escrowAmount: bigint({ mode: "bigint" }),
    lastReconciledAt: timestamp({ withTimezone: true }),
    /**
     * Loan accounts: the paired category its payments come out of. One loan per category;
     * deleting the category unpairs it.
     */
    pairedCategoryId: text().references((): AnyPgColumn => category.id, { onDelete: "set null" }),
    paidOffBannerDismissed: boolean().notNull().default(false),
    /**
     * The CSV import's "Remember setting for this account": the column mapping, options and date
     * format, for files with these column names.
     */
    csvImportSettings: jsonb().$type<CsvImportSettings>(),
    /** The same for OFX/QFX and QIF files: their three options. */
    statementImportSettings: jsonb().$type<StatementImportSettings>(),
    /**
     * A tracking liability updated to a loan account: the new loan. The original stays closed
     * with its history, which the loan's page shows.
     */
    migratedToAccountId: text().references((): AnyPgColumn => budgetAccount.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    index("budget_account_budget_id_idx").on(t.budgetId),
    uniqueIndex("budget_account_paired_category_idx").on(t.pairedCategoryId),
  ],
);

/**
 * A loan's interest rate, minimum payment and escrow from `month` on (a change applies to that
 * month and later). The account's own columns hold the latest.
 */
export const loanTerms = pgTable(
  "loan_terms",
  {
    id: text().primaryKey(),
    accountId: text()
      .notNull()
      .references(() => budgetAccount.id, { onDelete: "cascade" }),
    /** First day of the month, YYYY-MM-01. */
    month: date({ mode: "string" }).notNull(),
    interestRate: numeric({ precision: 6, scale: 3 }),
    minimumPayment: bigint({ mode: "bigint" }),
    escrowAmount: bigint({ mode: "bigint" }),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("loan_terms_account_month_idx").on(t.accountId, t.month)],
);

/**
 * A loan month's interest or escrow set by hand or fixed by Update Balance. Months without a row
 * are estimated from the loan's terms.
 */
export const loanCharge = pgTable(
  "loan_charge",
  {
    id: text().primaryKey(),
    accountId: text()
      .notNull()
      .references(() => budgetAccount.id, { onDelete: "cascade" }),
    /** First day of the month, YYYY-MM-01. */
    month: date({ mode: "string" }).notNull(),
    kind: text({ enum: LOAN_CHARGE_KINDS }).notNull(),
    /** Minor units added to the debt (positive). */
    amount: bigint({ mode: "bigint" }).notNull(),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    status: text({ enum: LOAN_CHARGE_STATUSES }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("loan_charge_account_month_kind_idx").on(t.accountId, t.month, t.kind)],
);

/** Payees the app creates itself; people can't rename or merge them. */
export const INTERNAL_PAYEE_KINDS = [
  "starting_balance",
  "manual_balance_adjustment",
  "reconciliation_balance_adjustment",
  /** A foreign-currency account's revaluation: base amount only, native zero. */
  "fx_revaluation",
] as const;
export type InternalPayeeKind = (typeof INTERNAL_PAYEE_KINDS)[number];

export const payee = pgTable(
  "payee",
  {
    id: text().primaryKey(),
    budgetId: text()
      .notNull()
      .references(() => budget.id, { onDelete: "cascade" }),
    name: text().notNull(),
    internalKind: text({ enum: INTERNAL_PAYEE_KINDS }),
    /**
     * Set on an account's "Transfer : <account>" payee. Its name follows the account's, so it's
     * left out of the unique name index (two accounts may share a name).
     */
    transferAccountId: text().references(() => budgetAccount.id, { onDelete: "cascade" }),
    /** Hidden payees aren't suggested in the payee field, but typing the exact name still uses them. */
    hidden: boolean().notNull().default(false),
    /** How a new transaction for this payee gets its category. */
    categorization: text({ enum: PAYEE_CATEGORIZATIONS }).notNull().default("auto"),
    /** The "Always use my choice" category. */
    defaultCategoryId: text().references(() => category.id, { onDelete: "set null" }),
    /**
     * An auto-categorization default from before the payee's own history, copied by a fresh start
     * (which leaves the transactions behind). The history's two-of-three rule builds on it.
     */
    carriedCategoryId: text().references(() => category.id, { onDelete: "set null" }),
    /**
     * The auto-categorization default as stored state: updated when one of the payee's
     * transactions is added or edited, left alone on a delete. Only read once
     * `autoCategorySaved`; until then the default is replayed from the payee's history (with
     * `carriedCategoryId`).
     */
    autoCategoryId: text().references(() => category.id, { onDelete: "set null" }),
    autoCategorySaved: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("payee_budget_id_idx").on(t.budgetId),
    // Payee names are case-insensitive: "Costco" and "costco" are the same payee.
    uniqueIndex("payee_name_per_budget_idx")
      .on(t.budgetId, sql`lower(${t.name})`)
      .where(sql`${t.transferAccountId} is null`),
    uniqueIndex("payee_transfer_account_idx").on(t.transferAccountId),
    uniqueIndex("payee_internal_kind_per_budget_idx")
      .on(t.budgetId, t.internalKind)
      .where(sql`${t.internalKind} is not null`),
  ],
);

/**
 * A renaming rule: an imported payee whose name meets it is renamed to `payeeId`. Transfer payees
 * take rules too. `position` orders a payee's rules on
 * screen (a combine appends the merged payees' rules after the target's); `createdAt` decides which
 * rule wins when several payees' rules match (the newest).
 */
export const payeeRule = pgTable(
  "payee_rule",
  {
    id: text().primaryKey(),
    budgetId: text()
      .notNull()
      .references(() => budget.id, { onDelete: "cascade" }),
    payeeId: text()
      .notNull()
      .references(() => payee.id, { onDelete: "cascade" }),
    operator: text({ enum: PAYEE_RULE_OPERATORS }).notNull(),
    text: text().notNull(),
    position: integer().notNull(),
    ...timestamps,
  },
  (t) => [
    index("payee_rule_budget_id_idx").on(t.budgetId),
    index("payee_rule_payee_id_idx").on(t.payeeId),
  ],
);

export const CLEARED_STATES = ["uncleared", "cleared", "reconciled"] as const;
export type ClearedState = (typeof CLEARED_STATES)[number];

/** Each budget can name these (see `flagName`). */
export const FLAG_COLORS = ["red", "orange", "yellow", "green", "blue", "purple"] as const;
export type FlagColor = (typeof FLAG_COLORS)[number];

/**
 * A budget's name for a flag color (e.g. red = "Reimbursable"), shared by everyone on the budget.
 * Colors without a row have no name.
 */
export const flagName = pgTable(
  "flag_name",
  {
    id: text().primaryKey(),
    budgetId: text()
      .notNull()
      .references(() => budget.id, { onDelete: "cascade" }),
    color: text({ enum: FLAG_COLORS }).notNull(),
    name: text().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("flag_name_budget_color_idx").on(t.budgetId, t.color)],
);

export const transaction = pgTable(
  "transaction",
  {
    id: text().primaryKey(),
    budgetId: text()
      .notNull()
      .references(() => budget.id, { onDelete: "cascade" }),
    accountId: text()
      .notNull()
      .references(() => budgetAccount.id, { onDelete: "cascade" }),
    /** Calendar date, YYYY-MM-DD. */
    date: date({ mode: "string" }).notNull(),
    /** Minor units of `currency` (the account's); negative is an outflow. */
    amount: bigint({ mode: "bigint" }).notNull(),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    /**
     * `amount` in the budget's currency: what the budget's math uses. Equal to `amount` in an
     * account in the budget's currency; otherwise converted once at `fxRate` and kept (a rate
     * lock: later rate changes don't move it). A revaluation has `amount` 0 and only this.
     */
    baseAmount: bigint({ mode: "bigint" }).notNull(),
    /** "1 `currency` = fxRate budget currency"; null in an account in the budget's currency. */
    fxRate: numeric({ precision: 30, scale: 12 }),
    /** The rate was typed by hand, so a date or account change doesn't look it up again. */
    fxRateManual: boolean().notNull().default(false),
    payeeId: text().references(() => payee.id, { onDelete: "set null" }),
    /**
     * Null for off-budget accounts, credit-card starting debt and transfers between two budget
     * accounts (or two tracking accounts).
     */
    // No action (checked at statement end): a category with transactions can't be deleted on its
    // own, but whole-budget/account cascades still work.
    categoryId: text().references(() => category.id),
    memo: text().notNull().default(""),
    cleared: text({ enum: CLEARED_STATES }).notNull().default("uncleared"),
    /** Per side on transfers, like memo and cleared. */
    flag: text({ enum: FLAG_COLORS }),
    approved: boolean().notNull().default(true),
    /**
     * The other side of a transfer, in the account named by this transaction's transfer payee.
     * Both sides point at each other; their amounts are always opposite.
     */
    transferTransactionId: text().references((): AnyPgColumn => transaction.id, {
      onDelete: "set null",
    }),
    /**
     * Set instead of `transferTransactionId` when the other side is a line of a split: that line
     * owns the date and amount, so they're edited from the split.
     */
    transferSubTransactionId: text().references((): AnyPgColumn => subTransaction.id, {
      onDelete: "set null",
    }),
    /**
     * Who entered it and who changed it last, set by the `strictbudget_stamp_row`
     * trigger from the request's actor; null when no one did (a scheduled occurrence entered on
     * read) or once their user is deleted. Not foreign keys, like `audit_event`'s ids.
     */
    createdByUserId: text(),
    updatedByUserId: text(),
    /**
     * The agent (`connected_agent`) that entered it or changed it last for that user, when one
     * did; null for the user's own changes. Not foreign keys either.
     */
    createdByAgentId: text(),
    updatedByAgentId: text(),
    /** Bumped by the trigger on every real change: undo sends it to detect a partner's edit. */
    version: integer().notNull().default(1),
    /**
     * From a file import: its import id (`EC:<amount>:<date>:<n>`) and the payee as the file named
     * it, before renaming rules.
     */
    importId: text(),
    importedPayee: text(),
    /**
     * A matched transaction: the imported row folded into this one, and what this one was before,
     * so Unmatch can split them again.
     */
    matchedImport: jsonb().$type<MatchedImport>(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("transaction_transfer_transaction_idx").on(t.transferTransactionId),
    uniqueIndex("transaction_transfer_sub_transaction_idx").on(t.transferSubTransactionId),
    index("transaction_account_date_idx").on(t.accountId, t.date),
    // Reports read a budget's transactions by date range.
    index("transaction_budget_date_idx").on(t.budgetId, t.date),
    index("transaction_category_id_idx").on(t.categoryId),
    index("transaction_payee_id_idx").on(t.payeeId),
  ],
);

/**
 * The lines of a split transaction. A split's own category is null; its lines carry the
 * categories and always add up to its amount. A line can be a transfer: then its payee is the
 * other account's transfer payee and a transaction there points back with
 * `transferSubTransactionId`.
 */
export const subTransaction = pgTable(
  "sub_transaction",
  {
    id: text().primaryKey(),
    transactionId: text()
      .notNull()
      .references(() => transaction.id, { onDelete: "cascade" }),
    sortOrder: integer().notNull(),
    /** Minor units; negative is an outflow. */
    amount: bigint({ mode: "bigint" }).notNull(),
    /** Always the parent transaction's currency. */
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    /**
     * `amount` in the budget's currency at the parent's rate; the lines' base amounts always add
     * up to the parent's (`convertLines`).
     */
    baseAmount: bigint({ mode: "bigint" }).notNull(),
    payeeId: text().references(() => payee.id, { onDelete: "set null" }),
    /** Same rules as a transaction's category (no action: see `transaction.categoryId`). */
    categoryId: text().references(() => category.id),
    memo: text().notNull().default(""),
    ...timestamps,
  },
  (t) => [
    index("sub_transaction_transaction_id_idx").on(t.transactionId),
    index("sub_transaction_category_id_idx").on(t.categoryId),
  ],
);

/**
 * A scheduled transaction: a future one-off (frequency "never") or a repeating one. One row per
 * schedule, showing its next occurrence; due occurrences become transactions (see
 * `enterDueScheduled` in the API). A transfer's payee is the other account's transfer payee, as on
 * transactions; there's no second row, the other account shows this one with the amount negated.
 */
export const scheduledTransaction = pgTable(
  "scheduled_transaction",
  {
    id: text().primaryKey(),
    budgetId: text()
      .notNull()
      .references(() => budget.id, { onDelete: "cascade" }),
    accountId: text()
      .notNull()
      .references(() => budgetAccount.id, { onDelete: "cascade" }),
    frequency: text({ enum: SCHEDULE_FREQUENCIES }).notNull(),
    /** Where the repeats are counted from (YYYY-MM-DD); editing the date restarts it there. */
    dateFirst: date({ mode: "string" }).notNull(),
    /** The next occurrence, the one the register shows (YYYY-MM-DD). */
    dateNext: date({ mode: "string" }).notNull(),
    /** Minor units; negative is an outflow. */
    amount: bigint({ mode: "bigint" }).notNull(),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    payeeId: text().references(() => payee.id, { onDelete: "set null" }),
    /** Same rules as a transaction's (no action: see `transaction.categoryId`); null on splits. */
    categoryId: text().references(() => category.id),
    memo: text().notNull().default(""),
    flag: text({ enum: FLAG_COLORS }),
    ...timestamps,
  },
  (t) => [
    index("scheduled_transaction_budget_next_idx").on(t.budgetId, t.dateNext),
    index("scheduled_transaction_account_id_idx").on(t.accountId),
    index("scheduled_transaction_category_id_idx").on(t.categoryId),
    index("scheduled_transaction_payee_id_idx").on(t.payeeId),
  ],
);

/** The lines of a scheduled split; same rules as `subTransaction`. */
export const scheduledSubTransaction = pgTable(
  "scheduled_sub_transaction",
  {
    id: text().primaryKey(),
    scheduledTransactionId: text()
      .notNull()
      .references(() => scheduledTransaction.id, { onDelete: "cascade" }),
    sortOrder: integer().notNull(),
    amount: bigint({ mode: "bigint" }).notNull(),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    payeeId: text().references(() => payee.id, { onDelete: "set null" }),
    categoryId: text().references(() => category.id),
    memo: text().notNull().default(""),
    ...timestamps,
  },
  (t) => [
    index("scheduled_sub_transaction_parent_idx").on(t.scheduledTransactionId),
    index("scheduled_sub_transaction_category_id_idx").on(t.categoryId),
  ],
);

/** What a file import remembers for an account (`budgetAccount.csvImportSettings`). */
export interface CsvImportSettings {
  /** The column names it was set for (lowercased header, or A, B, C… without one). */
  columns: string[];
  mapping: {
    date: number | null;
    payee: number | null;
    memo: number | null;
    outflow: number | null;
    inflow: number | null;
  };
  noHeaderRow: boolean;
  swapInflowOutflow: boolean;
  dateFormat: CsvDateFormat | null;
}

/** The imported side of a match, and the entered transaction's state before it. */
export interface MatchedImport {
  date: string;
  /** Minor units, as a string. */
  amount: string;
  payee: string;
  memo: string;
  importId: string;
  importedPayee: string | null;
  previousAmount: string;
  previousCleared: ClearedState;
  previousApproved: boolean;
}

/** What an OFX/QFX or QIF import remembers for an account. */
export interface StatementImportSettings {
  importMemos: boolean;
  swapPayeeMemo: boolean;
  swapInflowOutflow: boolean;
}

/**
 * Every import id an account has taken in. A file row with one of these is
 * skipped, so re-importing a file adds nothing, and a deleted imported transaction never comes
 * back.
 */
export const accountImportId = pgTable(
  "account_import_id",
  {
    accountId: text()
      .notNull()
      .references(() => budgetAccount.id, { onDelete: "cascade" }),
    importId: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.importId] })],
);
