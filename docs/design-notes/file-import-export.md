# File import and export

## File import

- Payee names aren't cleaned up on import (a bank's raw text stays as is), so Bank Import Details
  shows the same text twice ([#100](https://github.com/ikramhasan/strictbudget/issues/100)).
- Import ids are `EC:<minor units>:<date>:<occurrence>`, the amount in the budget's minor units.
  Every id an account has taken in is kept (`account_import_id`), so deleted imported rows never
  come back.
- Amounts are read in the budget's number format. Rows whose date or amount can't be read are
  listed as "N rows can't be read (line …)".
- The date-format question shows inline under the column selects, not as a popover on Date.
- "Start date" is the account's oldest transaction, and "last reconciliation" is the newest
  reconciled transaction's date. A 3-day rule after a reconcile, and matching to scheduled
  transactions, aren't built ([#102](https://github.com/ikramhasan/strictbudget/issues/102)).
- A new payee's inflow goes to Ready to Assign only in checking, savings and cash accounts; on a
  card it stays Uncategorized.
- Imports apply the payee renaming rules.
- An import can't be undone with Undo; the rows can be deleted or rejected. Match and Unmatch can
  be undone.
- One file at a time. The "(Imported As …)" tooltip and mobile details aren't built.
- A manual Match with a different amount is refused when the entered side is a split or a
  transfer. M matches and Shift+U unmatches from the keyboard.
- "Don't Rename as …" applies at once (back to the imported payee, rule removed).

## Export and backup

- The export zip is "strictbudget Export - …". Exports start without a confirmation and aren't
  filtered by the register's search, and scheduled transactions aren't included ([#99](https://github.com/ikramhasan/strictbudget/issues/99)).
  Registers with foreign-currency accounts get four extra columns after the standard ones
  ([#57](https://github.com/ikramhasan/strictbudget/issues/57)).
- Backups leave out members, invitations, the change history and the shared FX rate cache. The
  restored budget keeps the source's createdAt and starts unarchived. File-import state (import
  ids, settings, matches) and payee defaults are included.

## Importing a YNAB budget

The importer (`apps/api/src/lib/external-import`) reads a YNAB budget through its API, or from its
exported files.

- It runs as one request with a final report, not live progress.
- Loans come over unpaired and their Monthly Debt Payment targets are skipped.
- "Every N weeks" targets are skipped.
- The token is never stored.
- Re-importing a plan returns the earlier budget unless replace is asked for.
- The files fallback guesses account types and pairs transfers heuristically.
- All of this is tracked in [#103](https://github.com/ikramhasan/strictbudget/issues/103). A $2 difference on two imported credit cards is [#101](https://github.com/ikramhasan/strictbudget/issues/101).

## Payees, pickers, loans and templates

- Payee defaults are stored and updated when transactions are added or edited. Payees replay their
  history until their first add or edit after migration 0046. Edge cases are in [#104](https://github.com/ikramhasan/strictbudget/issues/104).
- "Create … Payee" is a button above the payee list, so the arrow keys never land on it.
- Loan upcoming payments: transfers out of a loan aren't listed.
- Template notes are our own words (`category-template-notes.ts`), written for each "About This
  Template" category only.
