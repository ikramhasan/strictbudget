---
name: run-cycle
description: Runs one strictbudget milestone (cycle) end to end — start it, order its issues, settle open questions, build and test each issue, record everything on GitHub, review, and close the milestone. Use when the user says "/run-cycle N", "start/do/finish cycle N", or asks to work through a milestone's issues.
---

# Run a cycle

Argument: the cycle number (e.g. `16`). The rules live in `docs/issues.md` and `CLAUDE.md`; this skill is the order to apply them in. Read both first if they aren't in context.

## 1. Start

- [ ] Find the milestone: `gh api repos/ikramhasan/strictbudget/milestones --jq '.[] | "\(.number) \(.title)"'`, match the title `Cycle N · …`.
- [ ] If its due date is a placeholder, move it (`gh api -X PATCH repos/ikramhasan/strictbudget/milestones/<number> -f due_on=…`).
- [ ] `gh issue list -R ikramhasan/strictbudget --milestone "<title>" --state open`; read each issue's body and comments (`gh issue view N --comments`), its blockers and sub-issues. Read the design notes for the area in `docs/design-notes/`.
- [ ] Branch from up-to-date `main`: `cycle-N-<short-name>` (or a worktree if the user asks). Never work on `main`.
- [ ] Make sure Postgres is up (`docker compose up -d`; OrbStack may need `open -a OrbStack`) before any test run.

## 2. Plan (use plan mode)

Enter plan mode and present, without editing code:

- The issue order: verify/gate issues before the builds they unblock; shared-file issues (engine budget math, `months` handlers) in sequence; independent ones flagged as parallelisable.
- Per issue: what to build and what tests.
- **Questions only the user can answer** (product decisions). Ask them now, together, not mid-cycle.

After approval, suggest the user set a goal so the session can't end early, e.g.
`/goal Complete Cycle N: every issue in the milestone closed per docs/issues.md and pnpm check passes`.

## 3. Work each issue

For each issue, in order:

1. Set its project Status to **In Progress** (`docs/issues.md`, "Reference").
2. Build the vertical slice: engine → PostgreSQL integration test → API schema/route (`pnpm generate` if routes change) → web → browser check in light and dark. Money stays bigint.
3. Gaps you can't settle or that fall outside the issue → a new issue right away, added to the project and mentioned in a comment. Deliberate simplifications → a line in the matching `docs/design-notes/` file.
4. Commit (conventional message with `#N`), then comment on the issue: commit(s), branch, tests added, browser checks, anything left. Close it.

Parallel option: issues that don't share files can go to subagents with `isolation: "worktree"` (one issue each, with this skill's step 3 as their brief), or a Workflow if the user opted in ("use a workflow" / ultracode). Merge their branches back into the cycle branch and re-run checks.

## 4. Finish

- [ ] `pnpm check` passes on the cycle branch (report failures with output; don't claim done otherwise).
- [ ] Run `/code-review` on the cycle diff (offer `--fix`), then `/simplify` if useful; re-run `pnpm check` after fixes.
- [ ] Every issue closed, or moved to another milestone with the user's agreement. Then close the milestone (`gh api -X PATCH repos/ikramhasan/strictbudget/milestones/<number> -f state=closed`) and update `docs/roadmap.md`.
- [ ] Tell the user: what was built per issue, new issues opened, what carried over, and that the branch is ready to merge (merge/push only when they ask).
