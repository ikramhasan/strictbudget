# Savings

Why savings works the way it does, and what was decided (Cycle 14c). The research behind it: about
930 r/ynab threads with "savings" in the title (2021–2026), YNAB's own help and blog, and how other
apps (Monarch, Actual, Firefly III, Simplifi, Ally buckets, Monzo pots…) do it.

## What people struggle with in YNAB

- Category balances don't match account balances ("$760 in my EF category, $1,400 in my EF
  account"), and YNAB's answer is that the account doesn't matter.
- Savings on budget floods Ready to Assign and is easy to raid; savings off budget (tracking) makes
  every contribution show as spending in reports.
- Interest, and targets that can't say "keep $10,000 and refill it after I use it": "Set aside"
  asks forever, "Have a balance of" is one-time, and spending a goal's money on what it was for
  wipes its progress.
- No savings rate or "how much do we have saved?" answer.

## The model

**Money has two facts: what it's for and where it is.** The plan answers the first; savings
makes "for a goal" a first-class answer instead of a naming convention.

- **Savings categories** (`category.savings`): a category is Spending or Savings, chosen when it's
  created (or in the rename popover and the inspector). Savings rows carry a piggy bank; the month
  summary splits Available into **In Savings** (savings categories' positive Available, hidden ones
  included under All) and **Available to Spend**. Payment categories can't be savings; a loan's
  paired category isn't offered it. New budgets start with Emergency fund and Vacation as savings;
  template imports mark categories in savings groups or named like savings (`looksLikeSavings`,
  whole words, so "Emergency Radio" doesn't count).
- **Savings goals** (`category_target.goal`, `goal_amount`), stored on the target cadence that
  works them out, so Underfunded, Cost to Be Me, snooze, currency and undo work unchanged:
  - **Save up for something**: a total by a date (custom one-time set aside) or so much a month
    (monthly set aside with a goal amount). It counts what was **put in**: the money in the
    category when it began plus Assigned since. Spending it on the holiday leaves it "Goal
    Reached. Spent $2,400.00 of $3,000.00"; moving money out lowers it. Past its date it keeps
    asking for what's left. Editing it keeps its start month (unless its currency changes), so
    progress survives edits.
  - **Keep a safety fund**: a balance to keep, refilled all at once or at most so much a month
    (`min(amount, goal − carried in)`). A full fund adds nothing to the month's targets (a plain
    refill target counts its whole amount).
  - **Keep saving**: so much every month, no ceiling. Its outflows count as saved in reports (a
    401(k) contribution recorded as an outflow).
  - A savings category can still take any other target ("Use another kind of target").
- **The goal editor's preview** uses the plan's own sums (what was in before this month, then this
  month's Assigned), so what it promises is what the plan then asks. No preview for a goal in
  another currency.
- **Taking money out of savings** isn't blocked, but never silent: Move money and the cover / Fix
  This pickers say what it does to the goal ("…will be $1,200.00 below its $10,000.00, and its
  goal will ask for it back", "…progress drops to $1,300.00 of $1,500.00"), and cover / Fix This
  list savings last under "Savings". Later months' Fix This sources get the general note.
- **Reports**: saving is not spending; see [reports](reports.md) ("Saving isn't spending").
  Spending a save-up goal or a safety fund on what it's for is spending.

## Deliberately not (yet)

- A link between a savings category and the account that holds its money ("Kept in"), with a
  per-account breakdown and transfer hints; interest routed to a goal; a Savings page. Proposed with
  the research, not part of this cycle: [#142](https://github.com/ikramhasan/strictbudget/issues/142).
- No hidden balances or separate savings budgets.
- How `category.savings` relates to #89's "Counts as saving" (open PR #134):
  [#141](https://github.com/ikramhasan/strictbudget/issues/141).
