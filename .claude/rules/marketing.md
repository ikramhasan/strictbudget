# Marketing branch (`feat/marketing`)

This file only exists on `feat/marketing`, the marketing scratchpad. If you can read it, you're on
that branch.

- **Read `marketing/README.md` before any marketing work.** It's the playbook: the SEO strategy,
  which skill to use for each step, how to use Treg for keyword and SERP data (the MCP, or its
  CLI with `TREG_API_KEY` when the MCP isn't connected), the spending cap, and the weekly
  SEO loop that scheduled runs follow.
- **Product context:** `.agents/product-marketing.md`. The marketing skills read it first.
- **Content shows the real app.** When writing a post, page or tool, add screenshots of the
  app where they help. Reuse an image from `marketing/screenshots.md` when one fits and meets the
  bar; only capture when none does. No devtools, logos on every account, lived-in data, no empty
  states. The README's "Images from the app" has the full bar and the steps.
- **Beat YNAB's version.** Before writing a post or page, check whether YNAB has content on the
  topic. If it does, ours must be clearly ten times better (worked numbers, the real app, a usable
  tool, completeness), and the brief says how. The README's "Beat YNAB's version" has the details.
- **This branch is never merged into `main` and never opened as a PR.** To ship a blog post, page
  or free tool, merge `origin/main` into this branch and push, do the research here, then cut a
  new branch from `origin/main` that holds only the product files. The README has the steps.
- **Marketing state lives in `marketing/`**, not in GitHub Issues. `docs/issues.md` covers
  product work that ships to `main`.
- Everything else in `CLAUDE.md` still applies to anything that ships to `main`. That includes
  `pnpm check` before a PR and checking UI in the running app.
