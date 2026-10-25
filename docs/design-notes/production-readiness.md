# Production readiness

How the production pieces work: the platform, background jobs, email, client IP, register speed
and observability.

## Platform and deployment

- **One image runs strictbudget:** the API also serves the built web app (`WEB_DIST_DIR`), so one
  service and one origin, with no CORS or cross-site cookies. Hashed assets are cached a year; any
  other path that isn't a file gets the app shell. Source maps are built hidden and not served.
- **Deploy step:** `node dist/migrate.mjs` (`pnpm db:migrate` in development) runs the migrations
  and installs the job queue. The server never migrates on start (Railway runs the step before
  deploying, the Compose file before the server); it refuses to start when queues are missing.
- **Railway:** production runs at https://web.strictbudget.app (project `strictbudget`). Its config
  is `.railway/railway.ts` (Infrastructure as Code, typechecked by `pnpm check`), because
  `railway.json` is deprecated and new projects ignore it. Nothing in the image is
  Railway-specific, so the same image runs under Docker Compose or Coolify.
- **Licence:** AGPL-3.0-only.
- **Backups** of the hosted service wait until the app is done ([#76](https://github.com/ikramhasan/strictbudget/issues/76)).

## Background jobs

- pg-boss in its own `pgboss` schema, behind our `Jobs` class, so the queue library can change
  without touching callers. No Redis: Postgres is already required, and jobs can be queued in the
  write's own transaction.
- The API process runs jobs by default; `JOBS_MODE=api` plus `dist/worker.mjs` runs them in a
  process of their own. Schedules (UTC) are in `apps/api/src/lib/jobs/queues.ts`: invitation
  reminders hourly, FX prefetch at 01, 07, 13 and 19.
- Entering due scheduled transactions runs on reads, not as a job.

## Email and client IP

- Emails are queued, not sent in the request: an `email.send` job, in the request's transaction
  when there is one. It's sealed with AES-256-GCM under a key derived from `BETTER_AUTH_SECRET`
  (links carry tokens), retried with backoff up to 8 times, and deleted a minute after it's sent.
  An email that can't be opened (the secret was rotated) is dropped and logged rather than retried.
  Better Auth's sends don't hold up the response, so an endpoint takes the same time whether or
  not it sent one.
- Taken address during an email change: approving or confirming answers 409 `EMAIL_TAKEN`, and the
  page says why. The check verifies the link's signature first, so a made-up token can't ask
  whether an address has an account. A link opened again after the change is done isn't called
  taken.
- Client IP for rate limits: `CLIENT_IP_HEADER` names a header the host's edge sets and overwrites
  on every request; Railway uses `x-real-ip`. Railway publishes no proxy ranges for
  `TRUSTED_PROXIES`, and its two-hop `X-Forwarded-For` left Better Auth with no IP at all. Other
  hosts use `X-Forwarded-For` with `TRUSTED_PROXIES` (Docker Compose behind Caddy: [#106](https://github.com/ikramhasan/strictbudget/issues/106)).

## Sharing

- An invitation reminder goes out 3 days before expiry. Only the token's hash is stored, so the
  reminder carries a new link that replaces the first one (as a resend does), and the expiry
  doesn't move.

## Register speed

- A page is picked by ids and cursor keys only, then its rows are built. Running balances are
  worked out for the shown rows alone: the sum before their earliest date plus a window over the
  dates they span. About 30 ms a page on a 36k-transaction account, against about 1 s before. A
  sort by another column spans every date, so it costs more (about 90 ms there).
- Search matches payee, category and account names once in their own tables, and checks split
  lines only for transactions that are splits. A search that matches nothing still reads every
  memo (about 90 ms at 36k rows). A `pg_trgm` index was tried and not used, because the search ORs
  columns from several tables; a union per column would let an index help if budgets get far
  bigger.
- JIT is off for the app's Postgres connections: it took up to 330 ms compiling these short
  queries.

## Observability

- OpenTelemetry, configured only by the standard `OTEL_*` variables and off unless one is set, so
  self-hosters need none. Production logs are JSON lines on stdout. There are no Postgres query
  spans, because postgres.js has no OTel instrumentation.
- Web app errors go to `POST /v1/client-errors` and into the same logs, with quoted text and
  amounts masked. This was chosen over a vendor browser SDK so any backend works. Checking Sentry
  is [#110](https://github.com/ikramhasan/strictbudget/issues/110).
