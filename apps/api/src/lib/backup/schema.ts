import { z } from "@hono/zod-openapi";
import {
  CLEARED_STATES,
  FLAG_COLORS,
  INTERNAL_CATEGORY_KINDS,
  INTERNAL_PAYEE_KINDS,
  PACE_SETTINGS,
} from "@strictbudget/db/schema";
import {
  ACCOUNT_TYPES,
  AUTO_ASSIGN_OPTIONS,
  CURRENCY_SYMBOL_POSITIONS,
  DATE_FORMATS,
  LOAN_CHARGE_KINDS,
  LOAN_CHARGE_STATUSES,
  NUMBER_FORMATS,
  PAYEE_CATEGORIZATIONS,
  PAYEE_RULE_OPERATORS,
  SCHEDULE_FREQUENCIES,
  TARGET_BEHAVIORS,
  TARGET_CADENCES,
  TARGET_REPEAT_UNITS,
  zCurrencyCode,
  zMinorUnits,
} from "@strictbudget/engine";

/**
 * strictbudget's own backup file: one budget, every table that belongs to it, as JSON.
 * The layout is versioned and independent of the database's: a later strictbudget reads every
 * version it ever wrote. Ids are only references inside the file; an import gives every row a new
 * id. Money is an integer string of minor units next to its currency, never a number.
 *
 * Not in a backup: the budget's members and invitations (people belong to an instance), its change
 * history, the shared market FX rate cache (the budget's own rate overrides are in), transaction
 * attachments (files in object storage, not JSON), and AI conversations (private to
 * whoever had them).
 */
export const BACKUP_FORMAT = "strictbudget-backup";
/** Backups written before the rename. */
const LEGACY_BACKUP_FORMAT = "everycent-backup";
export const BACKUP_VERSION = 1;

const Id = z.string().min(1).max(200);
const Ref = Id.nullable();
const Day = z.iso.date();
const MonthStart = z.string().regex(/^\d{4}-\d{2}-01$/, "Expected the first of a month");
const Decimal = z.string().regex(/^\d+(\.\d+)?$/, "Expected a non-negative decimal string");
const Text = z.string().max(10_000);
const Name = z.string().min(1).max(500);
const Order = z.number().int();

const BudgetSchema = z.object({
  name: Name,
  currency: zCurrencyCode,
  numberFormat: z.enum(NUMBER_FORMATS),
  currencySymbolPosition: z.enum(CURRENCY_SYMBOL_POSITIONS),
  dateFormat: z.enum(DATE_FORMATS),
  /** When the budget was made: the budget screen's first day counts from it. */
  createdAt: z.iso.datetime({ offset: true }),
  expectedIncome: zMinorUnits.nullable(),
  expectedIncomeCurrency: zCurrencyCode.nullable(),
  loanSimulatorBannerDismissed: z.boolean(),
  /** Missing from backups made before the AI settings existed. */
  aiEnabled: z.boolean().default(false),
  aiAssistantButton: z.boolean().default(false),
  /** Preset view keys and `views` ids. */
  viewOrder: z.array(z.string()).nullable(),
});

const CategoryGroupSchema = z.object({
  id: Id,
  name: Name,
  sortOrder: Order,
  hidden: z.boolean(),
  internal: z.boolean(),
  kind: z.enum(["credit_card_payments"]).nullable(),
});

const CategorySchema = z.object({
  id: Id,
  groupId: Id,
  name: Name,
  note: Text,
  sortOrder: Order,
  hidden: z.boolean(),
  internalKind: z.enum(INTERNAL_CATEGORY_KINDS).nullable(),
  linkedAccountId: Ref,
  /** Spending pace's setting; backups from before it have none. */
  pace: z.enum(PACE_SETTINGS).nullish(),
});

/** A file import's remembered settings, kept as they are (they only steer the import dialog). */
const ImportSettings = z.looseObject({}).nullish();

const AccountSchema = z.object({
  id: Id,
  name: Name,
  type: z.enum(ACCOUNT_TYPES),
  note: Text,
  sortOrder: Order,
  closed: z.boolean(),
  starredSortOrder: Order.nullable(),
  currency: zCurrencyCode,
  interestRate: Decimal.nullable(),
  minimumPayment: zMinorUnits.nullable(),
  escrowAmount: zMinorUnits.nullable(),
  lastReconciledAt: z.iso.datetime({ offset: true }).nullable(),
  pairedCategoryId: Ref,
  paidOffBannerDismissed: z.boolean(),
  migratedToAccountId: Ref,
  /** File import's remembered settings, as stored. */
  csvImportSettings: ImportSettings,
  statementImportSettings: ImportSettings,
});

const LoanTermsSchema = z.object({
  id: Id,
  accountId: Id,
  month: MonthStart,
  interestRate: Decimal.nullable(),
  minimumPayment: zMinorUnits.nullable(),
  escrowAmount: zMinorUnits.nullable(),
  currency: zCurrencyCode,
});

const LoanChargeSchema = z.object({
  id: Id,
  accountId: Id,
  month: MonthStart,
  kind: z.enum(LOAN_CHARGE_KINDS),
  amount: zMinorUnits,
  currency: zCurrencyCode,
  status: z.enum(LOAN_CHARGE_STATUSES),
});

const PayeeSchema = z.object({
  id: Id,
  name: Name,
  internalKind: z.enum(INTERNAL_PAYEE_KINDS).nullable(),
  transferAccountId: Ref,
  hidden: z.boolean(),
  categorization: z.enum(PAYEE_CATEGORIZATIONS),
  defaultCategoryId: Ref,
  carriedCategoryId: Ref,
  /** The stored auto-categorization default. */
  autoCategoryId: Ref.optional(),
  autoCategorySaved: z.boolean().optional(),
});

const PayeeRuleSchema = z.object({
  id: Id,
  payeeId: Id,
  operator: z.enum(PAYEE_RULE_OPERATORS),
  text: Text,
  position: Order,
  createdAt: z.iso.datetime({ offset: true }),
});

const FlagNameSchema = z.object({ color: z.enum(FLAG_COLORS), name: Name });

const AssignmentSchema = z.object({
  categoryId: Id,
  month: MonthStart,
  amount: zMinorUnits,
  currency: zCurrencyCode,
});

const MoneyMoveSchema = z.object({
  fromCategoryId: Ref,
  toCategoryId: Ref,
  fromCategoryName: z.string().nullable(),
  toCategoryName: z.string().nullable(),
  deletion: z.boolean(),
  autoAssignBatchId: z.string().nullable(),
  autoAssignMethod: z.enum(AUTO_ASSIGN_OPTIONS).nullable(),
  month: MonthStart,
  amount: zMinorUnits,
  currency: zCurrencyCode,
  createdAt: z.iso.datetime({ offset: true }),
});

const TargetSchema = z.object({
  categoryId: Id,
  cadence: z.enum(TARGET_CADENCES),
  behavior: z.enum(TARGET_BEHAVIORS),
  amount: zMinorUnits,
  currency: zCurrencyCode,
  dueDay: z.number().int().nullable(),
  dueDate: Day.nullable(),
  repeatEvery: z.number().int().nullable(),
  repeatUnit: z.enum(TARGET_REPEAT_UNITS).nullable(),
  startMonth: MonthStart,
  startDay: z.number().int().nullable(),
  snoozedMonth: MonthStart.nullable(),
});

const MonthNoteSchema = z.object({ month: MonthStart, note: Text });

const ViewSchema = z.object({ id: Id, name: Name, categoryIds: z.array(Id) });

const TransactionSchema = z.object({
  id: Id,
  accountId: Id,
  date: Day,
  amount: zMinorUnits,
  currency: zCurrencyCode,
  baseAmount: zMinorUnits,
  fxRate: Decimal.nullable(),
  fxRateManual: z.boolean(),
  payeeId: Ref,
  categoryId: Ref,
  memo: Text,
  cleared: z.enum(CLEARED_STATES),
  flag: z.enum(FLAG_COLORS).nullable(),
  approved: z.boolean(),
  transferTransactionId: Ref,
  transferSubTransactionId: Ref,
  /** File import: its import id, the payee as the file named it, a match. */
  importId: z.string().max(300).nullish(),
  importedPayee: Text.nullish(),
  matchedImport: z.looseObject({}).nullish(),
});

/** The import ids an account has taken in, so a restored budget skips the same rows. */
const AccountImportIdSchema = z.object({ accountId: Id, importId: z.string().max(300) });

const SubTransactionSchema = z.object({
  id: Id,
  transactionId: Id,
  sortOrder: Order,
  amount: zMinorUnits,
  currency: zCurrencyCode,
  baseAmount: zMinorUnits,
  payeeId: Ref,
  categoryId: Ref,
  memo: Text,
});

const ScheduledSchema = z.object({
  id: Id,
  accountId: Id,
  frequency: z.enum(SCHEDULE_FREQUENCIES),
  dateFirst: Day,
  dateNext: Day,
  amount: zMinorUnits,
  currency: zCurrencyCode,
  payeeId: Ref,
  categoryId: Ref,
  memo: Text,
  flag: z.enum(FLAG_COLORS).nullable(),
});

const ScheduledSubSchema = z.object({
  scheduledTransactionId: Id,
  sortOrder: Order,
  amount: zMinorUnits,
  currency: zCurrencyCode,
  payeeId: Ref,
  categoryId: Ref,
  memo: Text,
});

const FxOverrideSchema = z.object({ date: Day, currency: zCurrencyCode, rate: Decimal });

export const BackupSchema = z
  .object({
    format: z.enum([BACKUP_FORMAT, LEGACY_BACKUP_FORMAT]),
    version: z.literal(BACKUP_VERSION),
    exportedAt: z.iso.datetime({ offset: true }),
    budget: BudgetSchema,
    categoryGroups: z.array(CategoryGroupSchema),
    categories: z.array(CategorySchema),
    accounts: z.array(AccountSchema),
    loanTerms: z.array(LoanTermsSchema),
    loanCharges: z.array(LoanChargeSchema),
    payees: z.array(PayeeSchema),
    payeeRules: z.array(PayeeRuleSchema),
    flagNames: z.array(FlagNameSchema),
    assignments: z.array(AssignmentSchema),
    moneyMoves: z.array(MoneyMoveSchema),
    targets: z.array(TargetSchema),
    monthNotes: z.array(MonthNoteSchema),
    views: z.array(ViewSchema),
    transactions: z.array(TransactionSchema),
    subTransactions: z.array(SubTransactionSchema),
    scheduledTransactions: z.array(ScheduledSchema),
    scheduledSubTransactions: z.array(ScheduledSubSchema),
    fxRateOverrides: z.array(FxOverrideSchema),
    accountImportIds: z.array(AccountImportIdSchema).default([]),
  })
  .openapi("BudgetBackup");

export type Backup = z.infer<typeof BackupSchema>;
export type BackupTransaction = z.infer<typeof TransactionSchema>;
export type BackupSubTransaction = z.infer<typeof SubTransactionSchema>;

/** The order a backup's sections are written in (and the order they're read back). */
export const BACKUP_SECTIONS = [
  "categoryGroups",
  "categories",
  "accounts",
  "loanTerms",
  "loanCharges",
  "payees",
  "payeeRules",
  "flagNames",
  "assignments",
  "moneyMoves",
  "targets",
  "monthNotes",
  "views",
  "transactions",
  "subTransactions",
  "scheduledTransactions",
  "scheduledSubTransactions",
  "fxRateOverrides",
  "accountImportIds",
] as const satisfies readonly Exclude<
  keyof Backup,
  "format" | "version" | "exportedAt" | "budget"
>[];
