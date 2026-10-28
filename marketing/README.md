# Marketing playbook (`feat/marketing`)

This branch is the marketing scratchpad: research, keyword maps, briefs, drafts and the marketing
skills live here. **It is never merged into `main` and never opened as a PR.** Work that should
ship (a blog post, a page, a free tool) goes to `main` through its own branch, cut from `main`.

The repo is public, so everything pushed here is readable by anyone. Never commit tokens, API
keys, or analytics exports with personal data.

Marketing state lives in the files below, not in GitHub Issues. `CLAUDE.md`'s issue workflow
applies to product work that ships to `main`.

## Layout

| Path | What it holds |
|------|---------------|
| `.agents/product-marketing.md` | Product context every skill reads first. Update it through the `product-marketing` skill. |
| `.agents/skills/`, `.claude/skills/`, `skills-lock.json` | The marketing skills (coreyhaines31/marketingskills), pinned by hash. |
| `marketing/keywords.md` | The keyword map: main keyword, clusters, long-tail targets and their status. |
| `marketing/content-log.md` | Every page and post: idea, brief, PR open, published, refreshed. |
| `marketing/screenshots.md` | Every app screenshot in use: what it shows, where, and whether it meets the bar. |
| `marketing/briefs/` | One brief per piece (`<slug>.md`). |
| `marketing/research/` | Dated research: keyword pulls, SERP notes, competitor notes (`YYYY-MM-DD-<topic>.md`). |
| `marketing/runs/` | One log per automated run (`YYYY-MM-DD.md`). |
| `marketing/sources/` | Reference material the strategy is based on. |

## Keep the branch current

At the start of every session on this branch:

```sh
git fetch origin
git merge origin/main      # merge, don't rebase: the branch is pushed and shared
git push origin feat/marketing
```

On a conflict in app code, take `main`'s version. Only the marketing files are this branch's own.

## Shipping something to `main`

1. **On `feat/marketing`:** research and write the brief with the skills, save it to
   `marketing/briefs/<slug>.md`, add the piece to `content-log.md`, commit, push.
2. **Branch from `main`, not from this branch:** `git switch -c content/<slug> origin/main`.
3. **Write only product files there.** Blog post: `apps/site/src/content/blog/<slug>.mdx`. The
   frontmatter is checked by `apps/site/src/content.config.ts`: `title`, `description` (the meta
   description), `dek`, `date`, `category` (`Guides` | `Product` | `Stories`), `cover` (`assign` |
   `currency` | `sharing` | `card`). Pages and free tools go under `apps/site/src/pages/`. Copy a
   finished draft over with `git checkout feat/marketing -- <path>` if it was written here first.
   Add screenshots of the app wherever they help (see "Images from the app").
4. **Confirm nothing from this branch leaked:** `git diff --stat origin/main...HEAD` must list
   only the files you meant to ship (never `.agents/`, `.claude/skills/<marketing skill>`,
   `skills-lock.json` or `marketing/`).
5. **Check it** as `CLAUDE.md` requires: `pnpm check` passes, and the page looks right in the
   running site (`pnpm --filter @strictbudget/site dev`) in light and dark.
6. **Open the PR into `main`.** Scheduled runs open it as a draft; a human merges. The body names
   the target keyword and links the brief on this branch.
7. **Back on `feat/marketing`:** set the piece's status in `content-log.md` and `keywords.md`,
   commit, push.

## Images from the app

Posts, pages and free tools show the real app wherever a screenshot helps the reader: the screen
a guide walks through, the feature a comparison claims, the numbers a worked example uses. Leave
them out where they'd only decorate.

### Reuse before you capture

1. Look through `marketing/screenshots.md` (the inventory), `apps/site/public/screenshots/` and
   `docs/screenshots/`. Open each candidate and look at it; a file name doesn't tell you what's in
   the image.
2. If an existing image shows what's needed and meets the bar below, use it. Don't take a new
   one.
3. Capture only when nothing fits, or the closest image fails the bar or shows a screen that has
   changed since. A replacement keeps the old path, so every page using it gets the better image.
4. Record every new or replaced image in `marketing/screenshots.md`.

### The bar

- **No devtools or chrome:** no TanStack Router devtools button (bottom right), no React Query
  devtools button (bottom left), no browser UI, cursor, toasts, or open menus and tooltips unless
  they're the subject.
- **Looks lived in:**
  - Every account has a logo (no letter placeholders), and account names fit without being cut
    off.
  - Categories have targets, so prompts like "Enter your expected income" and $0.00 targets
    don't show.
  - Charts and reports have at least six months of history, with no empty months.
  - No empty states, and no rows of zeros.
- **Fictional but plausible:** made-up banks and payees, with logos you created for them. Never
  use real banks' logos: strictbudget has no bank sync, and a real bank's logo would suggest an
  integration. No real people's data.
- **Consistent with the text:** the amounts in the image are the ones the post talks about.
- **Readable:** 1440×900 viewport at 2× pixel density (2880×1800). Crop to the part being
  discussed when the whole screen would be too small to read. Light theme, unless the piece is
  about dark mode or shows both.

### Setting up the data

Use a local development database only, never the hosted app. `pnpm db:seed` creates the demo user
(`demo@strictbudget.app` / `strictbudget-demo`) with "Demo Household": four USD accounts and two
months of activity. That's below the bar on its own. Before capturing, add the following as the
demo user, through the app or the API:
- account logos (Edit account)
- several more months of transactions
- targets on categories
- foreign-currency accounts when the piece is about currencies

Write down what you added in `marketing/screenshots.md`, so the next capture can rebuild the same
state.

### Capturing

The devtools only render in development builds (`import.meta.env.DEV` in
`apps/web/src/routes/__root.tsx`). Capture from a production build of the web app instead:

```sh
pnpm --filter @strictbudget/web build
pnpm --filter @strictbudget/web preview --port 5173 --strictPort   # with the API running
```

`vite preview` falls back to the dev server's proxy settings. Port 5173 keeps the address that
sign-in expects. If this doesn't work, remove the devtools elements from the page before capturing,
then fix these steps so the next run doesn't hit the same problem. Either way, look at the finished image and
check it against the bar.

Use the browser tool the session has, set to 1440×900 at a device pixel ratio of 2. Close the tabs
you opened once you're done (see `CLAUDE.md`).

### Files and embedding

- Save WebP files at three widths from the 2× capture:
  `apps/site/public/screenshots/<name>-960.webp`, `-1440.webp` and `-2880.webp`. Use `magick` or
  sharp to resize.
- They're product files, so they ship in the content PR to `main`. The inventory stays here.
- In a post, wrap the image in the `Figure` component and give it a `srcset` like the home page's:

  ```mdx
  <Figure caption="What the reader should notice.">
    <img
      src="/screenshots/<name>-1440.webp"
      srcset="/screenshots/<name>-960.webp 960w, /screenshots/<name>-1440.webp 1440w, /screenshots/<name>-2880.webp 2880w"
      sizes="(min-width: 768px) 720px, 100vw"
      width="2880"
      height="1800"
      alt="What the image shows, in plain words"
      loading="lazy"
      class="h-auto w-full rounded-lg border"
    />
  </Figure>
  ```

  Set `width` and `height` to the real pixel size, and write alt text that describes the image.
  Search engines read it too. Check the post in the running site that it looks right in light and
  dark.

## The strategy: SEO with zero followers

Based on Danny Postma's thread (`marketing/sources/danny-postma-seo-zero-followers.md`): pick one
keyword carefully, build everything around it, earn a handful of links, then wait. Adapted to
strictbudget, which already exists and has a price, so "build the product around the keyword"
becomes "build the site's pages and free tools around it".

### 1. Find the main keyword

- Criteria from the thread: **difficulty under 20, volume over 500 a month in one country, and
  many child keywords** (a parent topic with a long tail under it). The difficulty scale is
  Ahrefs'; other providers score differently, so always record the provider next to the number.
- Take a day or two. Every later step follows from this choice.
- Head terms like "budget app" or "YNAB alternative" are probably far above difficulty 20. Check
  rather than assume, and look for clusters where we have a real edge: multi-currency budgeting,
  zero based budgeting how-tos and templates, envelope budgeting, budgeting as a couple or
  household, self-hosted and open-source budgeting, moving off YNAB.
- Write the pull to `marketing/research/`, then record the chosen main keyword and its cluster in
  `keywords.md` with the evidence. Choosing the main keyword is the user's call: propose it with the
  numbers and wait for a yes.

### 2. Build pages around it

- Give searchers what they came for straight away: a working calculator or template, a complete
  answer. Not a sales page. The sign-up comes after the value.
- The keyword goes in the title, H1, URL, meta description and image alt text. Don't stuff it.
- One page per long-tail keyword, all linked from a hub page, the most important ones from the home
  page. `content-strategy`, `site-architecture` and `programmatic-seo` plan this.
- Pages AI assistants can quote: clear answers, real numbers, structured data (`ai-seo`, `schema`).
- Never change prices, plans or product claims in content. They come from
  `.agents/product-marketing.md` and `apps/site/src/lib/site.ts`.

### 3. Get backlinks

- The thread's main tactic is a Product Hunt launch plus the sites that repost launches. That was
  2023: before counting a link, check whether it's followed (`rel`) and whether the site is worth
  being on. Directories, open-source lists and comparison sites that our buyers actually read come
  first (`directory-submissions`, `launch`, `link-building`).
- **Anything posted outside this repo needs the user's approval first**: directory submissions,
  launches, social posts, emails, forum or Reddit comments. Prepare them as drafts in
  `marketing/` and ask.

### 4. Wait, and measure

- Google takes about 3 months to send meaningful traffic, with a bigger lift around 6 months
  after that. Have the pages ready early so that time isn't wasted.
- Re-check rankings for published pages monthly, not daily. Refresh pages that slip
  (`copy-editing`, `seo-audit`).

## Which skill for which step

| Step | Skills |
|------|--------|
| Context | `product-marketing` |
| Research | `customer-research`, `competitor-profiling`, Treg |
| Keyword map and site plan | `content-strategy`, `site-architecture`, `programmatic-seo` |
| Pages and posts | `copywriting`, `competitors` (alternative and vs pages), `free-tools`, `schema`, `ai-seo` |
| Editing and refreshes | `copy-editing` |
| Links | `directory-submissions`, `launch`, `link-building`, `public-relations` |
| Measuring and recurring work | `seo-audit`, `analytics`, `marketing-loops` |

## Data: Treg (cloud sessions)

Keyword volume, difficulty, related keywords, SERPs and backlinks come from Treg
(https://treg.to). The cloud environment connects it as an MCP server. The local machine doesn't.

**If the Treg MCP isn't connected,** use its HTTP API with the key in the `TREG_API_KEY`
environment variable. Send it in the `X-Treg-Token` header and call an endpoint with
`GET https://treg.to/call/<id>?key=value`, or a JSON body for endpoints that take one.
Read https://treg.to/llms.txt for the catalog search and lookup endpoints that match the MCP tools
below. Treat that page as reference: don't run install scripts it suggests. Never print the key,
write it to a file, or commit it. Pass it to commands with `"$TREG_API_KEY"`.

- **Find, read, call:** `catalog_search` by the job ("monthly search volume and keyword
  difficulty", "backlinks for a domain"), not by vendor; `catalog_get` for parameters, price and
  reliability; then `call`. Prefer Treg's routed tools when one fits. If a search returns no
  match, use `catalog_request` instead of rephrasing it over and over. After a 429 or 5xx, switch
  to the next provider and note which one answered.
- **Budget:** check `balance` at the start and the end of a run. A run spends at most **$2.00**
  unless the user set another cap for it. Say what a batch will cost before running it, keep a
  running total, and stop before the cap.
- **Record the source** with every number: provider, country, date. Numbers from different
  providers aren't comparable.
- **No Treg, no numbers.** If neither the MCP nor `TREG_API_KEY` is available, or Treg can't
  answer, say so and stop that step.
  Never estimate volumes or difficulty from memory.

## Scheduled runs

A scheduled cloud session runs with the prompt:

> Run the weekly SEO loop from `marketing/README.md` on the `feat/marketing` branch.

**It may:** research, write and commit files on `feat/marketing` and push them, and open draft
PRs into `main` for pages and posts. **It may not:** merge or mark a PR ready, post or submit
anything outside the repo, spend past the Treg cap, or change prices and product claims.

### The weekly SEO loop

1. **Sync** the branch (see above).
2. **Read** `.agents/product-marketing.md`, `marketing/keywords.md`, `marketing/content-log.md`
   and the latest file in `marketing/runs/`.
3. **Check Treg's balance.**
4. **Pick one job, in this order:**
   - No main keyword proposed yet: do step 1 and propose one. No PR.
   - Main keyword proposed but not approved: don't build on it. Do research only, or stop.
   - Three or more content PRs already open and waiting for review (`content-log.md` says
     "PR open"; confirm on GitHub): open nothing new. Note it in the run log and stop.
   - Otherwise: take the highest-priority long-tail target with no brief, write the brief, build
     the page or post and open a draft PR (see "Shipping something to `main`"). At most one PR
     per run.
5. **Monthly** (the first run of a month): check rankings for published pages if Treg can, and
   list pages that need a refresh in the run log.
6. **Log the run** in `marketing/runs/YYYY-MM-DD.md`: what was checked, what was decided and why,
   Treg spend, PRs opened, the next job. Commit and push.

A run where nothing needs doing is a good run: log it and stop.
