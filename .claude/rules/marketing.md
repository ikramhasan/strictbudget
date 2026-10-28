# Marketing branch (`feat/marketing`)

This file only exists on `feat/marketing`, the marketing scratchpad. If you can read it, you're on
that branch.

- **Read `marketing/README.md` before any marketing work.** It's the playbook: the SEO strategy,
  which skill to use for each step, how to use the Treg MCP for keyword and SERP data, the spending
  cap, and the weekly SEO loop that scheduled runs follow.
- **Product context:** `.agents/product-marketing.md`. The marketing skills read it first.
- **This branch is never merged into `main` and never opened as a PR.** To ship a blog post, page
  or free tool, merge `origin/main` into this branch and push, do the research here, then cut a
  new branch from `origin/main` that holds only the product files. The README has the steps.
- **Plane is no longer used.** Ignore the Plane instructions in `CLAUDE.md` and `docs/plane.md`.
  Marketing state lives in `marketing/`.
- Everything else in `CLAUDE.md` still applies to anything that ships to `main`. That includes
  `pnpm check` before a PR and checking UI in the running app.
