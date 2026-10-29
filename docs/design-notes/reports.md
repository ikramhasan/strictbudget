# Reports

## Principles

- **Numbers are fixed, visuals are ours.** The five core reports (Spending Breakdown, Spending
  Trends, Net Worth, Income v Expense, Age of Money) keep fixed definitions of what counts as
  spending and income, transfers, card payments and starting balances, and a CSV/TSV export in a
  stable layout. Their charts, interactions and extra views are strictbudget's own.
- **Reports home** is the entry point ("Overview", the first tab). The five core reports follow as
  tabs, then the other reports (Budget vs Actual first).
- **Comparison mode and drill-down on every report.** Drill-down opens one side sheet; its rows
  open the register.
- **Payee and flag filters** sit next to the category and account filters (spending by flag:
  [#91](https://github.com/ikramhasan/strictbudget/issues/91)).
- **Observations are rule-based, not AI**, and so is recurring-charge detection ([#88](https://github.com/ikramhasan/strictbudget/issues/88)).
- Exports are named `strictbudget-reflect-<report>-<date>`. Uncategorized comes first in the
  spending exports and series. Export amounts keep the budget's symbol position and decimal mark.
- Colours: one colour per category and group across every report (plan order through Okabe–Ito's
  colour-blind-safe hues, Uncategorized grey), defined for both themes as `--report-1..8`.

## Per report

- **Spending Breakdown**: the donut draws every slice (no "Everything Else" slice) and uses the bar
  list as its legend. Also: treemap, % of income per row, Payees/Accounts/Flags breakdowns
  (positive rows headed "Positive Inflow Payees/Accounts/Flags"), comparison ghost bars and change
  column, 10 largest transactions, table view. Most Frequent ties: more spent first, then name
  (to be confirmed: [#98](https://github.com/ikramhasan/strictbudget/issues/98)).
- **Spending Trends**: lines (top 5 + Other), 100% share, small multiples, calendar heatmap (weeks
  from Sunday, four quartile shades, click a day), series by group, comparison, average and rolling
  3-month lines, above-average shading, change vs previous month in the tooltip, per-series table.
  The API has a day grouping and day bounds for this.
- **Net Worth**: foreign balances convert at each month-end's rate (override, cache, provider,
  nearest earlier); with none, the account is left out of that month and listed. The export writes
  0.00 before an account's first month. "What changed this month" splits the change into net saved
  from income, debt paid down, tracking accounts and other, always adding up exactly. All-time-high
  markers; a "This month" figure next to the headline; the register's collapsible "Balance over
  time" (24 months, not on loans, which have their own chart).
- **Income v Expense**: a chart above the table (income up, expenses down, net line, net-loss
  months shaded), a display-only Savings rate row, opt-in "Shade unusual spending", the side-sheet
  drill-down; folds kept in the browser under `strictbudget:income-expense-collapse`.
- **Age of Money**: no 30-day reference line, because there's no universal target. Also: change vs
  30 days ago, table view, PNG. The 6M/1Y/2Y switch defaults to 6M. A negative starting balance and
  card→cash transfers are ignored; same-day outflows go in entry order ([#97](https://github.com/ikramhasan/strictbudget/issues/97)). Splits count once
  (their lines' total less lines between cash accounts); FX revaluations are left out.
- **Plan sidebar**: no content-feed card. The summary's Activity links to Spending Breakdown for
  the month and its categories.
- **Reports home** tiles: spending vs the 6-month average (from the first month with spending), net
  worth, savings rate of the last complete month, Age of Money, and months of runway (cash in open
  budget cash accounts ÷ the average spending of the last 6 complete months). Observations:
  overspent categories (card payment categories left out), spending ≥ 25% above the 6-month
  average and at least $25 in the budget's currency, a new all-time net worth high, lower income in
  the last complete month than the one before, new payees among the month's top ten; at most two
  per rule, five in all.

## Other reports

- Built: Budget vs Actual, Spending pace, Savings rate and income sources ([#89](https://github.com/ikramhasan/strictbudget/issues/89)), Cash flow
  ([#86](https://github.com/ikramhasan/strictbudget/issues/86)). Open: cash-flow forecast ([#64](https://github.com/ikramhasan/strictbudget/issues/64)), category history ([#87](https://github.com/ikramhasan/strictbudget/issues/87)), payees and
  recurring charges ([#88](https://github.com/ikramhasan/strictbudget/issues/88)), debt payoff and interest paid ([#90](https://github.com/ikramhasan/strictbudget/issues/90)), spending by flag ([#91](https://github.com/ikramhasan/strictbudget/issues/91));
  later: monthly review and year in review ([#92](https://github.com/ikramhasan/strictbudget/issues/92)), saved reports, dashboard and PDF ([#65](https://github.com/ikramhasan/strictbudget/issues/65)).

### Budget vs Actual

- Numbers are the plan's own (`budgetHistory` + `categoryMonth`), so each month's Assigned,
  Activity and Available equal the plan screen's. Spent = −Activity (cash and credit, refunds
  netted in). Under / on / over plan = spent < / = / > Assigned, exactly.
- Assigned is the month's Assigned, so money moves count where the money ended up (the page says
  so).
- Ready to Assign and credit card payment categories aren't rows (no plan for spending; card
  spending shows under its categories). The summary gives total Assigned, Spent, Left/Over and % of
  plan.
- Hidden categories are listed in their group, marked Hidden, when they have Assigned or Activity
  in the range; Uncategorized comes first when it has activity. Groups and the categories in them
  sort most over plan first, ties in plan order.
- Target tick = the sum of what the target asks of each month of the range (`monthAmount`).
- Heatmap: the range's months reaching back to 12 (not before the plan's first month), cells
  spent − Assigned on a blue/vermillion diverging scale, overspent months ringed red (cash) or
  yellow (credit). Over-plan count: months of the last 12 (that the plan has) spending more than
  Assigned.
- Filters: range and categories only (Assigned has no account, payee or flag). Export: one CSV/TSV
  of the variance table with group totals and a total row.

### Spending pace

- **Money to spend** is each category's Available carried in plus the month's Assigned, so money
  assigned mid-month raises the whole month's line rather than stepping it up on that day; money
  moved out lowers it. Spending is the categories' net activity (Spending Breakdown's definition),
  so a refund gives money back.
- **Ideal pace** is an even line from the start amount to zero at the end of the month's last day,
  rounded down. **Status:** spending within one day's share of the even pace counts as on pace;
  less is ahead, more is behind. **Today counts as passed** for the status and projection, and as
  still to come for safe-to-spend-per-day, which is rounded down to the minor unit.
- **Projection** keeps the average daily spending so far until the month's end, rounded down. "Ran
  out" is the day the money last went below zero, while it still is (a dip that a refund made good
  is forgotten).
- **Left out of the plan's line by default** (each category's switch overrides this, stored as
  `category.pace`): card payment categories (always; they aren't listed), bills (a monthly target
  due on a set day, a dated yearly or custom target, a debt target), savings (categories marked
  "Counts as saving" on the Savings rate report, and ones with a "Have a balance of…" target, so
  existing savings categories stay out without the flag: [#119](https://github.com/ikramhasan/strictbudget/issues/119)), categories with any
  scheduled transaction or scheduled split line, and hidden categories. Hidden comes first, then
  "Counts as saving", so an investment category with a scheduled transfer reads as saving. Savings
  with neither still count until the user switches them off.
- A group's line counts that group's categories that are in pace; a single category's line shows
  it even when it's out of pace. Past months show the finished burndown; future months return 400
  and the report doesn't offer them.

### Savings rate and income sources

- **Two rates, and a toggle between them.** The plain rate is Income v Expense's (net income ÷
  income), so it can be checked against YNAB. The default rate counts savings, which is
  strictbudget's own, a deliberate difference from YNAB: (left over + spending in categories that
  count as saving + money moved to tracking asset accounts) ÷ income. In YNAB, money funded into
  investments through a category shows only as spending.
- **Each spending line is in one bucket**, decided in SQL: its category counts as saving, else it
  is a transfer to a tracking **asset** account, else it is ordinary spending. A transfer to the
  brokerage in an Investments category that counts as saving is counted once. Loan and liability
  accounts aren't saving (debt payoff is [#90](https://github.com/ikramhasan/strictbudget/issues/90)).
  Refunds and money brought back into a bucket net against it.
- **Income stays Income v Expense's.** Money brought back from a tracking asset account into Ready
  to Assign is income there. The saving rate takes it off its income and off "moved", so moving
  $1,000 out and $400 back saves $600.
- **"Counts as saving"** is a per-category setting (`category.counts_as_saving`, off by default).
  It is switched on the report itself, as Spending pace's switch is. A category is suggested when
  at least half of its outflows in the range went to tracking accounts. The goal is per budget,
  in basis points, and is drawn as a dashed line.
- A month with no income (or none left after money from tracking accounts) has no rate: a gap,
  not 0% or ∞. The rolling 12-month rate sums the window's money (fewer months before the first
  transaction); it doesn't average monthly rates.
- **Income sources:** the five largest payees in the range, the rest folded into "Other income".
  The cash flow report folds the same way, with one helper (`foldTail`). Steadiness counts months
  received up to the current month. The headline compares with the previous period of the same
  length.
- The Reports home tile is still Income v Expense's rate of the last complete month. It opens this
  report on the plain rate, so the two numbers match.

### Cash flow

- A Sankey (Recharts' `Sankey`): income sources → Income → groups (Uncategorized first, then plan
  order) → an expanded group's categories, with what's left going to **Saved**. When spending
  exceeds income, the shortfall comes into Income **from savings**. Income and spending are Income
  v Expense's, so the totals agree, and every node's inflows equal its outflows in minor units.
- A Sankey can't draw a negative flow, so each net goes to the side its sign puts it on. A
  category that got back more than it spent feeds Income as **Refunds**; a payee whose income nets
  below zero flows out as **Income paid back**. Saved − from savings is still Income v Expense's
  net income.
- Sources fold to the top five and "Other income", the same way as the savings rate's income
  sources. Groups, and an expanded group's categories, under 2% of the flow fold into "Other".
  "Show small flows" turns the folding off; it and the expanded groups are kept in the URL. The
  tooltip shows the share of income, or of the money spent when nothing came in.
- On phones (under 768px) the report is its table: a Sankey doesn't fit 400px.

## Rules every report follows

- Money stays exact: amounts arrive as integer strings, the client turns them into numbers only to
  position chart marks (`chartNumber`), and every label, tooltip and table cell is formatted from
  the exact amount. Percentages and ratios (savings rate, runway, % of total) are display only.
- Every chart has a table view (the accessible alternative), and works in both themes and at phone
  width.
- Performance: 50k transactions over 10 years sum in 30–70 ms with the
  `transaction(budget_id, date)` index; there's no monthly rollup.
