# Roadmap

Core budgeting, sharing, registers, payees, import and export, the first reports, keyboard and
mobile, production readiness, collaboration and multi-currency are built. What's left, in order,
is one [milestone](https://github.com/ikramhasan/strictbudget/milestones) each; the issues and
their status are on the [project board](https://github.com/users/ikramhasan/projects/1).

1. [Cycle 14c · Savings](https://github.com/ikramhasan/strictbudget/milestone/8): savings
   categories (spending or savings), savings goals (save up, safety fund, keep saving), warnings
   when money leaves savings, saving shown apart from spending in reports, and a one-time
   suggestion for existing budgets. See [savings](design-notes/savings.md).
2. [Cycle 14b · Reports II](https://github.com/ikramhasan/strictbudget/milestone/1): strictbudget's
   own reports on top of the reports foundation: cash flow (Sankey), budget vs actual, category
   history, payees and recurring charges, savings rate and income sources, debt payoff and
   interest, cash-flow forecast, spending by flag.
3. [Cycle 16 · Bank sync](https://github.com/ikramhasan/strictbudget/milestone/2): provider
   abstraction, linking accounts, background import, pending transactions, reconnect and unlink.
4. [Cycle 17b · Self-hosting and one-click deploys](https://github.com/ikramhasan/strictbudget/milestone/3):
   published images, Docker Compose on a VPS, the Railway template and the self-hosting guide.
5. [Cycle 20 · Extras: tags, attachments, bills, reviews and saved reports](https://github.com/ikramhasan/strictbudget/milestone/4)
6. [Cycle 21 · Extras: app experience](https://github.com/ikramhasan/strictbudget/milestone/5):
   installable PWA, translations, Hide Amounts, notifications, Google and Apple sign-in, payee
   locations, the library watch list.
7. [Cycle 22 · AI assistant](https://github.com/ikramhasan/strictbudget/milestone/6): opt-in
   foundation, categorization and payee cleanup, natural-language entry and receipts, chat with
   your budget, suggestions and detection, narrative and forecasting.
8. [Cycle 23 · Platform: public API, webhooks, mobile, billing](https://github.com/ikramhasan/strictbudget/milestone/7)

Issues with no milestone are follow-ups to pick into a milestone when one starts. Milestone due
dates are weekly placeholders; move them when a milestone starts.

## Ground rules

- **Check, don't assume.** Settle each issue's open questions through the API and the web app
  before building. What can't be settled becomes an issue, never a guess in code.
- **Money stays exact.** `bigint` minor units with a currency; no step creates or destroys money
  in the plan.
- **Build one vertical slice at a time.** Engine rule → PostgreSQL integration test → API schema
  → generated client → UI → browser check in both themes. Run `pnpm check` before closing an
  issue.
