# Budget screen toolbar

The budget screen's views bar and toolbar.

- Views are text tabs, and the bar shows at most four (All, Overspent, then the first two in the
  plan's order) however wide the window; the rest, Manage Views and New View are under a "More"
  tab, the selected view always on the bar. Code: `BAR_VIEWS` in
  `apps/web/src/components/budget-filter-bar.tsx`.
- Recent Moves, Undo and Redo are icon buttons at the right of the views bar, then a "⋯" menu
  holding Templates and a Progress bars checkbox (`budget-options-menu.tsx`).
- "+ Category Group" is a + beside the Category column heading; Edit View shows on the bar only
  while a custom view is selected.
