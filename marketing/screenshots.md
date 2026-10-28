# Screenshot inventory

Every screenshot of the app that the site, the blog or the README uses. Check this first; see
"Images from the app" in `marketing/README.md` for the bar and how to capture.

| Path | Shows | Size | Theme | Used by | Meets the bar? | Captured |
|------|-------|------|-------|---------|----------------|----------|
| `apps/site/public/screenshots/budget-{960,1440,2880}.webp` | Budget screen, Oct 2026: Bills / Needs / Wants, All Money Assigned, Summary, Spending Pace, Auto-Assign | 2880×1800 | Light | Home page hero | **No** (1, 2, 3) | 2026-10-28 |
| `docs/screenshots/budget.webp` | Budget screen, same state as above | 2880×1800 | Light | README | **No** (1, 2, 3) | 2026-10-25 |
| `docs/screenshots/budget-dark.webp` | Budget screen, same state | 2880×1800 | Dark | README | **No** (1, 2, 3) | 2026-10-25 |
| `docs/screenshots/multi-currency.webp` | Berlin Checking (EUR) register in a USD budget: each amount with its USD value, unrealized gain/loss, Revalue | 2880×1290 | Light | README | **No** (1, 2) | 2026-10-25 |
| `docs/screenshots/reports.webp` | Reports overview: stat cards, Spending, Income and spending, Observations | 2880×1800 | Light | README | **No** (1, 2, 4) | 2026-10-25 |
| `docs/screenshots/spending-breakdown.webp` | Spending Breakdown, Oct 2026: donut and category list | 2880×1800 | Light | README | **No** (1, 2) | 2026-10-25 |
| `apps/site/public/screenshots/credit-card-overspent-{960,1440,2880}.webp` | Budget, Oct 2026, "Nadia & Sam": Dining out −$24.50 credit overspending, the Juniper (Visa) payment category's Overspent Categories alert, $682.01 of $706.51 set aside | 2880×1230 | Light | `/blog/credit-cards` | Yes | 2026-10-28 |
| `apps/site/public/screenshots/credit-card-covered-{960,1440,2880}.webp` | Same budget after moving $24.50: Juniper payment $706.51, "You have enough money to pay off your current balance!", Record Payment | 2880×930 | Light | `/blog/credit-cards` | Yes | 2026-10-28 |
| `apps/site/public/screenshots/credit-card-payoff-target-{960,1440,2880}.webp` | Harbor (Mastercard) payment category: Pay Specific Amount Monthly $300.00, target met, $2,100.00 owed | 2880×850 | Light | `/blog/credit-cards` | Yes | 2026-10-28 |
| `apps/site/public/screenshots/credit-card-health-{960,1440,2880}.webp` | Credit Card Health report, Oct 2026: $2,806.51 owed, Juniper "Paid in full ready" with six months of bars, Harbor "Unfunded debt" | 2880×1800 | Light | `/blog/credit-cards` | Yes | 2026-10-28 |

What fails the bar:

1. Accounts show letter placeholders instead of logos.
2. "Berlin Checking" and "London …" are cut off in the sidebar.
3. Cost to Be Me shows $0.00 targets and the "Enter your expected income" prompt.
4. Income and spending has only two months of data; May to August are empty.

Before using any of these, recapture it to the bar and keep the same path.

## Demo data used for captures

When you enrich the seeded "Demo Household" for a capture, list here what you added (accounts and
their logos, currencies, months of history, targets), so the next capture starts from the same
state.

### "Nadia & Sam" (credit card post, 2026-10-28)

A second budget for the demo user, built entirely by `marketing/screenshot-data/seed-credit-cards.mjs`
(it deletes and rebuilds the budget each run):

- USD; accounts Checking and Savings (logo `northwind.png`), Juniper, a Visa paid in full
  (`juniper.png`), and Harbor, a Mastercard opened at −$4,200.00 (`harbor.png`). Logos are made-up
  marks in `marketing/screenshot-data/logos/`. Account names are short so the sidebar doesn't cut
  them off.
- April to October 2026: two $2,475.00 paychecks a month, rent and bills from checking, $1,400.00
  a month to savings, the Visa's spending (statement paid on the 21st), Harbor's interest at
  24.99% APR on the 3rd and $300.00 plus the interest paid on the 20th.
- Targets on every category (refill for Groceries, Transportation, Dining out, Entertainment and
  Interest & Fees), a balance target on the emergency fund, Pay Specific Amount Monthly $300.00 on
  Harbor's payment, expected income $4,950.00. Each month: Auto-Assign Underfunded, then the rest
  to the emergency fund.
- October ends with Dining out $24.50 overspent on the Visa; `seed-credit-cards.mjs fix` moves
  $24.50 from "Stuff I forgot to plan for".

To capture: sign in once (the API rate-limits sign-ins), save the session cookie to a file, run the
seed with `COOKIE_FILE`, build and preview the web app (see the README), then
`marketing/screenshot-data/shot.mjs` with `BUDGET` set. The four images above came from the
budget screen with Bills and Needs collapsed (and Wants for the Harbor one) and a payment
category's checkbox ticked, cropped vertically only so each stays 2880 wide.
