# strictbudget — agent guide

Read `README.md` and `docs/development.md` (stack, commands) first, then `docs/issues.md` (how
work is tracked in GitHub Issues and the strictbudget project: no deferring what you can settle,
test what you build, an issue for anything you can't, keep milestones and issues current). Open
work is issues; deliberate decisions and simplifications are in `docs/design-notes/`, and the
order of upcoming work is `docs/roadmap.md`. Read the design notes for the area you're working on
before starting.

## Checking UI changes

Check your UI changes in the running app with the browser tool your harness connects (Claude
Code: claude-in-chrome; elsewhere, the Chrome MCP server configured there). As soon as a check is
finished, close every tab and window you opened for it (including ones a tool opened for you).
Leave the user's own tabs alone, and keep one open only if the user asked to see it.

## Invariants (never break)

- **Money is never a float.** Use `@strictbudget/engine`: `bigint` minor units + `CurrencyCode`.
  DB: `bigint` column (mode "bigint") + adjacent `currency char(3)`. JSON: integer string
  (`zMoney`/`zMinorUnits`). Never `Number(amount)`, never `parseFloat`.
- Currency exponents in `packages/engine/src/currency.ts` must never change for an existing code.
- Every API router comes from `createRouter()` (shared validation error shape). Errors are thrown
  as `AppError(status, CODE, message)` and rendered as `{ error: { code, message, details? } }`.
- Every route has an `operationId`, a response schema and documented error responses (`jsonError`).
- Authed routes use `middleware: [requireAuth] as const` and `security: authSecurity` (a session
  cookie or a personal API key). Account, security, sharing and budget create/delete/import routes
  use `requireSession` + `sessionSecurity` instead, so an API key can't reach them
  (`apps/api/src/lib/api-keys.ts`). A key's scope is enforced in `requireAuth` and
  `loadBudgetAccess`; check `c.var.apiKey` before adding side effects a script shouldn't trigger.
- Handlers read dependencies from `c.var.deps` — never import a global db/auth.
- Budget-scoped routes live under `/v1/budgets/{budgetId}/…` and authorize through
  `loadBudgetAccess(c, budgetId, permission?)` (`apps/api/src/lib/budget-access.ts`): non-members
  get 404, members lacking the permission get 403. Never query budget data without it.
- Budgets are Better Auth organization-plugin records (`budget`, `budget_member`,
  `budget_invitation`). Clients use `/v1/budgets`; the plugin's `/api/auth/organization/*`
  endpoints are blocked in `app.ts`. Roles live in `apps/api/src/lib/budget-access-control.ts`.
- Better Auth owns the `account` table (logins). The finance accounts table needs another name
  (e.g. `budget_account`).
- After changing API routes: `pnpm generate` and commit `apps/api/openapi.json` +
  `packages/api-client/src/schema.gen.ts` (a test fails if they drift).
- Schema changes: edit `packages/db/src/schema/*`, then `pnpm db:generate`; commit migrations.
  Never edit an applied migration. Primary keys are `newId()` (UUIDv7) text ids.
- New third-party deps go through the `catalog:` in `pnpm-workspace.yaml`.
- **Prefer well-maintained libraries over hand-rolled code.** Before building a general-purpose
  capability (drag and drop, date pickers, virtualization, parsing, charts, …), look for an
  actively maintained, widely used library and use it instead of writing our own; we don't want to
  own and maintain edge cases someone else already solved. Check maintenance (recent releases,
  open-issue health), bundle size and license first. Hand-roll only domain logic (budgeting rules,
  money math) or when no suitable library exists, and say why in a comment.
- API tests use `createTestApp()` + `resetDatabase()` against the real test DB. No DB mocks.
  Test files run in parallel: the global setup migrates `TEST_DATABASE_URL` and gives each worker
  a database of its own (`<name>_w1`, `_w2`, …), copied once, then migrated in place on later runs
  (dropping one forces a slow checkpoint). `API_TEST_WORKERS` sets the count (default
  cores − 1; turbo passes it through). Files share a worker's modules (`isolate: false`), so
  module-level state must be keyed by something a test app owns (its db, its fx provider), never
  global. In tests, passwords hash with a cheap scrypt (`createTestApp`); production keeps
  Better Auth's. Web test files that `vi.mock`/`vi.hoisted` run isolated; the rest share modules
  (`apps/web/vitest.config.ts` sorts them).
  CI (`.github/workflows/check.yml`) runs `pnpm check` and the image check on each
  push to main, not on PRs; Railway deploys only once it passes. Run `pnpm check` locally before a PR.
- shadcn components: `pnpm dlx shadcn@latest add <name> -c apps/web` (lands in `packages/ui`).
  The design follows ui.ikramhasan.com (a shadcn-compatible library: tokens and Inter in
  `globals.css`, component styling in `packages/ui`). That library is built on Base UI and ours
  on Radix, so a new component is the stock Radix one restyled to match the library's version
  (`https://ui.ikramhasan.com/r/<name>.json`), its Base UI state selectors translated to Radix's
  (`data-open:` → `data-[state=open]:` and so on).
- Web imports: app code via `@/…`, shared UI via `@strictbudget/ui/components/<name>`.

- **Self-hosted vs cloud.** `STRICTBUDGET_DEPLOYMENT` (`self-hosted` default, `cloud` = the hosted
  service; `isCloud(env)`). Self-hosted must work without what only the hosted service needs:
  email is optional there (`deps.email` is null without Resend), so anything that sends email
  needs a path without it. The web app reads `GET /v1/instance` (`useInstance()`). Hosted-only
  code goes in a `cloud/` folder (`apps/api/src/cloud/`, `apps/web/src/cloud/`).

## Gotchas / conventions

- **pnpm & supply-chain policy.** pnpm 12.6.0 is pinned via `packageManager`; root `.npmrc` sets
  `manage-package-manager-versions=true` so any pnpm ≥ 9.7 auto-switches to it. pnpm 12 enforces a
  24h `minimumReleaseAge` policy — a brand-new release can't be installed until it's a day old. If
  a catalog bump fails because of this, lower the pinned version rather than adding a
  `minimumReleaseAgeExclude` entry. `allowBuilds: { esbuild: true }` in `pnpm-workspace.yaml`
  approves esbuild's postinstall; some `@tanstack/react-router*` packages are exact-pinned (no
  `^`) in the catalog for the same freshness reason — see the comment above the catalog block.
- **TypeScript is pinned `~5.9.3`** because `openapi-typescript` requires TS 5.
- **Theme.** There is no `next-themes`. The provider is `ThemeProvider`/`useTheme` from
  `@strictbudget/ui/lib/theme`, plus a static pre-paint script in `apps/web/index.html` (kept in
  sync with `theme.tsx` by hand) that avoids a flash of the wrong theme. Persisted under the
  `localStorage` key `"theme"`.
- **Auth session (web).** After any auth transition (sign-in/up/out), call
  `refreshSession(queryClient)` from `apps/web/src/lib/session.ts` — not `invalidateQueries`,
  because `ensureQueryData` (used by route `beforeLoad`s) returns stale-but-cached data, so a
  signed-out `null` could still win a race right after sign-in. Sign-out also calls
  `queryClient.clear()`.
- **shadcn CLI quirks.** `pnpm dlx shadcn@latest add <name> -c apps/web` (currently 4.21) may
  write hooks into `apps/web/src/hooks` — move them to `packages/ui/src/hooks`. It may also
  import `cn` from an npm package literally named `cn` — rewrite that import to
  `@strictbudget/ui/lib/utils` and do not add a `cn` dependency. Components under `packages/ui` are
  owned/vendored code and are lint-exempt (Biome still formats them). The CLI prompts before
  overwriting an existing component and `-y` doesn't answer that; `-o` overwrites everything
  (including our local edits), so after `-o` restore existing files with `git checkout`. Local
  edits to vendored files are marked with a `strictbudget:` comment (e.g. `table.tsx` container
  ref, `autocomplete.tsx`).
- **Boolean `data-*` attributes.** Tailwind's `data-active:` (and similar) variants match the
  attribute's presence, so `data-active={false}` still styles as active. Render
  `data-x={flag || undefined}`; check newly vendored shadcn components for this.
- **Test typing.** `res.json()` from the Hono test client / `fetch` is typed `Promise<unknown>`;
  narrow with an explicit `as { ... }` cast at the call site rather than loosening the type.
- **Bundling workspace packages.** `apps/api`'s `tsdown.config.ts` uses `deps.alwaysBundle:
  [/^@strictbudget\//]` (tsdown 0.23 renamed `noExternal` to `deps.alwaysBundle`) since workspace
  packages ship TS source and must be bundled into the built server.
- **Auth emails and links.** Emails come from `c.var.deps.email` (`apps/api/src/lib/email`);
  their links go to the web app with the token in the URL fragment (`#token=`), and pages act
  only on a click, so a mail scanner opening a link changes nothing. Never put Better Auth's own
  `/api/auth/...` link URLs in an email. Accounts need a confirmed email to sign in; the test
  helper `signUp` confirms through the emailed link and signs in, and `emailsTo(app, to, kind)`
  reads the in-memory outbox. Change-email and the session list/revoke go through `/v1/me/*`
  (password check, no tokens to the browser); the matching Better Auth endpoints are blocked
  in `app.ts`.
- **Demo seed user.** `pnpm db:seed` creates `demo@strictbudget.app` / `strictbudget-demo` (see
  `apps/api/src/scripts/seed.ts`) — a public dev-only constant, safe to show in docs.

## Before claiming done

`pnpm check` must pass.
