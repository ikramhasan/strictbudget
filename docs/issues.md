# Tracking work

Open work lives in GitHub: issues in [ikramhasan/strictbudget](https://github.com/ikramhasan/strictbudget/issues)
and the [strictbudget project](https://github.com/users/ikramhasan/projects/1) board. Use `gh` for
everything below. Deliberate decisions and simplifications are in
[`design-notes/`](design-notes/README.md); the order of upcoming work is in [`roadmap.md`](roadmap.md).

## Rules

1. **Don't defer anything you can settle now.** An open question you can answer by checking is a
   reason to go and check, not to write it down. This includes every line of an issue's scope: a
   pass over an area means all of it, not a sample.
2. **Test what you implement.** Engine and API tests for the rules, and a check in the running app
   in light and dark for anything the UI shows (see `CLAUDE.md`). An issue isn't done until it's
   tested.
3. **If you can't test or verify something right now, open an issue for it.** Say what's missing,
   what's blocking (e.g. "needs the adjustment from #12"), and what to do next. The same goes for
   gaps you find along the way, even outside the current work. If it's a deliberate
   simplification, also add a line to the matching file in `design-notes/` naming the issue.
4. **Keep GitHub current as you work, not at the end.** Every status change, finding and commit
   goes onto the issue when it happens (see "As you work").

## Milestones

A milestone is a batch of issues worked through together (`Cycle N · …`). To work through one,
use the `/run-cycle N` skill (`.claude/skills/run-cycle/SKILL.md`). Before starting any issue,
read its body, its comments and the design notes for the area.

## As you work

- **Starting an issue:** set its project Status to In Progress.
- **Findings:** comment as soon as you have them (what you checked, in which test, the numbers),
  not in one summary at the end.
- **Scope changes:** if what you learn changes an issue's scope (or another one's), edit its body,
  or comment on the other issue that it's unblocked/affected.
- **New gaps or follow-ups:** open an issue right away (rule 3), add it to the project, and mention
  it on the issue you're working on.
- **Finishing an issue:** comment with the commit(s), the branch, what was tested (tests added,
  browser checks) and anything left, then close it (Status becomes Done). A PR body with
  `Fixes #N` closes it on merge. Only close it when it's built and tested.

## Reference

- Project: `gh project … 1 --owner ikramhasan` (id `PVT_kwHOA6v4Mc4BotQf`). Fields: **Status**
  (Backlog, Todo, In Progress, Done) and **Priority** (Urgent, High, Medium, Low). Add a new
  issue with `gh project item-add 1 --owner ikramhasan --url <issue url>`; set fields with
  `gh project item-edit` (`gh project field-list 1 --owner ikramhasan` lists the ids).
- Labels say the area (`register`, `reports`, `multi-currency`, …) and kind (`feature`, `bug`,
  `extra`, `tech debt`).
- Blockers are GitHub issue dependencies ("blocked by"); an umbrella issue holds its parts as
  sub-issues.
- Issues moved from Plane end with a link to the old Plane ticket, which is cancelled; its history
  is kept there.
