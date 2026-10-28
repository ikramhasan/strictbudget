# Brief: budgeting with credit cards (`/blog/credit-cards`, rewrite)

Rewrite of the September post, which was about 300 words: one example, no screenshots, nothing on
returns, interest, paying down old debt or the statement balance. Research:
`marketing/research/2026-10-28-credit-cards.md`.

## Target

- **Main keyword:** budgeting with credit cards (320/mo US, Serpstat difficulty 8).
- **Also covers:** credit card budget, budgeting credit cards, budget with credit card, how to
  budget with a credit card, ynab credit card payment / ynab credit card overspending (readers
  coming from YNAB; mention once, fairly, that it's the same method).
- **URL:** keep `/blog/credit-cards`. It's published and linked; the keyword goes in the title,
  description, headings and alt text instead.
- **Intent:** informational. The reader uses cards and wants to know how to budget around them
  without the bill surprising them, or uses YNAB-style budgeting and doesn't get the payment
  category.

## How it beats YNAB's version

YNAB's "How to Do Credit Cards in YNAB" is about 650 words with no worked amounts.

1. **Worked numbers:** one household's October with two cards (a Visa paid in full, a Mastercard
   with old debt at 24.99% APR), every purchase, the return, the interest charge and both
   payments, with the balances before and after.
2. **The real app:** five screenshots of that exact month: the overspent budget rows, the
   payment category's alert, the covered card with Record Payment, the debt card's $300 payment
   target, and the Credit Card Health report.
3. **Complete:** returns, cash vs credit overspending, statement vs current balance, interest,
   paying down old debt, statement credits and cash back, a card paid above zero.
4. **Something to use:** a payoff table for $2,100 at 24.99% at five payment sizes (months and
   interest from the engine's `payoffProjection`), plus the household's own plan.

## Outline

1. Direct answer up top (quotable): a card purchase spends money you already have; it moves from
   the spending category to the card's payment category; old debt is paid on purpose.
2. The two cards and where they stood on October 1st.
3. Every card gets a payment category; starting debt has no category.
4. One purchase, before and after (table). The whole month on the Visa (table).
5. Paying the bill: statement vs current balance, Record Payment, why Ready to Assign doesn't move.
6. A return.
7. Credit overspending: Dining out $24.50 over; the fix; cash vs credit overspending. Screenshots.
8. Interest gets its own category ($2,400 × 24.99% ÷ 12 = $49.98).
9. Paying down old debt: the $300 target, payoff table, Pay Off Balance by Date. Screenshot.
10. Credit Card Health report. Screenshot.
11. Questions: statement vs current balance, cash back, a card above zero, already have debt,
    should you stop using cards.
12. CTA.

## Facts checked in the app (local build, 2026-10-28)

- Funded card spending moves into the payment category; credit overspending is yellow and isn't
  taken from next month's Ready to Assign; cash overspending is (design notes, `credit.ts`).
- Starting card debt has no category ("Category not needed").
- A $25 statement credit categorized to Ready to Assign on a card that owes: Ready to Assign stays
  the same, the card owes $25 less, the payment category keeps its amount (tested, then deleted).
- Pay Off Balance by Date spreads what's owed over the months left, without interest
  (`payoffNeed` in `targets.ts`).
- Card accounts have no APR field; interest goes to a user-made category.

## Data and screenshots

Budget "Nadia & Sam" as the demo user; how to rebuild it is in `marketing/screenshots.md`.
