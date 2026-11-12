# strictbudget open GitHub issues that touch savings (read 2026-11-12)

Source: github.com/ikramhasan/strictbudget issues, read through the GitHub API. These are the
project owner's own, already-decided or in-flight plans; a savings plan must build on them, not
contradict them silently.

## #89 "Report: Savings rate and income sources" — OPEN, milestone "Cycle 14b · Reports II"
https://github.com/ikramhasan/strictbudget/issues/89 — closing PR #134 is OPEN (not merged):
"Add the Savings rate and Cash flow reports; leave saving categories out of pace"
https://github.com/ikramhasan/strictbudget/pull/134

Key content (verbatim extracts):
- "Line of monthly savings rate (net income ÷ income, from the Income v Expense definitions) plus a
  rolling 12-month line, which is the steadier number; a user-set goal line (stored per budget,
  optional). Months with no income show a gap, not 0% or ∞."
- "What counts as saving (added 2026-10-18)": "Most YNAB users fund investments and savings through
  a category, so the money shows as spending and net income alone understates their savings rate
  (r/ynab users complain that moving money into investments shows as an outflow)."
- "Add a per-category setting **"Counts as saving"** (stored per budget, off by default; suggest it
  for categories whose outflows are mostly transfers to tracking accounts). Spending in those
  categories is added back as saving."
- "Transfers from on-budget accounts to tracking (off-budget) asset accounts also count as saving.
  Transfers to debt accounts don't (that's Debt payoff, #90), unless the user marks the payment
  category as saving."
- "Formula: savings rate = (net income + spending in saving categories + transfers to tracking
  assets, without double counting a transfer that is also categorised) ÷ income. Show the breakdown
  under the chart: "Left over $X · Saved via categories $Y · Moved to tracking accounts $Z"."
- "A toggle switches between this rate and the plain Income v Expense rate, so the number can still
  be checked against YNAB."

## #119 "Spending pace: leave out #89's saving categories" — OPEN (also closed by PR #134)
https://github.com/ikramhasan/strictbudget/issues/119
- "Spending pace leaves saving categories out of the plan's line by default. #89's per-category
  "Counts as saving" setting doesn't exist yet, so pace uses a stand-in: a category with a "Have a
  balance of…" target (`behavior = balance`) counts as saving (reason `saving` in
  `GET /reports/spending-pace`). Savings without a target (for example the demo's Emergency fund)
  still count in pace unless the user switches them off."
- To do once #89 lands: give categories marked "Counts as saving" the reason `saving` in
  `automaticReasons` (`apps/api/src/routes/reports/spending-pace.ts`); "Decide whether the
  balance-target stand-in stays as well."

## #132 "Keep target history so reports show past targets" — OPEN, no PR
https://github.com/ikramhasan/strictbudget/issues/132
- `category_target` has one row per category and is overwritten in place, so past months show the
  current target. Proposal: a `category_target_revision` table (target fields + `validFrom` month +
  `validTo`), written on every path that changes a target.
- Relevant to savings: any goal-progress history ("was I on track in March?") depends on this.

## Implication for the savings plan
A per-category "Counts as saving" flag and a savings-rate report are already designed (#89) and
implemented in an unmerged PR (#134). The savings plan should treat that flag as the seed of the
"saving" concept and say how a fuller savings model extends or replaces it.
