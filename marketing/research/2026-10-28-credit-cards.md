# Credit cards in a budget: keywords, SERP, YNAB (2026-10-28)

Research for the rewrite of `/blog/credit-cards`. Treg CLI (`tools-registry==0.27.0`), Google US.
Treg spend this pull: about $0.03 (balance $0.909 before).

## Keyword volume and difficulty

Provider: Serpstat (`serpstat.google.keywords.volume` and `serpstat.google.keywords.ideas`),
database `g_us`, pulled 2026-10-28. Difficulty is Serpstat's 0–100 scale, not Ahrefs'.

| Keyword | Volume (US) | Difficulty (Serpstat) | Intent |
|---------|-------------|-----------------------|--------|
| ynab credit card | 390 | 9 | informational |
| ynab credit cards | 320 | 9 | informational |
| budgeting with credit cards | 320 | 8 | informational |
| budgeting with a credit card | 320 | 8 | |
| budgeting credit cards | 320 | 9 | |
| credit card budget | 320 | 9 | informational |
| credit card budgeting | 320 | 14 | |
| budget on credit card | 320 | 11 | |
| credit cards budget | 260 | 10 | |
| budget with credit card | 260 | 8 | |
| ynab credit card payment | 260 | 5 | transactional |
| you need a budget credit card payment | 260 | 10 | |
| how to monitor credit card spending | 170 | 3 | |
| budget pay off debt | 140 | 15 | |
| credit card payment tracker | 140 | 17 | |
| credit card budgeting app | 50 | 46 | informational |
| ynab credit card float | 40 | 1 | informational |
| pay credit card in full every month | 30 | 25 | transactional |
| how to budget with a credit card | 20 | 6 | informational |
| ynab credit card debt | 20 | 5 | informational |
| ynab credit card overspending | 10 | 2 | informational |
| credit card payment category | ≈0 | 2 | |
| envelope budgeting credit cards | ≈0 | 2 | |

"credit card budget" has 832 related keywords and "ynab credit card(s)" 982 (Serpstat
`keywords_count`), so the topic has a long tail. The "budgeting with credit cards" variants look
like one search intent split across phrasings (Serpstat reports each at 320).

## SERP, top 10 (Google US, `crawl4ai.google.serp.organic` via `treg.google.serp.organic`)

**budgeting with credit cards:** Reddit (r/UKPersonalFinance), thedollarstretcher.com, four
YouTube videos (The Budget Mom ×3, Quicken), another YouTube video, creditunion1.org,
bogleheads.org forum, hfcu.org. No full app-specific guide with worked numbers.

**credit card budget:** Reddit ×2, chase.com education article, money.stackexchange ×2, kemba.org,
actualbudget.org docs (Credit Cards and Actual Budget), esusurent.com, moneywithkatie.com,
discover.com.

**ynab credit card:** Reddit r/ynab ×2, four YouTube videos, ask.metafilter, money.stackexchange,
support.ynab.com (starting balance), econumo.com. People keep asking for an "ELI5" of how the
payment category works, which says the existing answers don't land.

Takeaway: weak, forum-heavy results with low difficulty. A complete guide with one real month of
numbers and screenshots can compete.

## YNAB's version

- **"How to Do Credit Cards in YNAB"** (ynab.com/how-to-do-credit-cards-in-ynab, Rachel Wong,
  2021-11-11): about 650 words plus an embedded video. Sections: what happens when you buy
  something (a gum example, no amounts), paying in full (the green/yellow alert screenshots,
  Debt Payoff target mentioned), interest (make an Interest category; no rates or math), a
  closing pitch and links to classes. Only number: a −$2,400 balance with $300 a month.
  Not covered: returns, credit overspending vs cash overspending, statement vs current balance,
  rewards and statement credits, multiple cards, payoff timelines or what a bigger payment saves.
- **Support:** "Paid in Full Credit Cards: A Guide" and "Credit Cards – Handling a Starting
  Balance" (support.ynab.com), help-center articles per sub-topic, no one worked month.
