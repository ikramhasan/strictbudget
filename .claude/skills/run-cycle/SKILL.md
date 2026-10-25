---
name: run-cycle
description: Runs one strictbudget Plane cycle end to end — start it, order its tickets, settle open questions, build and test each ticket, record everything in Plane, review, and complete the cycle. Use when the user says "/run-cycle N", "start/do/finish cycle N", or asks to work through a Plane cycle's tickets.
---

# Run a Plane cycle

Argument: the cycle number (e.g. `10`). The rules live in `docs/plane.md` and `CLAUDE.md`; this skill is the order to apply them in. Read both first if they aren't in context.

## 1. Start

- [ ] Find the cycle: Plane `cycle list` (project `69479a76-b0fc-4151-a446-8d3d13980081`), match the name `Cycle N · …`.
- [ ] If its start date is in the future, `cycle update` `start_date` to today (UTC) so it's the active cycle.
- [ ] `cycle list_workitems`; retrieve each ticket's description and comments. Read "Design notes and known differences" for the area.
- [ ] Branch from up-to-date `main`: `cycle-N-<short-name>` (or a worktree if the user asks). Never work on `main`.
- [ ] Make sure Postgres is up (`docker compose up -d`; OrbStack may need `open -a OrbStack`) before any test run.

## 2. Plan (use plan mode)

Enter plan mode and present, without editing code:

- The ticket order: verify/gate tickets before the builds they unblock; shared-file tickets (engine budget math, `months` handlers) in sequence; independent ones flagged as parallelisable.
- Per ticket: what to build and what tests.
- **Questions only the user can answer** (product decisions). Ask them now, together, not mid-cycle.

After approval, suggest the user set a goal so the session can't end early, e.g.
`/goal Complete Plane Cycle N: every ticket Done per docs/plane.md and pnpm check passes`.

## 3. Work each ticket

For each ticket, in order:

1. Set it **In Progress** in Plane.
2. Build the vertical slice: engine → PostgreSQL integration test → API schema/route (`pnpm generate` if routes change) → web → browser check in light and dark. Money stays bigint.
3. Gaps you can't settle or that fall outside the ticket → a new ticket right away, linked in a comment. Deliberate simplifications → a line on "Design notes and known differences".
4. Commit (conventional message with the ticket id), then comment on the ticket: commit(s), branch, tests added, browser checks, anything left. Set **Done**.

Parallel option: tickets that don't share files can go to subagents with `isolation: "worktree"` (one ticket each, with this skill's step 3 as their brief), or a Workflow if the user opted in ("use a workflow" / ultracode). Merge their branches back into the cycle branch and re-run checks.

## 4. Finish

- [ ] `pnpm check` passes on the cycle branch (report failures with output; don't claim done otherwise).
- [ ] Run `/code-review` on the cycle diff (offer `--fix`), then `/simplify` if useful; re-run `pnpm check` after fixes.
- [ ] Every ticket Done, or moved with the user's agreement. Then `cycle complete`; if anything is left, `cycle transfer_workitems` to the next cycle after completing.
- [ ] Update README roadmap ticks if a phase item landed.
- [ ] Tell the user: what was built per ticket, new tickets created, what carried over, and that the branch is ready to merge (merge/push only when they ask).

## Plane gotchas

HTML format, label replacement, page updates and ids are in `docs/plane.md` ("Writing descriptions and comments", "Reference"). If one Plane MCP connector loses auth, another Plane connector in the session works the same; tell the user to reconnect via `/mcp`.
