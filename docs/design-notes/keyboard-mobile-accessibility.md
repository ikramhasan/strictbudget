# Keyboard, mobile and accessibility

## Keyboard shortcuts

- One registry, `apps/web/src/lib/shortcuts.ts` (react-hotkeys-hook), lists the shortcuts in the
  "?" dialog's order and holds each one's keys; the dialog is built from it. `useShortcut(id, …)`
  honours the account's Enable keyboard shortcuts, skips text fields, dialogs, menus and popovers
  (a shortcut may allow a field, as Shift+Z does the Assigned input), and prevents the browser's
  default.
- "?" and Shift+. match the typed character, so they work on any keyboard layout. shadcn's
  Cmd/Ctrl+B sidebar toggle is removed (Shift+. is the only one); undo/redo keep their own handler
  in `lib/undo.tsx`. Delete also answers Backspace, the key a Mac labels "delete".
- Up/Down share `stepSelection` (`lib/selection.ts`) between the plan and the register. In the
  register it walks loaded transactions only (not the scheduled rows at the top), and scrolls the
  row into view.
- Selection-bar keys live in `SelectionBar`, each enabled exactly when its button or menu item is
  offered. Shift+F opens the Flag menu even while Flag sits in More (with unapproved rows),
  anchored to More.
- Bulk Flag, Cleared, Approve, Categorize and Memo keep the selection; Delete, Reject and Move
  clear it, Duplicate and Enter Now select the new rows.
- Typed math takes x, × and ÷ as well as * and / (engine `evaluateAmount`).
- Enter on the one selected transaction opens its first cell (or its split), so the register can
  be edited without a mouse.

## Display Options and resizing

- Display Options sits in the budget menu's Current budget section; its settings are per browser
  (`lib/display-options.ts`, one store per localStorage key). The progress-bars checkbox in the
  plan's ⋯ menu stays as a shortcut to the same setting.
- Differentiate Without Color uses its own fixed colours for overspent and cautious pills; the
  default pills keep their Tailwind shades.
- The sidebar starts at 224px and resizes between 150 and 600px; it collapses to a 56px rail, and
  balances hide under 220px. Its drag handle is hand-rolled: shadcn's Sidebar is a fixed panel
  sized by a CSS variable, which react-resizable-panels can't drive. It starts as the rail below
  1024px.
- The inspector uses react-resizable-panels at lg and up, between 25 and 50% of the width (a third
  to start).
- Register columns are kept in pixels (not percentages) per register
  (`strictbudget:register-columns:<account|all>`); Memo absorbs what the others take or give, and
  the icon columns (select, approval, flag, entered by, cleared, actions) keep their width.
  Resizing is hand-rolled over the table's colgroup (the register isn't built on a table library's
  columns).
- Members with the same initial get distinct avatar patterns with Differentiate Without Color.

## Phones and tablets

- The layout below 1024px is designed for touch, not a squeezed desktop. Drawers are vaul (shadcn
  Drawer).
- Phone: a bottom navigation bar (Budget, Accounts, Reports, Activity, More), safe-area padding;
  plan rows of name and Available; a category opens in a bottom drawer with a large Assigned box
  and the inspector.
- Below 1024px the register is a card list with a full-height drawer to add, edit (the stacked
  `TransactionEditor`) and delete; editing scheduled transactions there is [#111](https://github.com/ikramhasan/strictbudget/issues/111). Pages load 100
  at a time with Show more.
- Tablet: the sidebar starts as the rail; the inspector is a side drawer.
- On phone-sized touch screens every button, checkbox, switch and menu trigger gets a 44px hit area
  through a pseudo-element (`styles.css`).

## Accessibility

- WCAG 2.2 AA is the bar, and it wins over any colour choice. So far one change:
  `--muted-foreground` is oklch 0.52 (shadcn 0.556) so muted text passes 4.5:1 on `--muted`.
- axe runs in tests through `src/test/axe.ts` (contrast left to the browser, which can measure it);
  the browser audit covers every route in both themes at desktop and phone width.
- dnd-kit puts a button role on whatever it drags by: rows move through a handle, and rows or
  groups that can't move get an empty hidden one so the role never wraps links and buttons.
- `CardTitle` renders an h2 (vendored, marked `strictbudget:`).
- Pills, progress bars and the Move/Cover buttons say their state in words (overspent, credit
  overspending, needs more, % spent/available).
