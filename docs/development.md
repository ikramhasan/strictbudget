# Developing strictbudget

How to run strictbudget from source and work on it. To run it for yourself, see
[Self-hosting](../README.md#self-hosting) in the README. Agents: also read `CLAUDE.md`.

## Stack

| Layer | Tech |
| --- | --- |
| Monorepo | pnpm workspaces (catalogs) + Turborepo, Biome |
| API (`apps/api`) | Hono + @hono/zod-openapi on Node, Better Auth, Scalar docs |
| Web (`apps/web`) | Vite + React 19, TanStack Router + Query, Tailwind v4, shadcn/ui |
| Site (`apps/site`) | The marketing site and blog for the hosted service: Astro (static), MDX posts in `src/content/blog`, the UI package's tokens and components, Geist |
| DB (`packages/db`) | PostgreSQL 17 + Drizzle ORM |
| Engine (`packages/engine`) | Money: exact bigint minor-unit arithmetic, ISO 4217, FX |
| API client (`packages/api-client`) | Generated from OpenAPI (openapi-typescript + openapi-fetch) |
| UI (`packages/ui`) | Shared shadcn/ui components, styled after [ui.ikramhasan.com](https://ui.ikramhasan.com) |

## Getting started

Requirements: Node ≥ 24, pnpm (auto-selected via `packageManager`; root `.npmrc` sets
`manage-package-manager-versions=true`), Docker.

    cp .env.example .env            # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
    pnpm install
    pnpm db:up && pnpm db:migrate
    pnpm db:seed                    # optional demo user: demo@strictbudget.app / strictbudget-demo
    pnpm dev

- Web: http://localhost:5173
- Site: http://localhost:4321 (the marketing site; not part of the Docker image)
- API: http://localhost:3000. Docs are at http://localhost:3000/docs and the spec at `/openapi.json`.

Every setting is described in `.env.example`.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Postgres + API (watch) + web |
| `pnpm check` | lint + typecheck + test + build. Run it before every commit |
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

## Planning

Open work, the roadmap and deliberate differences from YNAB are tracked in Plane, not in this
repository: see [`plane.md`](plane.md).

## Brand assets

The logo (`logo-*.svg`, PNG exports) and the 1280×640 social banner are in [`brand/`](brand/).
The web app's `favicon.svg` is `brand/logo-mark.svg`. The wordmark is outlined Inter, so it renders
without the font installed.
