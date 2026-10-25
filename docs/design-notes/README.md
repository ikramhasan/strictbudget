# Design notes

What strictbudget deliberately does, the simplifications we chose, and how built areas work where
it isn't obvious from the code. Every open gap is an issue (linked next to it); these notes only
explain them. When you knowingly simplify something, add a line to the matching file and open the
issue at the same time (see [`../issues.md`](../issues.md)).

By area:

- [Reports](reports.md)
- [Self-hosted vs cloud, and invitation links](self-hosted-vs-cloud.md)
- [Attachments, profile pictures and account logos](attachments.md)
- [Production readiness](production-readiness.md): deployment, background jobs, email, client IP,
  register speed, observability
- [Keyboard, mobile and accessibility](keyboard-mobile-accessibility.md)
- [File import and export](file-import-export.md)
- [Budget screen toolbar](budget-toolbar.md)

The rest is below.

## Multi-currency

- A budget has one currency; accounts can be in others.
- Every account type but loans can be in another currency than the budget's; loans stay in the
  budget's (their interest, escrow and paired category are budget amounts). Foreign-currency loans
  and loan payments from a foreign account are [#94](https://github.com/ikramhasan/strictbudget/issues/94).
- A transaction keeps its native `amount` and gets `base_amount` in the budget's currency,
  converted once at `fx_rate` (half-even, rounding once) and kept: a rate lock. The rate is the
  date's unless typed; editing only the amount keeps it, a date change looks it up again unless it
  was typed. The plan's math (Ready to Assign, activity, card payments, funded spending,
  overspending) uses base amounts; registers, balances and reconcile use native ones.
- A split's lines convert one by one, with the rounding difference on the largest line, so they
  always add up to the split's base amount.
- FX rates are fetched on demand (Frankfurter, then currency-api) and cached, and a job prefetches
  them four times a day. Reads that only project (scheduled Upcoming, unrealized gain, account
  totals) use rates already known and never wait on the network; a foreign schedule with no known
  rate is left out of Upcoming until one is.
- A transfer's two sides always have opposite base amounts, so it moves no money inside the
  budget. The side in the budget's currency decides the base (otherwise the entered side at its
  rate); the other side's rate is the implied one. A transfer fee is a separate categorized
  transaction, not linked to the pair. Scheduled cross-currency transfers are still refused
  ([#94](https://github.com/ikramhasan/strictbudget/issues/94)).
- Ready to Assign uses booked base amounts until an account is revalued; revaluation posts the
  difference to Ready to Assign (uncategorized on tracking accounts) as an "FX Revaluation" with
  native amount 0, locked against edits. On a card that owes, a loss adds debt without taking from
  Ready to Assign (shows as underfunded). Follow-ups: [#95](https://github.com/ikramhasan/strictbudget/issues/95).
- Account totals and net worth show today's market value (native balances at today's known rate),
  marked with "≈", in the budget's currency or the user's display currency (a per-user
  preference).
- A target can have its own currency while Available, Assigned and Activity stay in the budget's;
  it converts at today's rate, rounded up at the minor unit. With no rate at all its need is
  unknown and it's left out of Underfunded. Pay Off Balance and Monthly Debt Payment targets stay
  in the budget's currency. Follow-ups: [#93](https://github.com/ikramhasan/strictbudget/issues/93).
- Native and base columns in reports: [#57](https://github.com/ikramhasan/strictbudget/issues/57).

## Budget math

- The overdraft banner ("Overdraft? We can help with that!") has no "Next Steps" button: there's no
  help center to link to yet ([#81](https://github.com/ikramhasan/strictbudget/issues/81)).
- Undo/redo history is local to the open browser budget and deliberately disappears on reload, so
  partners cannot undo one another's history. Undo and redo still call the API, so the resulting
  budget/transaction state is saved on the server. It covers assigning, moving and auto-assign,
  plus single and bulk transaction create/edit/delete. A partner's later change to the same
  transaction makes its undo or redo stale: the API refuses it (409 `STALE_VERSION`,
  `expectedVersion`) and the entry leaves the history. Plan assign and move undo replay deltas,
  which can't overwrite. Scheduled, target, month note and account undo still replay snapshots:
  [#96](https://github.com/ikramhasan/strictbudget/issues/96). A bulk undo that hits a stale row part-way keeps the rows it already put back.
- The Assigned field moves with Up/Down between categories and takes typed math (+ − × ÷); Tab is
  ordinary focus order.
- Assigning in an archived budget (after a fresh start) is allowed, as every other edit is.
- Category templates: the gallery opens from the budget toolbar's ⋯ menu. Template group names
  match existing groups ignoring case, and hidden same-name groups count as a match. The
  descriptions are our own words (see [file import and export](file-import-export.md)).
- Upcoming scheduled transactions put a yellow calendar on a category's Available when it doesn't
  cover them, list under the inspector's Available Balance and count in Underfunded. Payment
  categories show their scheduled payments in the inspector but keep their own pill.
- The budget screen shows four columns from 768px up; a phone shows the name and Available, with
  the rest in the category's drawer, and below 1024px the inspector is a drawer (see
  [keyboard, mobile and accessibility](keyboard-mobile-accessibility.md)).
- The budget screen's row checkboxes select categories for the inspector; the bulk actions on a
  selection are auto-assign's.
- Funded card spending moves into each card's payment category, computed from history on every
  read (`fundedCardSpending`, no stored rows), cash first and then card activity in date order,
  equal same-day purchases by transaction id. Uncategorized funds and returns card money like any
  category. Credit overspending is yellow and stays out of next month's Ready to Assign. Payments
  from budget accounts come out of the payment category; statement credits and cash advances don't
  move payment money. A card's balance above zero is cash (see "Credit lifecycle and loans" below).
  Uncategorized card spending counts as credit overspending, except its cash part on a card with a
  positive balance, which is deducted like cash.
- A payment category's Activity lists the card's transactions for the month (its splits line by
  line) with a Spending / Returns / Funded Spending / Payments & Returns summary and Date, Payee,
  Category, Memo, Amount columns ("Group: Category"; payments show "Credit Card Payments:
  \<card\>"). "Cover Overspent Categories" switches to the Overspent view, and past months hide the
  alert and Current Balance; Current Balance and Available for Payment fold, and the folding is
  remembered in the browser. Auto-Assign reads Paid Last Month and Average Paid for one payment
  category and the spending labels when several are selected.
- The overspent note under a category name ("Overspent. $14.00 of $10.00") is the same grey for
  cash and credit; only the Available pill and the inspector change colour.
- Starting balances of cash accounts (and credit accounts that start positive) are categorized to
  the internal "Inflow: Ready to Assign" category.
- Credit-card starting debt has **no category** (the register shows "Category not needed"). It's
  existing debt, paid from money assigned to the card's payment category; `cardLedger` treats it as
  money to Ready to Assign, which counts only above zero, so it moves nothing.
- Deleting a category moves its transactions, assigned amounts and available money to the category
  picked. Moving to Ready to Assign or Uncategorized returns the money to Ready to Assign.
- Closing an account with a non-zero balance creates a "Manual Balance Adjustment" transaction; for
  on-budget accounts it's categorized to Ready to Assign. That takes the closing balance out of
  Ready to Assign, which keeps the budget's money equal to its accounts'. For credit accounts the
  adjustment counts only by the balance above zero.
- Ready to Assign Breakdown has no checkup or how-to-fix links: no help content yet ([#81](https://github.com/ikramhasan/strictbudget/issues/81)).
- Custom views: the views bar is in [budget screen toolbar](budget-toolbar.md). The group "+" still
  shows on group rows in a custom view.
- Recent Moves and the category move history name who moved the money, in the members' avatar
  colours, and Recent Moves can be filtered by member.
- Recent Moves shows the month on every category, with no calendar icon.
- The category move history button is offered in the current month and up to three months back.

## Targets

- Targets: weekly, monthly, yearly and custom (set aside, fill up to, have a balance of; one-time
  or repeating), with the inspector's Target section and editor, the row note and the yellow/green
  Available with its pie or check.
- Auto-Assign has Underfunded and Reduce Overfunding (in a fixed funding order, stopping at Ready to
  Assign, for the whole plan or a view); there are Underfunded and Overfunded views, and the
  summary's "Cost to Be Me" and "October's Targets".
- Snooze: inspector switch, Zz pill, Snoozed view. Progress bars have an On/Off toggle and the
  "Spent $x of $y" / "Fully Spent" notes.
- Credit card payment targets: Pay Specific Amount Monthly and Pay Off Balance by Date, with
  "Create a Debt Payoff Target", the payment inspector's Target section and their place in
  Underfunded, Reduce Overfunding and the month's targets. The form has no "Making minimum
  payments?" help link ([#81](https://github.com/ikramhasan/strictbudget/issues/81)). Loan Monthly Debt Payment targets are asked like a monthly set
  aside and due like a monthly target in Underfunded.
- Shift+Z snoozes or wakes the selected categories' targets.
- Underfunded funds upcoming scheduled transactions with the due-date step. Among card payments,
  those with a scheduled payment go first, then card payment targets, then plain Underfunded
  alerts, whatever the list order (`FundingPart.rank`).
- The summary has Expected Income (with its bars). A changed target applies from its start month
  (`startMonth`; a weekly one from the day it was created). Past months have no Assign, and the
  snooze switch is disabled outside the current month. A fresh start doesn't copy expected income.
- A payment target in a month before its card account existed asks nothing. The opening month is
  the card's first transaction's month; the month API marks the need `beforeOpening`.
- A category's history is reassigned on delete, but its target is deleted with it.

## Credit lifecycle and loans

- **Positive card balances:** `cardLedger` walks each card's lines by date and splits them at
  zero, including transfers between two cards and a split's lines in their order. A payment target
  can't be created on a card above zero; an existing one reads "Cheers to a debt-free future!" when
  met.
- **Closing** keeps the payment category visible and adds a "Closed Account" memo; a zero-balance
  account closes without a dialog. Edit account offers Close, or Delete while an account has only
  its starting balance; a closed account offers Re-open and Delete (disabled, with a tooltip, while
  it has history).
- **Working Balance** in Edit account adds a cleared Manual Balance Adjustment; a loan's is
  "Today's Balance".
- **Loan activity:** a loan's page (figures, Update Balance, Add Activity, paired category, Account
  Activity by month), interest and escrow worked out per month by `loanMonths` (engine) and counted
  in balances, Edit/Delete/Add Interest and Edit Escrow, credits and charges, Record Payment (loan
  page and the paired category's inspector), pairing (Add Account's optional step, Edit Account,
  Get Started), terms kept per month (`loan_terms`), and fresh start keeping pairing and terms.
- Update Balance's interest-rate/escrow check step: with a new rate or escrow the balance ends away
  from the entered amount, because every month stays frozen at its old charges. Account JSON terms
  come from `loan_terms` for the current month. Record Payment's From Account defaults per loan to
  the account of the payment into that loan entered most recently, else the first account in the
  plan's order.
- Transfer payees are stored as "Transfer : X" and worded when shown ("Payment: X" / "Transfer: X"
  on rows, by direction in the payee list). Saved rows show "Category not needed", transfers come
  first in the payee list, and the category list has a "Payment/Transfer" button. The card
  register's "? Payment" explainer waits for help content ([#81](https://github.com/ikramhasan/strictbudget/issues/81)).
- There's no built-in credit card interest category; interest goes to a user-made category such as
  "Interest & Fees".
- **Loan planner:** Payoff Date, Your Loan's Progress (chart, messages, the Past Balance popover
  that rebases the original schedule), the Loan Payoff Simulator, Share Your Progress, the banners,
  the paired inspector's paid-off message and "paid this month", and Monthly Debt Payment targets.
  Projections use the closed-form annuity formula with exact decimals (decimal.js), not floats, so
  no figure lands a cent off (a payment of exactly $10,050.00 shows as $10,050.00, not $10,050.01).
- Share Your Progress is offered on every open loan; the share picture carries the app's name.
- Loan banner dismissals are plan settings saved on the server: per loan for the paid-off banner,
  one flag per plan for the simulator banner.
- Lines of credit are treated as credit cards.
- Loan dialogs and future dates: Record Payment dated after today makes a one-time schedule, and
  credit/charge dialogs grey out Save. A balance adjustment's edit dialog doesn't grey out Save;
  the API still refuses the date with `DATE_IN_FUTURE`.
- Update to a Loan Account is offered from Edit Account only (there's no register banner for it).
  The Learn More dialog has no illustration or help link and the confirmation doesn't mention bank
  import (no help center or bank sync yet). The update isn't on the Undo stack.
- Re-opening an updated tracking account erases its link to the loan ("Erase & Re-open"), so it
  can be updated again. Deleting schedules also removes split schedules with a line transferring to
  the original.

## Onboarding and fresh start

- The setup flow (`/budgets/$id/setup`) is a checklist: "Personalize plan", "Add accounts" and
  "Fund categories" (which opens the budget to assign).
- Fresh start (`apps/api/src/lib/fresh-start.ts`) asks for the new plan's name and copies
  partners, categories (with their targets, which start in the fresh start's month, and their
  notes), payees, accounts (with their stars), custom views and their order, and scheduled
  transactions (future-dated transactions are schedules). It also copies payee renaming rules and
  payee categorization settings with their auto-categorization defaults. It doesn't copy month
  notes or expected income. The old plan becomes "Name (Archived on YYYY-MM-DD)"; it can fresh
  start again, and renaming the stamp away restores it.
- A fresh start drops all transactions, uncleared ones included, and every account starts at $0 (a
  $0 Starting Balance on the fresh-start date) for the user to update. Once bank sync arrives,
  linked accounts should start from today's balance instead ([#61](https://github.com/ikramhasan/strictbudget/issues/61)).

## Transactions and register

- The register API pages with keyset cursors (100 rows a page) and filters/sorts on the server.
  How running balances and search stay fast is in [production readiness](production-readiness.md).
- Search syntax is parsed by `parseSearch` (`register-search.ts` in `@strictbudget/engine`) and
  matched with `ilike`. `Is:` takes Approved, Unapproved, Needs Category, Unapproved or Needs
  Category, and Matched; On:/Before:/After: take partial dates.
- A term can't contain a comma (commas separate terms), so amounts with a thousands separator
  ("1,000") don't work as one term; type "1000".
- Sorting stacks and is kept per register in the browser (`strictbudget:register-view:*`); the
  register API takes a list of `column:dir` fields. Pending transactions don't exist yet
  ([#83](https://github.com/ikramhasan/strictbudget/issues/83)).
- Balances exclude transactions after the user's "today": every account route that returns
  balances takes `?today=`. Without it, the server's UTC date is used.
- Reconciled transactions keep their lock for good (there's no unreconcile); edits that can put a
  reconciliation out of balance ask first.
- The Reconcile popover has no "How do I find my account balance?" link and no help box on the
  difference step: no help center yet ([#81](https://github.com/ikramhasan/strictbudget/issues/81)).
- Payee auto-categorization follows Manage Payees' Categorization setting. The default is stored
  and updated as transactions are added or edited (see
  [file import and export](file-import-export.md)). A fresh start carries the default in
  `payee.carried_category_id`.
- A fresh start keeps an "Always use my choice" payee's category (mapped to the new budget's
  category). The "Last 3 transactions" dialog shows only the category name, not its group.
- Renaming rules: the API refuses whitespace-only rule text. Undoing a rule removal re-creates the
  rule in its place with a new id and creation time, so it counts as newest for "newest rule wins".
  File imports apply them.
- "Create … Payee" is a button above the payee list, so the arrow keys and autocomplete only ever
  highlight existing payees.
- shadcn has no Autocomplete wrapper, so `packages/ui/src/components/autocomplete.tsx` wraps Base
  UI's Autocomplete (payee field) with the combobox styling. Replace it if shadcn adds one
  ([#53](https://github.com/ikramhasan/strictbudget/issues/53)).
- Editing an existing transaction is cell by cell; a transaction can be moved to another account
  only from the All Accounts register (its account cell).

## Transfers

- A transfer whose other side is reconciled can be changed or deleted after a warning; the other
  side follows and stays reconciled. Undoing a deleted transfer brings its other side back with its
  own memo, cleared state, flag, approval and category. A changed memo is copied to the other side;
  bulk Memo changes only the selected side, so the two can differ, and undoing a bulk Memo can then
  overwrite the other side's memo.
- Undo re-creates a deleted transaction (new ids) with both sides' state. Closing an account isn't
  on the undo stack; undoing past a close restores into the closed account. `restore: true` on
  create is the only way to write a transfer into a closed account; plain new transfers to closed
  accounts are refused.
- Transfers to and from a credit card store no category; the register shows the card's payment
  category on a card↔cash transfer. A payment from a budget account moves money out of the card's
  payment category.
- The close-account dialog only zeroes the balance with a Manual Balance Adjustment. A "transfer
  the balance to…" choice was considered and left out for now.
- Transfers between accounts in different currencies have an amount on each side (see
  Multi-currency).

## Splits

- A split is edited as a whole; its lines can't be edited a cell at a time. Its category reads
  "Split (N categories)". Auto-Distribute gives the remainder to the first line rather than using
  the engine's largest-remainder `allocate()`, and isn't offered when the non-zero lines add up to
  $0.
- The transaction a split's transfer line keeps in the other account only takes memo, cleared and
  category there (409 `TRANSFER_IN_SPLIT` otherwise); date, amount and deletion go through the
  split. The register hides those cells and the delete action.

## Bulk edit

- Categorize (un-split dialog; splits with transfer lines stay split), Flag, Clear / Mark as
  Cleared / Mark as Uncleared (reconciled rows skipped), Memo… (replaces), Move to Account, Delete
  (no confirmation), Duplicate, Enter Now, Make Repeating, Approve, Reject, Match and Export, each
  skipping the rows it doesn't apply to.
- Delete has no confirmation because Undo/Redo is in the register toolbar. Single and bulk
  transaction deletes can be undone locally during the current page lifetime; reloading
  intentionally clears that history so partners never share an undo stack.
- Bulk Categorize is a menu of category groups with their categories as submenus. Its arrow keys
  are the menu component's. Its keyboard shortcuts are K, C, and Shift+F then 0–6.
- A split with an uncategorized line needs a category. Bulk Cleared and Categorize approve
  unapproved rows; bulk Memo, Flag and Move don't.
- Changing the search or filters clears the selection.

## Scheduled transactions

- Due occurrences are entered when a read arrives with the user's `today` (register, accounts,
  month, activity); nothing is entered without a `today` (the server's UTC date could be a day
  early). There's no background job on purpose: an occurrence is due by the user's date, which only
  a client knows.
- Transactions entered on their date are stored unapproved and show in the register's review
  banner.
- Create and edit take the user's `?today=` and refuse later dates (`DATE_IN_FUTURE`). Without it,
  dates up to the server's UTC date plus a day are allowed; a given today is capped there too. An
  undo restore isn't checked, and an edit that keeps a row's date isn't either.
- The migration that turned existing future-dated transactions into one-off schedules keeps one
  schedule per transfer (from its outflow side); the other side's memo, flag and cleared state
  aren't kept.
- Undoing a reschedule (or a delete) of a transfer to an account closed since brings the
  transaction back into the closed account (`restore`); the account stays closed.

## Flags

- Flags are per transaction; split lines have none. The register can be filtered by flag.
- The flag menu is a popover with plain buttons (`apps/web/src/components/flag-menu.tsx`), not a
  Radix dropdown, because it switches into a form for renaming. Up/Down/Home/End move between its
  items.

## Accounts

- Changing an account's type is allowed only within the same family (cash, credit, loan,
  tracking), where no money moves. Cross-family changes aren't planned.
- Loan accounts keep interest rate, minimum payment and escrow per month; the payoff planner
  projects with this month's.

## Budgets and sharing

- Sharing is per budget (there are no subscriptions or groups): the owner invites, and a budget
  has at most 6 people, pending invitations included. Invitations last 14 days, with a reminder
  email 3 days before expiry (see [production readiness](production-readiness.md) and
  [invitation links](self-hosted-vs-cloud.md)).
- The invitation email names only the inviter's address: budget and display names are free text,
  shown on the invitation page instead.
- Roles: the owner invites as an editor or a viewer and can switch a member's role; `viewerGuard`
  refuses every budget write of a viewer (403 `READ_ONLY`) except leave, reconcile preview and
  transaction selection, and the web hides or disables what changes the budget.
- Member avatar colours: the owner gets avatar-one, then avatar-two to six by when people joined.
  A member who left keeps their own colour and initial, with "Name (removed)"; once their user is
  deleted, the avatar is the grey inactive one ("Inactive Member"). Same-initial patterns show
  with Display Options → Differentiate Without Color.
- The change log is written by triggers (migration 0038) for every budget table, in the request's
  transaction: signed-in writes run in one DB transaction carrying the actor (`requireAuth`),
  except budget create, delete and fresh start, which go through Better Auth's plugin on its own
  connection and set the actor in their own transactions (a rollback there can't undo the
  plugin's rows). Bookkeeping-only updates aren't logged; a deleted budget takes its history; a
  deleted user's id is cleared from shared budgets' history and transactions. Scheduled
  occurrences entered on a read have no actor (source "scheduled").
- "Entered by" is an optional register column (View menu, off by default) and a History dialog per
  transaction.
- Live updates: the server streams server-sent events from the triggers' `pg_notify`, and the web
  app refetches the budget's queries on another tab's change.
- `session.active_organization_id` (added by the plugin) is unused; the current budget lives in the
  URL.

## Account and security

- Client IP for rate limits, queued emails and the taken-address check during an email change are
  in [production readiness](production-readiness.md).
- The sessions list shows when a device signed in, not live activity: Better Auth refreshes a
  session row about once a day.
- Old email links aren't revoked by newer ones: a confirmation link works until it expires (1
  hour), as Better Auth's stateless tokens do. Reset links are single-use and stored hashed.
- Two-step verification: an authenticator app and one emergency backup code; turning it on signs
  out other devices; turning it off asks for a code. Set-up first asks for the password (Better
  Auth's enable endpoint requires it). The backup code works once and can't be regenerated. No
  "remember this device".
- The breach check (Have I Been Pwned) fails closed: if its API is down, sign-up, reset and
  change-password refuse with "Failed to check password" until it's back.

## Libraries

- `@dnd-kit/react` is pre-1.0. Expect API changes on upgrades; the drag-and-drop code is in
  `apps/web/src/components/category-list.tsx` and the account sidebar ([#53](https://github.com/ikramhasan/strictbudget/issues/53)).
