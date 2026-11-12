# strictbudget: current state, for designing a savings feature

Read-only survey of the repo at `ce674b8` (main). Every claim cites `path:line`. Short forms:
`engine/` = `packages/engine/src/`, `schema/` = `packages/db/src/schema/`, `api/` = `apps/api/src/`,
`web/` = `apps/web/src/`, `DN` = `docs/design-notes/README.md`. GitHub issues named in the docs
(#89, #119, #132 …) were not opened (no network), so only what the docs say about them is reported.

Headline: the app is much further along than "no tracking accounts, no targets". It already has a
`savings` account type (on budget), tracking `asset`/`liability` accounts (off budget), loans with
interest, seven target cadences including "Have a balance of…", a Net Worth report with a
"net saved from income" split, and a display-only savings rate. It has **no** first-class savings
concept: no savings-goal entity, no "counts as saving" flag, no interest/maturity on asset
accounts, no savings report.

## 1. Accounts

- **Types** (persisted keys, must never be renamed): `checking, savings, cash, credit_card,
  line_of_credit, mortgage, auto_loan, student_loan, personal_loan, medical_debt, other_debt,
  asset, liability` (`engine/accounts.ts:7-21`). Stored as `budget_account.type` text enum
  (`schema/account.ts:41`). The table is `budget_account` because Better Auth owns `account`
  (`schema/account.ts:32`).
- **Families** `cash | credit | loan | tracking` (`engine/accounts.ts:24-41`): checking/savings/cash
  → cash; cards and lines of credit → credit; six debt types → loan; asset/liability → tracking.
  Label for `asset` is "Asset (e.g. investment)" (`engine/accounts.ts:55`).
- **On/off budget is derived, not stored**: `isOnBudget(type)` = family cash or credit
  (`engine/accounts.ts:65-69`: "Cash and credit accounts are in the budget; loan and tracking
  accounts only track a balance."). There is no `on_budget` column (checked `schema/account.ts`
  and grep for `on_budget|onBudget|offBudget`: only a computed `onBudget` in `api/lib/net-worth.ts:314`).
  The UI says "Tracking (off budget)" (`web/components/account-forms.tsx:28-38`) and "· Off budget"
  (`web/routes/_authed/budgets/$budgetId/accounts/$accountId.tsx:676`).
- **Type changes** only within a family; "Cross-family changes aren't planned" (DN:311-312;
  enforced `api/routes/accounts/handlers.ts:575-582`). So a savings account cannot be turned into
  a tracking account or back.
- **Savings account**: just a cash-family type. It differs from checking only in label, in the Net
  Worth composition chart (its own "Savings" band, `web/lib/net-worth.ts:111-144`) and in new rows
  starting uncleared (only `cash` starts cleared, `api/routes/transactions/rules.ts:124-126`). Its
  balance is budget money in Ready to Assign/categories like any cash account.
- **Investment/asset**: `asset` tracking type only; no holdings, prices, returns or interest.
  Interest rate, minimum payment and escrow exist on the row but are refused off loans
  (`schema/account.ts:53-58`; `api/routes/accounts/handlers.ts:269-283`).
- **Loans/debt**: six loan types with per-month terms (`loan_terms`, `schema/account.ts:92-108`),
  per-month interest/escrow charges (`loan_charge`, `:114-131`; `engine/loans.ts:83-89`
  `monthlyInterest`, `:194` `loanMonths`), a paired category (`pairedCategoryId`, `:64`) and a
  payoff planner (`engine/loan-planner.ts`). A tracking liability can be "updated" to a loan
  (`migratedToAccountId`, `schema/account.ts:73-79`; `api/routes/accounts/routes.ts:585-587`).
- **Balances are computed, never stored**: `accountBalances()` sums transactions per account up
  to the user's `today` into cleared / uncleared / working, native or base currency, minus loan
  charges (`api/lib/ledger.ts:244-272`). Every balance route takes `?today=` (DN:218-219).
  Sidebar totals: starred, budget, loans, tracking, closed, netWorth = every open account
  (`api/lib/account-totals.ts:16, 44-66`; schema `api/routes/accounts/routes.ts:152-164`).
- **Multi-currency**: each account has `currency` (`schema/account.ts:52`); every type but loans
  may differ from the budget's (DN:24-26). Transactions keep native `amount` plus `base_amount`
  locked at `fx_rate` (`schema/account.ts:255-267`; DN:27-31). Plan math uses base amounts;
  registers/balances/reconcile use native. Rates: shared `fx_rate` cache + per-budget
  `fx_rate_override` (`schema/fx.ts:15-51`). Revaluation posts an "FX Revaluation" (native 0) to
  Ready to Assign on budget accounts, uncategorized on tracking (`api/routes/accounts/revaluation.ts:78-80`;
  DN:43-46). Account totals/net worth show today's value in a per-user display currency
  (`schema/budget.ts:174`; DN:47-49).

## 2. Transactions and transfers

- **`transaction`** (`schema/account.ts:243-332`): date, native `amount` (negative = outflow),
  `currency`, `baseAmount`, `fxRate`, `fxRateManual`, `payeeId`, `categoryId`, `memo`,
  `cleared` (`uncleared|cleared|reconciled`, `:218`), `flag` (six colours, `:222`), `approved`,
  `transferTransactionId`, `transferSubTransactionId`, actor stamps, `version`, import fields.
- **Splits**: `sub_transaction` lines carry categories and sum to the parent, whose own category
  is null; a line can itself be a transfer (`schema/account.ts:334-367`).
- **Payees**: `payee` with `internalKind` (`starting_balance`, `manual_balance_adjustment`,
  `reconciliation_balance_adjustment`, `fx_revaluation`, `:134-140`) and `transferAccountId` for
  each account's "Transfer : <account>" payee (`:152-156`; `api/lib/ledger.ts:42-69`).
- **Transfers are paired rows**: two `transaction` rows pointing at each other through
  `transferTransactionId`, amounts always opposite, each with the other account's transfer payee
  (`schema/account.ts:281-287`). No separate transfer id/table. Memo, cleared, flag are per side.
- **Category on a transfer** (`engine/accounts.ts:71-79`, `usesCategory`): "Tracking accounts
  never do. A transfer … only does when money leaves the budget: on the budget side of a transfer
  with a tracking account. Between two budget accounts it stays in the budget." Enforced by
  `resolveCategory` (`api/routes/transactions/rules.ts:44-77`: 400 `CATEGORY_NOT_ALLOWED`;
  budget-side null becomes Uncategorized). Concretely:
  - checking → savings (both on budget): **no category**, no plan effect.
  - checking → asset/liability/loan (off budget): budget side **takes a category** and counts as
    that category's Activity (spending); the tracking side has none. Loan payments use the paired
    category (`api/routes/accounts/loans.ts:239-257`).
  - cash ↔ card: no category stored; the payment comes out of the card's payment category (DN:252-254).
  - tracking ↔ tracking: no category (`schema/account.ts:269-272`).
- **Starting balances**: a Starting Balance transaction; on-budget and ≥ 0 → category
  "Inflow: Ready to Assign"; card debt and off-budget → no category (`api/lib/ledger.ts:276-310`; DN:99-103).
- **Balance adjustments**: `insertAdjustment` — budget accounts take it from Ready to Assign,
  tracking accounts have no category (`api/routes/accounts/handlers.ts:662-689`). Setting a
  tracking account's "Working Balance" is therefore how its value is updated (DN:154-155).
  Closing zeroes the balance with a Manual Balance Adjustment (`handlers.ts:874-915`; DN:106-109).
- **Reconciliation**: `reconcileAccount` adds a Reconciliation Balance Adjustment for the
  difference, marks cleared rows up to `date` reconciled, stamps `lastReconciledAt`
  (`api/routes/accounts/handlers.ts:744-802`). No unreconcile (DN:220-221).
- **Scheduled/recurring**: `scheduled_transaction` (+ split lines), one row per schedule with
  `dateNext`; 13 frequencies from `never` to `everyOtherYear` (`schema/account.ts:369-428`;
  `engine/schedule.ts:5-19`). Due occurrences are entered on reads carrying the user's `today`,
  not by a job, and arrive unapproved (DN:287-292). Scheduled cross-currency transfers are refused
  (DN:41-42). Pending transactions don't exist (DN:216-217).

## 3. Categories, Ready to Assign, rollover

- **`category_group`**: name, `sortOrder`, `hidden`, `internal` (holds system categories),
  `kind` (`credit_card_payments` only) (`schema/category.ts:44-70`).
- **`category`**: name, `note`, `sortOrder`, `hidden`, `internalKind`
  (`ready_to_assign | uncategorized`, `:30`), `linkedAccountId` (a card's payment category),
  `pace` (`include | exclude`, spending-pace override) (`schema/category.ts:72-103`). **No
  kind/type/flag for income or savings.** Income is the internal "Inflow: Ready to Assign" category.
- **`category_assignment`**: one row per category per month (`YYYY-MM-01`), amount may be
  negative (`:109-132`). **`money_move`** logs every change for Recent Moves (`:138-173`).
  **`month_note`** (`:220-233`), **`budget_view`** custom views + presets `underfunded,
  overfunded, available, snoozed` (`:239-261`).
- **Month model**: calendar months, `BudgetMonth = "YYYY-MM"` (`engine/months.ts:4-7`); the budget
  shows from one month before the oldest transaction to one month past the current/latest
  assigned month (`engine/months.ts:62-75`).
- **Ready to Assign**: `readyToAssign()` (`engine/months.ts:237-260`): "income categorized to
  Ready to Assign up to the month, less every month's assigned money up to it, less cash
  overspending of the months before it. Money assigned in later months takes from what's left,
  but never pushes the month below zero." Line-by-line `readyToAssignBreakdown` (`:285-313`);
  `isOverdraft` (`:323-331`). Inputs are assembled in `monthState` (`api/routes/months/handlers.ts:688`;
  income from the internal category's activity `:840-842`, overspending `:846`, call `:933`).
- **Rollover**: `categoryMonth()` (`engine/months.ts:140-202`): "What's available rolls into the
  next month; a negative balance (overspending) doesn't, the category starts the next month at zero."
- **Overspending**: split into cash and credit by `splitOverspending` (`engine/months.ts:121-129`);
  cash overspending comes out of next month's Ready to Assign (`categoryOverspending`, `:219-225`),
  credit overspending becomes card debt (DN:82-89).

## 4. Targets

One `category_target` row per category (`categoryId` unique), overwritten in place; "targets only
compute what's asked for and never move money" (`schema/category.ts:175-214`). Columns: `cadence`,
`behavior`, `amount`+`currency`, `dueDay`, `dueDate`, `repeatEvery`, `repeatUnit`, `startMonth`,
`startDay`, `snoozedMonth`. Engine types, verbatim (`engine/targets.ts:20-87`):

```ts
export const TARGET_BEHAVIORS = ["set_aside", "refill", "balance"] as const;
export const TARGET_CADENCES = [
  "weekly", "monthly", "yearly", "custom",
  "payment_monthly", "payoff_by_date", "debt_monthly",
] as const;
export const TARGET_REPEAT_UNITS = ["month", "year"] as const;

export interface CategoryTarget {
  cadence: TargetCadence;
  behavior: TargetBehavior;
  amount: bigint;            // per week / per month / per period; zero for payoff_by_date
  dueDay: number | null;     // monthly, debt_monthly: day 1–31, null = last; weekly: weekday
  dueDate: string | null;    // yearly/custom: first due date; balance: first of its month or null
  repeatEvery: number | null;
  repeatUnit: TargetRepeatUnit | null;
  startMonth: BudgetMonth;
  startDay?: number | null;
}
export interface TargetNeed {
  needed: bigint; funded: bigint; underfunded: bigint;
  monthAmount: bigint; overfunded: bigint; dueDate: string | null;
}
```

- Behaviours (`engine/targets.ts:14-19`): `set_aside` "the full amount each period; money carried
  in doesn't count"; `refill` "only what brings the category up to the amount"; `balance` "Have a
  balance of… (custom only): reach the amount, by a month or eventually".
- Allowed combinations (`api/routes/categories/routes.ts:89-177`): weekly/monthly/yearly ×
  set_aside|refill; custom × any behaviour with `repeat` every 1–11 months or 1–2 years (balance
  can't repeat, `dueDate` null = "eventually"); `payment_monthly` and `payoff_by_date` only on
  card payment categories; `debt_monthly` only on a loan's paired category.
- **Needed this month** = `targetNeed()` (`engine/targets.ts:244-341`): monthly/weekly ask the
  month's amount; dated targets spread what's missing over the months left, rounding up
  (`shareOf`, `:400-401`); balance counts carried + assigned + activity, and without a date
  "never asks for money this month" (`:288-300`); a one-time balance target disappears after its
  month (`periodOf`, `:179-187`). Card payoff: `payoffNeed` (`:355-379`). `targetPercent` (`:417-421`).
- **Target currency**: a target may be in another currency, converted at today's rate rounded up
  (`targetInBase`, `engine/targets.ts:120-128`; `loadTargets`, `api/routes/months/handlers.ts:644-682`).
- **Snooze** for one month (`snoozedMonth`); **no target history** (`docs/design-notes/reports.md:91-93`).
- **UI**: yellow/green Available pill with pie or check (`web/components/move-money.tsx:86, 183`);
  row note "Funded" / "On track" / "$x more needed by…" / "$x needed eventually"
  (`web/lib/targets.ts:163-204`); segmented progress bar from `progressBar()`
  (`engine/progress.ts:39`; `web/components/progress-bar.tsx:43`); inspector Target section and
  editor (`web/components/target-inspector.tsx:113`), whose copy says balance is "Good for
  long-term savings." (`:91`); "Cost to Be Me" / month's targets / Expected Income summary
  (`web/components/category-inspector.tsx:85`; `budget.expectedIncome`, `schema/budget.ts:52-53`).

## 5. Assignment actions

- Assign: `PUT …/months/{month}/categories/{categoryId}` (`api/routes/months/routes.ts:398-400`).
- Move money between categories or to/from Ready to Assign, optionally taking it from another
  month (`fromMonth`): `POST …/months/{month}/moves` (`:448-450, 471`; handler `handlers.ts:1187-1242`).
- Auto-Assign options (`engine/months.ts:334-343`): `underfunded, assignedLastMonth,
  spentLastMonth, averageAssigned, averageSpent, reduceOverfunding, resetAvailable,
  resetAssigned`; amounts from `autoAssignAmounts` (`:366-408`). Underfunded funds in a fixed order
  (`FUNDING_STEPS`, `engine/funding.ts:12-18`; `fundUnderfunded`, `:212-237`) and stops at Ready to
  Assign for the whole plan or a view (`handlers.ts:1244-1292`).
- Assigning in future months is supported ("Assigned in Future", `engine/months.ts:230-235`).
- "Templates" are category templates (groups/categories; each new category with an example amount
  gets a `custom`/`balance` target due eventually: `api/lib/category-templates.ts:51-52, 146-160`),
  not assignment templates.
- **No "hold for next month"** action or stored hold (grep `hold for`: none; RTA has no such input).
- Undo/redo is browser-local and replays through the API (DN:60-67).

## 6. Reports

Web tabs: Overview, then Spending Breakdown, Spending Trends, Net Worth, Income v Expense, Age of
Money; then Budget vs Actual, Category History, Spending Pace, Credit Card Health, Spending by
Flag (`web/components/reports/report-page.tsx:15-29`; routes under `web/routes/_authed/budgets/$budgetId/reports/`).

- **Spending / income definition** (`api/lib/reports.ts:30-37, 121-141`): `spending` = lines on
  budget accounts with a category other than Ready to Assign; "Transfers between budget accounts
  carry no category and drop out; a transfer to a tracking account counts under its category".
  `income` = lines on budget accounts categorized to Ready to Assign, except starting balances.
  Tracking/loan accounts' own lines never count (`:79, 133`).
- **Net Worth** (`engine/net-worth.ts:3-9`; `api/lib/net-worth.ts:78-97`): every account, on and
  off budget, closed included; assets/debts by balance sign. "What changed this month" splits into
  `netSaved` ("the budget accounts' cash flow … money sent to loans and tracking accounts counting
  as spent"), `debtPaidDown`, `tracking`, `other` (`engine/net-worth.ts:49-81`). Composition bands:
  cash, savings, investments, credit, loans, liabilities (`web/lib/net-worth.ts:111-144`).
- **Savings rate** exists only as display: `(income − spent) / income` on the Overview tile
  (`web/lib/reports-home.ts:37-39`) and a row in Income v Expense (`web/lib/income-expense.ts:63-66, 181-185`).
  Because of the spending definition, money moved to a tracking account lowers it, and money left
  in or moved to an on-budget savings account raises it. **Runway** tile: `monthsOfRunway`
  (`engine/observations.ts:154`).
- **Age of Money** (`engine/age-of-money.ts:4-24`): one pool across cash accounts; transfers
  between cash accounts ignored; transfers out to loan/tracking accounts are outflows.
- **Spending Pace** leaves "savings" out by default, defined as a category with a `balance` target
  (`api/routes/reports/spending-pace.ts:37, 209-251`), overridable per category via `category.pace`.
- `docs/design-notes/reports.md` in brief: fixed numeric definitions for the five core reports,
  own visuals (`:5-8`); comparison + drill-down everywhere (`:11-12`); observations are rule-based
  (`:15`); plan-based reports reuse the plan's own math (`:64-66`); amounts stay exact, percentages
  display-only (`:146-148`); no monthly rollup table (`:151-152`). Open: cash-flow forecast #64,
  Sankey #86, payees/recurring #88, **savings rate and income sources #89**, debt payoff #90 (`:57-60`).

## 7. Import / export

- **YNAB via API** (`api/lib/external-import/from-api.ts`), converted to the backup layout.
  Account types map 1:1, tracking included: `otherAsset → asset`, `otherLiability → liability`
  (`convert.ts:17-31`). Categories on tracking rows are dropped (`convert.ts:114-128`).
- **Goals → targets** (`from-api.ts:54-143`): `TB` → custom/balance (eventually); `TBD` →
  custom/balance by month; `MF` → monthly/set_aside; `NEED` → weekly/monthly/yearly/custom with
  set_aside or refill from `goal_needs_whole_amount`; on payment categories `MF` →
  payment_monthly, `TBD` → payoff_by_date. Skipped with a warning: `DEBT`, "every N weeks",
  unknown types. Loans arrive unpaired (`:230-233`).
- **YNAB export files** (`from-csv.ts`): no targets or schedules; account types are given or
  guessed — uncategorized positive accounts become `asset`, negative `liability` (`:156-162`).
- **Bank files** CSV/OFX/QFX/QIF per account (`api/lib/file-import.ts`). No Actual Budget importer
  (grep `actual` in `api/lib/external-import`: none).
- **Export**: plan/register CSV zip (`api/routes/exports/routes.ts:37-72`); JSON backup incl.
  targets (`api/lib/backup/schema.ts:279`), restore via `POST /v1/budgets/import`.
- Fresh start copies categories with targets, accounts at $0, schedules (DN:195-204).

## 8. Other features that touch this

- **AI assistant and agents**: tools are generated from the OpenAPI document — every operation
  except an exclusion list (`api/lib/agents/operations.ts:1-45, 218-230`); the in-app assistant
  drops a few more and requires approval for non-GET operations (`api/lib/ai/assistant.ts:47-63,
  240-250`). A new route becomes an MCP tool and assistant tool automatically.
- **API keys**: act as the owner, scoped read / read-write and to chosen budgets
  (`api/lib/api-keys.ts:1-12`); 500 requests/hour (`:27`).
- **Roles**: owner, editor, viewer (`schema/budget.ts:28`). Permissions `category`, `account`,
  `transaction` × create/update/delete and `budget: fresh_start | assign`
  (`api/lib/budget-access-control.ts:11-37`). `viewerGuard` refuses every viewer write by path
  (`api/lib/viewer-guard.ts:8-41`).
- **Change log + live updates**: per-table audit triggers write `audit_event` and `pg_notify`
  (`schema/audit.ts:6-16`; `packages/db/migrations/0038_audit_triggers.sql:141-198`). Tables added
  later attach the trigger in their own migration (`0048_transaction_attachment.sql:34-35`).
- **Attachments**: per transaction only (`docs/design-notes/attachments.md`).
- **Mobile/keyboard**: four budget columns from 768px, phone shows name + Available with a
  drawer; inspector is a drawer below 1024px (DN:77-79); bottom nav Budget, Accounts, Reports,
  Activity, More; 44px touch targets; one shortcut registry `web/lib/shortcuts.ts`; WCAG 2.2 AA;
  every chart needs a table view (`docs/design-notes/keyboard-mobile-accessibility.md`; `reports.md:149-150`).

## 9. What is already written about savings, goals, tracking, net worth

- `README.md:17-20`: "**Targets**: weekly, monthly, yearly or by a date, savings balances, credit
  card and loan payments, Underfunded at a glance." / "**Accounts**: cash, checking, savings,
  credit cards with automatic payment categories, loans with interest, escrow and a payoff
  planner, and tracking accounts for assets and debts."
- `docs/roadmap.md:8-11`: "Cycle 14b · Reports II … cash flow (Sankey), budget vs actual, category
  history, payees and recurring charges, savings rate and income sources, debt payoff and
  interest, cash-flow forecast, spending by flag."
- `docs/design-notes/reports.md:136-139`: "savings (a "Have a balance of…" target, standing in for
  "Counts as saving" from #89 until it lands: #119) … Savings with no target still count until the
  user switches them off."
- `docs/design-notes/reports.md:34-36`: ""What changed this month" splits the change into net saved
  from income, debt paid down, tracking accounts and other, always adding up exactly."
- `docs/design-notes/reports.md:39`: "a display-only Savings rate row".
- `docs/design-notes/reports.md:91-93`: "**Targets have no history** (one `category_target` row per
  category, overwritten in place) … Keeping target history is #132."
- DN:50-53: "A target can have its own currency while Available, Assigned and Activity stay in the
  budget's; it converts at today's rate, rounded up at the minor unit."
- DN:142: "A category's history is reassigned on delete, but its target is deleted with it."
- DN:255-256: "A "transfer the balance to…" choice was considered and left out for now."
- `web/components/target-inspector.tsx:89-91`: set_aside "Good for bills, subscriptions and saving
  up over time."; balance "Good for long-term savings."
- Starter categories include "😌 Emergency fund" and "🏝️ Vacation" without targets
  (`api/lib/starter-categories.ts:9-22`); the demo budget has a Savings account and a monthly
  checking→savings transfer (`api/lib/demo-budget.ts:13, 35`).
- No TODO/FIXME comments in `apps/` or `packages/` (grep). No hits for sinking fund, term
  deposit, maturity, or interest earned on assets.

Decisions a savings feature must respect or revisit: on/off budget is a function of account type
and type can't cross families (DN:311-312); budget→tracking transfers are categorized spending in
every report; one target per category, no history; targets never move money; budget currency is
immutable (`schema/budget.ts:41-42`); loans stay in the budget currency (DN:24-26); balances and
reports are computed on read with no rollups; scheduled occurrences are entered on read, no
background job (DN:287-290); core report definitions are fixed (`reports.md:5-8`).

## 10. Conventions (CLAUDE.md and docs)

- Money: `bigint` minor units + `CurrencyCode`; DB `bigint` column + adjacent `char(3)`; JSON
  integer strings (`zMinorUnits`/`zMoney`, `engine/wire.ts:11-16`); never floats; currency
  exponents never change (CLAUDE.md "Invariants").
- Routers via `createRouter()` (`api/lib/router.ts:6-19`); errors `AppError(status, CODE, message)`;
  every route has `operationId`, response schema, `jsonError` responses; authed routes
  `middleware: [requireAuth] as const` + `security: authSecurity`; deps from `c.var.deps`.
- Budget routes under `/v1/budgets/{budgetId}/…`, authorised by `loadBudgetAccess(c, budgetId,
  permission?)` — 404 for non-members, 403 without permission (`api/lib/budget-access.ts:24-47`).
- New endpoint: `routes/<feature>/{routes,handlers,index}.ts`, mount in `api/app.ts:128-155`, then
  `pnpm generate` and commit `openapi.json` + `schema.gen.ts` (`docs/development.md:50-55`).
- Schema: edit `packages/db/src/schema/*`, `pnpm db:generate`, commit migrations, never edit an
  applied one; ids are `newId()` UUIDv7 text.
- Tests: `createTestApp()` + `resetDatabase()` against the real test DB (`apps/api/test/helpers.ts`),
  no mocks; `pnpm check` before done; UI checked in the running app in both themes.
- Prefer maintained libraries; new deps through the `catalog:`; shadcn components into `packages/ui`.
- Self-hosted must work without email; hosted-only code in `cloud/` folders.
- Process: one vertical slice at a time (engine rule → integration test → API schema → client → UI)
  (`docs/roadmap.md:34-36`); deliberate simplifications get a design-note line plus an issue
  (`docs/issues.md`, rule 3).

## 11. Extension points (what exists where)

- **Tables**: `budget_account` (type, currency, loan-only rate fields, `pairedCategoryId`),
  `loan_terms`, `loan_charge`, `transaction`, `scheduled_transaction`, `category` (flags: `hidden`,
  `pace`, `linkedAccountId`), `category_target`, `category_assignment`, `money_move`, `budget`
  (`expectedIncome`). Audit trigger attach pattern: `0048_transaction_attachment.sql:34-35`.
- **Engine**: `accounts.ts` (types, families, `isOnBudget`, `usesCategory`), `targets.ts`
  (`targetNeed`, `targetInBase`, `targetPercent`), `funding.ts`, `progress.ts`, `months.ts`
  (`categoryMonth`, `readyToAssign`, `autoAssignAmounts`), `net-worth.ts` (`netWorthParts`),
  `reports.ts` (`percentOf`, presets), `observations.ts` (`monthsOfRunway`), `loans.ts`
  (`monthlyInterest`), `schedule.ts`, `age-of-money.ts`.
- **API**: `routes/accounts` (create/update/reconcile/close, loan sub-routes), `routes/categories`
  (target set/restore/delete/snooze, `routes.ts:508-596`), `routes/months` (`monthState`, assign,
  move, auto-assign), `routes/reports/*` + `lib/reports.ts` + `lib/net-worth.ts`,
  `routes/scheduled`, `lib/ledger.ts`, `lib/external-import/*`, `lib/backup/*`,
  `lib/fresh-start.ts`, `lib/category-templates.ts`, `lib/summary/data.ts` (monthly email figures).
- **Web**: budget screen `components/category-list.tsx`, `category-inspector.tsx`,
  `target-inspector.tsx`, `move-money.tsx`, `auto-assign.tsx`, `ready-to-assign.tsx`,
  `progress-bar.tsx`; accounts `account-forms.tsx`, `add-account-dialog.tsx`, `accounts-nav.tsx`,
  `balance-history.tsx`, `loan-page.tsx`, `lib/accounts.ts`; reports
  `components/reports/report-page.tsx` (tab lists), `routes/…/reports/index.tsx` (Overview tiles),
  `lib/reports-home.ts`, `lib/income-expense.ts`, `lib/net-worth.ts`, `lib/spending-pace.ts`.
