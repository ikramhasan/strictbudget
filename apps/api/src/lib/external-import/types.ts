import { z } from "@hono/zod-openapi";

// The parts of the source's API (GET /budgets/{id}) the importer reads, checked
// before use. Amounts are milliunits (1000 = 1.00 of the currency).

const Milli = z.number().int();
const Id = z.string();
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Flag = z.enum(["red", "orange", "yellow", "green", "blue", "purple", ""]).nullable();
/** Loan values by month: { "2026-10-01": 7000 }. */
const PerMonth = z.record(z.string(), z.number().int()).nullable();

export const ExternalPlanSummarySchema = z.object({
  id: Id,
  name: z.string(),
  last_modified_on: z.string().nullable().optional(),
  first_month: z.string().nullable().optional(),
  last_month: z.string().nullable().optional(),
});
export type ExternalPlanSummary = z.infer<typeof ExternalPlanSummarySchema>;

const Account = z.object({
  id: Id,
  name: z.string(),
  type: z.string(),
  on_budget: z.boolean(),
  closed: z.boolean(),
  note: z.string().nullable(),
  balance: Milli,
  transfer_payee_id: Id.nullable(),
  last_reconciled_at: z.string().nullable().optional(),
  debt_interest_rates: PerMonth.optional(),
  debt_minimum_payments: PerMonth.optional(),
  debt_escrow_amounts: PerMonth.optional(),
  deleted: z.boolean(),
});

const Payee = z.object({
  id: Id,
  name: z.string(),
  transfer_account_id: Id.nullable(),
  deleted: z.boolean(),
});

const Group = z.object({
  id: Id,
  name: z.string(),
  hidden: z.boolean(),
  deleted: z.boolean(),
});

const Category = z.object({
  id: Id,
  category_group_id: Id,
  name: z.string(),
  hidden: z.boolean(),
  note: z.string().nullable(),
  goal_type: z.string().nullable(),
  goal_needs_whole_amount: z.boolean().nullable().optional(),
  goal_day: z.number().int().nullable().optional(),
  goal_cadence: z.number().int().nullable().optional(),
  goal_cadence_frequency: z.number().int().nullable().optional(),
  goal_creation_month: z.string().nullable().optional(),
  goal_target: Milli.nullable().optional(),
  goal_target_month: z.string().nullable().optional(),
  goal_target_date: z.string().nullable().optional(),
  goal_snoozed_at: z.string().nullable().optional(),
  deleted: z.boolean(),
});

const MonthCategory = z.object({ id: Id, budgeted: Milli, activity: Milli, balance: Milli });

const Month = z.object({
  month: Day,
  note: z.string().nullable(),
  to_be_budgeted: Milli,
  categories: z.array(MonthCategory),
  deleted: z.boolean().optional(),
});

const Transaction = z.object({
  id: Id,
  date: Day,
  amount: Milli,
  memo: z.string().nullable(),
  cleared: z.enum(["cleared", "uncleared", "reconciled"]),
  approved: z.boolean(),
  flag_color: Flag.optional(),
  account_id: Id,
  payee_id: Id.nullable(),
  category_id: Id.nullable(),
  transfer_account_id: Id.nullable(),
  transfer_transaction_id: Id.nullable(),
  debt_transaction_type: z.string().nullable().optional(),
  deleted: z.boolean(),
});

const SubTransaction = z.object({
  id: Id,
  transaction_id: Id,
  amount: Milli,
  memo: z.string().nullable(),
  payee_id: Id.nullable(),
  category_id: Id.nullable(),
  transfer_account_id: Id.nullable(),
  transfer_transaction_id: Id.nullable().optional(),
  deleted: z.boolean(),
});

const Scheduled = z.object({
  id: Id,
  date_first: Day,
  date_next: Day,
  frequency: z.string(),
  amount: Milli,
  memo: z.string().nullable(),
  flag_color: Flag.optional(),
  account_id: Id,
  payee_id: Id.nullable(),
  category_id: Id.nullable(),
  transfer_account_id: Id.nullable(),
  deleted: z.boolean(),
});

const ScheduledSub = z.object({
  id: Id,
  scheduled_transaction_id: Id,
  amount: Milli,
  memo: z.string().nullable(),
  payee_id: Id.nullable(),
  category_id: Id.nullable(),
  transfer_account_id: Id.nullable(),
  deleted: z.boolean(),
});

export const ExternalPlanSchema = z.object({
  id: Id,
  name: z.string(),
  first_month: z.string().nullable().optional(),
  last_month: z.string().nullable().optional(),
  date_format: z.object({ format: z.string() }).nullable(),
  currency_format: z
    .object({
      iso_code: z.string(),
      decimal_separator: z.string(),
      group_separator: z.string(),
      symbol_first: z.boolean(),
      display_symbol: z.boolean(),
      example_format: z.string().optional(),
    })
    .nullable(),
  accounts: z.array(Account),
  payees: z.array(Payee),
  category_groups: z.array(Group),
  categories: z.array(Category),
  months: z.array(Month),
  transactions: z.array(Transaction),
  subtransactions: z.array(SubTransaction),
  scheduled_transactions: z.array(Scheduled),
  scheduled_subtransactions: z.array(ScheduledSub),
});
export type ExternalPlan = z.infer<typeof ExternalPlanSchema>;
export type ExternalCategory = z.infer<typeof Category>;
