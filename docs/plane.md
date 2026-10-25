# Working with Plane

Plane is the source of truth for what's planned, in progress and done: project **Everycent**
(identifier `EVERYCENT`, id `69479a76-b0fc-4151-a446-8d3d13980081`), workspace `ikram-hasan`.
Use the Plane MCP tools (`workitem`, `workitem_comment`, `cycle`, `state`, …) for everything below.

## Rules

1. **Don't defer anything you can settle now.** An open question you can answer by checking is a
   reason to go and check, not to write it down. This includes every line of a ticket's scope: a
   pass over an area means all of it, not a sample.
2. **Test what you implement.** Engine and API tests for the rules, and a check in the running app
   in light and dark for anything the UI shows (see `CLAUDE.md`). A ticket isn't Done until it's
   tested.
3. **If you can't test or verify something right now, create a ticket for it.** Say what's missing,
   what's blocking (e.g. "needs the adjustment from another ticket"), and what to do next.
   The same goes for gaps you find along the way, even outside the current work. If it's a
   deliberate simplification, also add a line to the Plane page "Design notes and known
   differences" naming the ticket.
4. **Keep Plane current as you work, not at the end.** Every state change, finding and commit goes
   into Plane when it happens (see "As you work").

## Cycles

To work through a cycle, use the `/run-cycle N` skill (`.claude/skills/run-cycle/SKILL.md`): it
starts the cycle, orders its tickets, works them under the rules here, and completes it. Before
starting any ticket, read its description and the Plane page "Design notes and known differences".

## As you work

- **Starting a ticket:** set it to In Progress.
- **Findings:** add a comment as soon as you have them (what you checked, in which test, the
  numbers), not in one summary at the end.
- **Scope changes:** if what you learn changes a ticket's scope (or another ticket's), update its
  description, or comment on the other ticket that it's unblocked/affected.
- **New gaps or follow-ups:** create a ticket right away (rule 3), and link or mention it on the
  ticket you're working on.
- **Finishing a ticket:** comment with the commit(s), the branch, what was tested (tests added,
  browser checks), and anything left; then set it to Done. Only Done when it's built and tested.

## Writing descriptions and comments

Plane has a bug: **newlines in HTML break the formatting.** `description_html` and `comment_html`
must be a single line with no newlines anywhere, including between tags.

- Write the whole value on one line: `<p>…</p><h3>…</h3><ul><li><p>…</p></li></ul>`.
- Wrap each list item's text in `<p>` inside its `<li>`.
- Use `<code>` for paths, branches and ids, `<strong>` for the key point.
- Don't paste multi-line strings (heredocs, formatted HTML) into these fields.

## Reference

- States (project): Backlog `5cbb7158-0e12-431a-9e5c-e5fdf18df1b7`, Todo
  `a4b1fbeb-6661-4e80-b163-1e0f41f035dd`, In Progress `bcc2a53e-b3b5-4a7c-87e8-e0d12c2035e6`, Done
  `636a8e41-831f-4f68-9f59-d0a5a7fed66a`, Cancelled `eb3f340a-ec4c-40c3-bf87-2ba707b12fb9`. Check
  with `state list` if one is missing.
- Blockers are "blocked by" relations.
- Project pages (`page` tool): "Design notes and known differences"
  `938ef370-2a7d-426b-99c1-bd83835af2b0`, and "Roadmap:
  cycles 10–23" `90b6d069-b974-4da1-9d4b-83a86145a397`. Page bodies follow the single-line HTML
  rule too, and `page update` replaces the whole body: retrieve the page, edit, send it all back.
- `workitem update` takes no `fields` argument; pass only what changes. Passing `labels` replaces
  all of a ticket's labels: use `manage_label` to add or remove one.
- Plane's dates are UTC: today in Plane can be a day behind the user's local date.
