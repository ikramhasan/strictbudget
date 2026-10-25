# strictbudget

Zero-based budgeting — every cent gets a job. Envelope budgeting with first-class
multi-currency support.

## Stack

| Layer | Tech |
| --- | --- |
| Monorepo | pnpm workspaces (catalogs) + Turborepo, Biome |
| API (`apps/api`) | Hono + @hono/zod-openapi on Node, Better Auth, Scalar docs |
| Web (`apps/web`) | Vite + React 19, TanStack Router + Query, Tailwind v4, shadcn/ui |
| DB (`packages/db`) | PostgreSQL 17 + Drizzle ORM |
| Engine (`packages/engine`) | Money: exact bigint minor-unit arithmetic, ISO 4217, FX |
| API client (`packages/api-client`) | Generated from OpenAPI (openapi-typescript + openapi-fetch) |
| UI (`packages/ui`) | Shared shadcn/ui components, styled after [ui.ikramhasan.com](https://ui.ikramhasan.com) |

## Getting started

Requirements: Node ≥ 24, pnpm (auto-selected via `packageManager` — root `.npmrc` sets
`manage-package-manager-versions=true`), Docker.

    cp .env.example .env            # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
    pnpm install
    pnpm db:up && pnpm db:migrate
    pnpm db:seed                    # optional demo user: demo@strictbudget.app / strictbudget-demo
    pnpm dev

- Web: http://localhost:5173
- API: http://localhost:3000 — docs at http://localhost:3000/docs, spec at `/openapi.json`

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Postgres + API (watch) + web |
| `pnpm check` | lint + typecheck + test + build — run before every commit |
| `pnpm generate` | Re-emit `openapi.json` and regenerate the typed API client |
| `pnpm db:generate` | Create a SQL migration from schema changes |
| `pnpm db:migrate` / `db:studio` / `db:seed` | Apply migrations / browse data / seed demo user |
| `pnpm format` | Biome format + safe fixes |
| `pnpm --filter @strictbudget/api preview:emails <dir>` | Render every email with sample data as HTML files |

## Adding an API endpoint

1. Add `apps/api/src/routes/<feature>/{routes,handlers,index}.ts` using `createRouter()`.
2. Mount it in `apps/api/src/app.ts` under `/v1`.
3. `pnpm generate` → commit `openapi.json` and `schema.gen.ts`.
4. Use it in the web app via `$api.useQuery("get", "/v1/...")`.

## Roadmap

Goal: complete zero-based budgeting, plus first-class multi-currency, extensive reports and opt-in AI.
Phases are ordered by dependency — build top to bottom. Tick items off as they land.
Items marked **(extra)** go beyond core zero-based budgeting.

### 0. Foundation

- [x] Monorepo, tooling, CI-style `pnpm check`
- [x] `@strictbudget/engine`: bigint minor units, ISO 4217 exponents, parse/format, allocation, rounding, FX primitives
- [x] API skeleton: `createRouter()`, `AppError`, OpenAPI + Scalar docs, generated typed client
- [x] PostgreSQL + Drizzle, UUIDv7 ids, migrations, test DB harness
- [x] Better Auth email/password sign-up, sign-in, sign-out; `/v1/me`
- [x] Web SPA shell: TanStack Router, auth-guarded routes, light/dark theme, shared shadcn UI

### 1. Account & security basics

- [x] Transactional email (Resend; console in development) with per-address throttling
- [x] Email verification
- [x] Forgot / reset password
- [x] Change email and password
- [x] Active sessions list and revoke
- [x] Two-factor auth (TOTP + recovery codes)
- [ ] Sign in with Google and Apple
- [x] Delete account (with full data purge)
- [ ] User preferences: locale, date format, number format, first day of week

### 2. Budgets (plans)

- [x] Create / rename / delete a budget
- [x] Multiple budgets per user, budget switcher, last-used budget remembered
- [x] Budget base currency + currency display settings (symbol position, separators)
- [x] Budget date format and number format settings
- [x] Shared-budget foundation: `budget_member` roles (owner, editor) on the Better Auth
      organization plugin, ready for phase 16

Moved to the phases that unblock them: the default category template (phase 4), and onboarding
and fresh start (after phase 5 core).

### 3. Accounts

- [x] Budget account types: cash, checking, savings
- [x] Credit accounts: credit card, line of credit
- [x] Loan accounts: mortgage, auto loan, student loan, personal loan, medical debt, other debt
      (interest rate, minimum payment and escrow, kept per month; see phase 7f)
- [x] Tracking (off-budget) accounts: asset, liability
- [x] Starting balance transaction on creation
- [x] Per-account currency (any currency but loans since phase 11)
- [x] Balances: cleared, uncleared, working
- [x] Account notes / nickname
- [x] Reorder accounts, sidebar grouped by type with group totals
- [x] Close / reopen accounts (a non-zero balance is zeroed with a Manual Balance
      Adjustment; closed accounts move to a "Closed" section)
- [x] Delete accounts (only with no history beyond the starting balance; otherwise close)

### 4. Categories

- [x] Category groups: create, rename, reorder, hide, delete
- [x] Categories: create, rename, reorder (drag and drop), move between groups, hide/unhide, delete
- [x] Reassign a deleted category's history to another category (transactions now; assigned
      amounts join in phase 6)
- [x] Category notes
- [x] Internal categories: Inflow: Ready to Assign, Uncategorized
- [x] Auto-created credit card payment categories (one per credit account)
- [x] Hidden categories section
- [ ] Category emoji / icons **(extra)**
- [x] Default category template on budget creation (starter groups) — moved from phase 2

### 5. Transactions & register

- [x] Account register: date, payee, category, memo, outflow, inflow, cleared
- [x] All-accounts register view
- [x] Add / edit / delete transactions inline (keyboard-first entry: Tab, Enter saves, Esc
      cancels; the full shortcut set is in phase "Keyboard shortcuts")
- [x] Math in amount fields (`230+30`, `12.50*3`), exact and rounded once
- [x] Payees: create on the fly, autocomplete, remember last category per payee
- [x] Cleared / uncleared / reconciled states, toggle cleared
- [x] Transfers between accounts (linked pair, transfer payees, on-/off-budget rules)
- [x] Split transactions (multiple categories; split transfers)
- [x] Flags (colors) with custom flag names
- [x] Running balance column
- [x] Sort, search and filter (date range, payee, category, memo, amount, flag, cleared)
- [x] Server-side paging of the register (keyset cursors; balances over the whole account)
- [x] Multi-select + bulk edit: selection, select all matching, total, cleared, flag, categorize,
      memo, move to account, delete, duplicate, enter now, make repeating
- [x] Approve / reject imported transactions (unapproved state)
- [x] Future-dated transactions (excluded from balances until the date)
- [ ] Tags on transactions **(extra)**
- [ ] Photos on transactions

#### Budget onboarding (moved from phase 2; needs phases 3–5 core)

- [x] Onboarding flow for a new budget (pick categories, add first account)
- [x] Fresh start (archive the old budget, start a new one with the same categories, accounts and
      partners)

### 6. Budget screen (the core loop)

- [x] Month view: Assigned, Activity, Available per category, group subtotals
- [x] Ready to Assign calculation (inflows − assigned, across months)
- [x] Assign money to categories; math in the amount field (`+`, `-`, `*`, `/`)
- [x] Available rolls over month to month
- [x] Cash overspending (reduces next month's Ready to Assign) — highlighted red
- [x] Move money between categories (and back to Ready to Assign), with Recent Moves
- [x] Cover overspending flow
- [x] Over-assigned warning (Ready to Assign negative)
- [x] Month navigation, budgeting in future months, "assigned in future" indicator
- [x] Income for future months (assign next month's income): there's no separate next-month
      income; money is assigned in future months instead
- [x] Auto-assign / quick budget: underfunded, assigned last month, spent last month, average
      assigned, average spent, reduce overfunding, reset available, reset assigned
- [x] Category inspector: balance breakdown (cash left over, assigned, activity), notes (the
      target part comes with phase 8)
- [x] Category activity drill-down (transactions for category + month)
- [x] Collapse/expand groups, filters (underfunded, overspent, money available, snoozed)
- [x] Undo / redo for budget and transaction edits

### 7. Credit cards & debt

7a–7g are built — what's left is in Plane (cycles from 10 on).

- [x] Spending on a credit card moves funds into its payment category automatically
- [x] Credit overspending (becomes new debt, shown yellow)
- [x] Payment category shows amount available to pay the card
- [x] Existing credit card debt handling (starting negative balance, paying down debt)
- [x] Credit card payment transfers reduce the payment category
- [x] Credit card returns / refunds
- [x] Positive card balances, closing a card (7e)
- [x] Loan accounts (7f): payments split into escrow, interest and principal; monthly interest
      estimated from the previous month's balance (exact, half-up); editable and recorded
      interest and escrow; credits, charges, Update Balance; paired plan category
- [x] Loan planner (7g): Payoff Date, Your Loan's Progress (chart with past balance, original
      schedule, minimum and current track, with progress messages), the Loan Payoff Simulator (monthly
      payment ↔ payoff date, one-time extra, "Copy and go to my plan"), Share Your Progress
      (downloadable picture), the paid-off celebration

### 8. Targets (goals)

Done (8a–8f, and loan debt targets with 7g) — what's left is in Plane (cycles from 10 on).

- [x] Needed for spending — weekly (by day), monthly (by date), yearly, custom
      (every N months/years), by a specific date; refill vs set aside another
- [x] Savings balance (custom "Have a balance of", optionally by a month)
- [x] Monthly savings builder: covered by monthly "Set aside another"
- [x] Credit card payment targets: Pay Specific Amount Monthly, Pay Off Balance by Date (8e)
- [x] Loan Monthly Debt Payment targets on a paired category (7g)
- [x] Target progress bars and status (funded, underfunded, overspent, on track)
- [x] Underfunded total + "Assign underfunded" button (Auto-Assign Underfunded and Reduce
      Overfunding, Underfunded/Overfunded views, the month's targets total; 8c)
- [x] Snooze a target for a month
- [x] Repeat on/off (8b), target history across months (8f: a changed target starts in the month
      it's saved from)
- [x] Targets overview (total needed this month vs next month: Cost to Be Me, 8c; expected income,
      8f)

### 9. Reconciliation

- [x] Reconcile flow: confirm cleared balance or enter bank balance
- [x] Automatic balance adjustment transaction
- [x] Lock reconciled transactions (warn before editing)
- [x] Last reconciled date per account

### 10. Scheduled transactions

- [x] Repeat frequencies: once, daily, weekly, every other week, twice a month, every 4 weeks,
      monthly, every other month, every 3/4 months, twice a year, yearly, every other year
- [x] Upcoming transactions list in register, enter now / skip / edit
- [x] Auto-entry on the due date (when the plan is opened, by the device's date)
- [x] Scheduled splits and transfers
- [ ] Bills calendar view **(extra)**
- [ ] Upcoming bill reminders (email / push) **(extra)**

### 11. Multi-currency **(extra)**

- [x] Accounts in any currency; register shows native amounts
- [x] Budget in the base currency; foreign-account activity converted into category activity
- [x] FX rate source (daily rates provider) + manual rate overrides
- [x] Per-transaction rate lock (store original amount, currency and applied rate)
- [x] Cross-currency transfers (two amounts, implied rate, fee)
- [x] Unrealized FX gain/loss on foreign balances; revaluation adjustments
- [x] Net worth and account totals in base currency and/or any display currency
- [x] Categories/targets with a native currency (e.g. a holiday fund in EUR)
- [ ] Currency-aware reports and CSV export

### 12. Payees & rules

- [x] Payee management: rename, combine/merge, delete, hide
- [x] Payee default category / auto-categorization
- [x] Renaming rules for imported payees (contains / is)
- [ ] Payee location (lat/long) for mobile suggestions
- [ ] Advanced rules engine: match on payee/amount/account/memo → set category, flag, tags, memo **(extra)**

### 13. File import & export

- [x] Import CSV (column mapping, date/amount format detection), OFX, QFX, QIF
- [x] Duplicate detection and match-to-existing (import ID + fuzzy date/amount)
- [x] Imported transactions land as unapproved, with suggested category from payee
- [x] Import from YNAB (API token or exported budget) **(extra)**
- [x] Export budget + registers to CSV
- [x] Full data export (JSON) and re-import / backup

### 14. Bank sync (direct import)

- [ ] Provider abstraction (e.g. Plaid, GoCardless/Nordigen, SimpleFIN)
- [ ] Link account, pick accounts, choose start date
- [ ] Background sync + manual "import now"
- [ ] Matching against manually entered / scheduled transactions
- [ ] Balance mismatch warnings; reconnect flow for expired connections
- [ ] Unlink / relink

### 15. Reports

Core:

- [x] Spending breakdown (by category group / category / payee, donut + table)
- [x] Spending trends (over time, by category/payee)
- [x] Net worth (assets vs debts over time)
- [x] Income vs expense (monthly table)
- [x] Age of Money
- [x] Report filters: date range, accounts, categories, payees; export to CSV
- [x] Budget-screen reflection stats (month summary: assigned, spent, avg, cost to be me)

Extras:

- [ ] Budget vs actual (per category, per month, variance)
- [ ] Cash-flow forecast using scheduled transactions + targets
- [ ] Category history (assigned / activity / available over time)
- [ ] Payee report (top payees, frequency, average spend)
- [ ] Tag report
- [ ] Savings rate and income breakdown
- [ ] Debt payoff progress / projected debt-free date
- [ ] Currency exposure report (balances by currency, FX impact)
- [ ] Year in review
- [ ] Custom saved reports, dashboard of pinned report widgets
- [ ] Export reports to PDF

### 16. Sharing

- [x] Invite members to a budget by email (up to N members)
- [x] Roles: owner, editor, viewer **(extra)**
- [x] Per-member activity attribution ("entered by")
- [x] Leave budget / remove member / transfer ownership
- [x] Real-time updates across clients (WebSocket / SSE) **(extra)**

### 17. UX polish

- [x] Keyboard shortcuts across budget and register (with a cheat-sheet)
- [ ] Command palette **(extra)**
- [x] Responsive layout for phones and tablets
- [ ] Installable PWA with offline entry queue and sync
- [x] Accessibility pass (screen readers, focus order, contrast)
- [x] Display Options: theme, progress bars, Differentiate Without Color; resizable sidebar,
      inspector and register columns
- [ ] Internationalization (UI translations)
- [ ] Hide amounts
- [ ] In-app notifications center (overspending, sync issues, upcoming bills)

### 18. AI assistant (opt-in) **(extra)**

Off by default, per-user toggle, clear data-usage notice, no data sent unless enabled.

- [ ] Opt-in settings + provider/model configuration, usage limits, audit log of AI calls
- [ ] Auto-categorization suggestions for new / imported transactions (learns from history)
- [ ] Payee cleanup (normalize messy bank payee strings)
- [ ] Natural-language transaction entry ("coffee 4.50 yesterday on Visa")
- [ ] Receipt scanning (photo → amount, payee, date, splits)
- [ ] Chat with your budget ("how much did I spend on dining in Q2?") with cited transactions
- [ ] Budget assignment suggestions based on targets and history
- [ ] Anomaly / subscription detection (price hikes, duplicate charges, forgotten subscriptions)
- [ ] Monthly narrative summary of spending and progress
- [ ] Forecasting ("will I hit my vacation target by June?")

### 19. Platform & ops

- [ ] Public REST API with personal access tokens + rate limits
- [ ] Webhooks for transaction / budget changes **(extra)**
- [x] Audit log / change history per budget
- [ ] Automated backups and point-in-time restore
- [x] Observability: structured logs, metrics, error tracking
- [x] Deployment: Docker images, production config, migrations on deploy
- [ ] Native mobile apps (or Capacitor wrapper around the PWA)
- [ ] Billing / subscriptions (if hosted as a service)

## Self-hosting

The Docker image (`Dockerfile`) runs the API and the web app on one origin and migrates the
database on deploy (`node dist/migrate.mjs`). It needs `DATABASE_URL`, `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL` and `WEB_ORIGIN`; everything else in `.env.example` is optional.

- **Email is optional.** With `RESEND_API_KEY` and `FROM_EMAIL`, strictbudget confirms addresses,
  sends password reset links and emails invitations. Without them it sends nothing: accounts are
  usable straight after sign-up, an email change applies at once, and invitations are links you
  share yourself (owners can also share links on a server that sends email).
- `STRICTBUDGET_DEPLOYMENT` stays unset (`self-hosted`). `cloud` is the hosted strictbudget, which
  requires email.

## License

strictbudget is free software under the [GNU Affero General Public License v3.0 only](LICENSE)
(`AGPL-3.0-only`). You can use, change and self-host it; if you run a changed version as a service
for others, you have to offer them its source under the same licence.
