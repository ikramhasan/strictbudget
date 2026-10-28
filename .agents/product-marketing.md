# Product Marketing Context

*Document version: v1*
*Last updated: 2026-10-29*

Drafted from the README, the marketing site (`apps/site`) and the app itself. Facts about the
product are checked against those; anything marked **Unknown** has no source yet and must not be
invented in copy. Fill those in as the founder answers them or as research turns them up.

## Product Overview

- **One-liner:** strictbudget is an open-source zero based budgeting app you can share, run in any
  currency, and host yourself.
- **What it does:** You give every cent a job. Income lands in Ready to Assign, you assign it to
  categories (envelopes), and you spend from what each category has available. Accounts can each
  be in their own currency; activity converts into the budget's currency at locked-in daily rates.
- **Category (the shelf people search on):** budgeting app / zero based budgeting app / envelope
  budgeting app / YNAB alternative. Secondary shelves: self-hosted budgeting app, open-source
  personal finance, multi-currency budget.
- **Product type:** Consumer web app (responsive, no native apps yet), offered hosted (SaaS) and
  self-hosted (one Docker image + PostgreSQL).
- **Business model:** Hosted is $8/month or $60/year, every feature included, cancel anytime and
  keep every transaction. Self-hosted is free and the same app (AGPL-3.0).
- **Links:** site https://strictbudget.app, app https://web.strictbudget.app, source
  https://github.com/ikramhasan/strictbudget.

## Target Audience

- **Who:** Individuals and households who budget on purpose: people who already use or have used
  YNAB, people moving off spreadsheets, couples and families who share money, and people whose
  money lives in more than one currency (expats, immigrants, remote workers paid abroad,
  digital nomads). A technical subset wants to self-host or script their budget (API, MCP).
- **Primary use case:** Plan every dollar before spending it, together, without losing control of
  the data.
- **Jobs to be done:**
  1. Know what I can actually spend this month, and see bills coming before they land.
  2. Run one budget with my partner/household without arguing over a spreadsheet.
  3. Budget across currencies without doing conversions by hand.
  4. Keep my financial history mine: export it, back it up, run it on my own server.
- **Scenarios:** switching from YNAB after a price rise; a couple merging finances; an expat
  paid in EUR with bills in USD; a self-hoster replacing a SaaS subscription; a developer wiring
  their budget to an AI agent through MCP.

## Personas

Not applicable (consumer product, the user is the buyer). In a household, one person usually
chooses the app and invites the others as editors or viewers.

## Problems & Pain Points

- **Core problem:** Money gets spent before it has a plan, so the month ends with surprises.
- **Why current options fall short:**
  - YNAB: closed, cloud-only, subscription-only, one currency per plan.
  - Spreadsheets: manual, error-prone, painful to share and keep current.
  - Tracking apps (Monarch, Copilot, Rocket Money, etc.): show where money went, not where it
    should go.
  - Other open-source tools: Unknown how users rate them against us; research before claiming.
- **Cost:** missed bills, credit card debt that crept up, arguments about money, hours of
  spreadsheet upkeep, conversion math for every foreign transaction.
- **Emotional tension:** anxiety about not knowing what's safe to spend; friction between
  partners; distrust of handing financial data to another company.

## Competitive Landscape

- **Direct:** YNAB (the method we share; closest substitute). Actual Budget (open-source,
  self-hostable envelope budgeting). Goodbudget (envelope budgeting). Verify each competitor's
  current pricing and features before comparing; never compare from memory.
- **Secondary:** Monarch Money, Copilot, Rocket Money, EveryDollar, Quicken Simplifi: budgeting
  or tracking apps with a different method.
- **Indirect:** spreadsheets and budget templates; the envelope cash method; doing nothing.

## Differentiation

- Open source (AGPL-3.0) and self-hostable for free; the hosted version is the same app.
- Real multi-currency: each account in its own currency, ~150 currencies, daily rates with
  per-budget overrides, locked-in rates, revaluation of foreign balances, foreign-currency targets.
- Sharing with roles: up to 5 more people as editors or read-only viewers, live updates, and a
  change history that shows who did what.
- Your data: full JSON backup and restore, CSV export, YNAB import (token or Export Plan files).
- Automation: REST API with scoped personal API keys, and an MCP server for AI agents.
- YNAB's method, so habits carry over: Ready to Assign, rollover, credit card payment categories,
  targets, Age of Money.

## Objections

| Objection | Response |
|-----------|----------|
| "No bank sync." | True today. Import CSV, OFX, QFX or QIF with duplicate matching. Don't promise a date. |
| "No mobile app." | True today. It's a responsive web app that works in a phone's browser. |
| "Why not just stay on YNAB?" | Lead with what YNAB can't do: currencies per account, self-hosting, roles, full backups. |
| "Is a new app going to last?" | Open source: the code and your data stay usable even if the hosted service changed. |

**Anti-personas:** people who want automatic bank sync above all else; people who only want to
track past spending, not plan it; businesses (it's built for personal and household budgets).

## Switching Dynamics

- **Push:** YNAB's subscription cost; one-currency limits; spreadsheet fatigue; not owning the data.
- **Pull:** same method, more control; multi-currency; free self-hosting; roles and history.
- **Habit:** years of history in YNAB or a spreadsheet; muscle memory; mobile app on the phone.
- **Anxiety:** losing history (answer: YNAB import, backups); losing bank sync; learning a new app.

## Customer Language

**Unknown.** No verbatim customer quotes collected yet. Mine Reddit (r/ynab, r/personalfinance,
r/selfhosted, r/expats), YNAB alternative threads and app reviews with `customer-research`, and
record exact phrases here with the source.

**Glossary (product terms, as the app uses them):** Ready to Assign, Assigned, Activity,
Available, category, category group, target, Underfunded, Auto-Assign, move money, rollover,
overspending, credit card payment category, tracking account, reconcile, revalue, Age of Money.

**Words to avoid:** "platform", "solution", "leverage", "seamless", "empower" (not how the site
talks). The site writes "zero based" without a hyphen and "self hosted" without a hyphen in prose;
keep that.

## Brand Voice

Taken from the existing site and blog copy.

- **Plain and concrete:** real numbers and real situations. "Say Groceries has $612.40 and you
  pay $86.17 at the supermarket with your Visa." Not abstract benefit talk.
- **Calm and honest:** says what's missing ("Not yet.") instead of spinning it.
- **Warm, not cute:** "Every cent that comes in waits for its job." No exclamation marks, no hype.
- **Tone by context:** guides teach step by step with a worked example; product posts explain
  why a rule exists; comparisons are factual and fair to the competitor.

## Proof Points

**Unknown.** No public user counts, revenue, reviews or testimonials verified yet. Don't invent
numbers or quotes. Verifiable proof today: open-source code, the feature list, the README's
YNAB comparison table.

## Goals

- **Primary goal:** grow hosted sign-ups through organic search and AI answers, with a $0 paid
  budget (see `marketing/README.md`).
- **Key conversion:** sign up at https://web.strictbudget.app/sign-up. Secondary: star the repo or
  self-host.
- **Current metrics:** Unknown (no Search Console or analytics data recorded here yet).

## Learnings

| Learning | Evidence | Applies to | Status |
|----------|----------|------------|--------|

## Changelog

- v1 (2026-10-29) — Initial context, drafted from the README, the marketing site and the app.
