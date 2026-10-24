import { useRef } from "react";
import { type HotkeyCallback, type Options, useHotkeys } from "react-hotkeys-hook";
import { useCommand } from "./commands";
import { useShortcutsEnabled } from "./preferences";

export const SHORTCUT_SECTIONS = [
  "Universal",
  "Plan Actions",
  "Account Actions",
  "Date Picker",
] as const;
export type ShortcutSection = (typeof SHORTCUT_SECTIONS)[number];

/** A key cap in the dialog: "mod" reads ⌘ on a Mac and ctrl elsewhere. */
export type KeyCap = string;

export interface ShortcutDef {
  label: string;
  section: ShortcutSection;
  /** The caps shown in the dialog; "then" between two groups for a sequence (Flag). */
  caps: readonly KeyCap[];
  /** react-hotkeys-hook's key string; absent for the ones a field handles itself. */
  keys?: string;
  /**
   * Matches the character typed rather than the physical key, for punctuation whose key differs
   * between layouts ("?" and ">").
   */
  useKey?: boolean;
  /**
   * The command palette's name for it, offered there while a screen has it enabled; absent for
   * the ones that only make sense as keys (arrows, select all).
   */
  command?: string;
}

/**
 * Every shortcut the "?" dialog lists, in its order, and the keys bound for each. The dialog is
 * built from this list, and the hooks below read their keys from it, so the two can't drift apart.
 */
export const SHORTCUTS = {
  help: {
    label: "Open Keyboard Shortcuts Help",
    section: "Universal",
    caps: ["?"],
    keys: "?",
    useKey: true,
    command: "Keyboard shortcuts",
  },
  palette: {
    label: "Open command palette",
    section: "Universal",
    caps: ["mod", "K"],
    keys: "mod+k",
  },
  sidebar: {
    label: "Expand/Collapse Sidebar",
    section: "Universal",
    caps: ["shift", "."],
    // Shift+. is ">" on most layouts; the typed character is what's matched.
    keys: ">",
    useKey: true,
    command: "Expand/collapse sidebar",
  },
  selectAll: { label: "Select All", section: "Universal", caps: ["mod", "A"], keys: "mod+a" },
  deselectAll: { label: "Deselect All", section: "Universal", caps: ["escape"], keys: "escape" },
  math: { label: "Math operations", section: "Universal", caps: ["+", "-", "x", "/"] },
  undo: { label: "Undo", section: "Universal", caps: ["mod", "Z"] },
  redo: { label: "Redo", section: "Universal", caps: ["mod", "shift", "Z"] },

  snooze: {
    label: "Snooze target",
    section: "Plan Actions",
    caps: ["shift", "Z"],
    keys: "shift+z",
    command: "Snooze or wake selected targets",
  },
  collapseGroups: {
    label: "Collapse/expand groups",
    section: "Plan Actions",
    caps: ["mod", "↑/↓"],
    keys: "mod+up, mod+down",
  },
  moveRows: {
    label: "Move between plan rows",
    section: "Plan Actions",
    caps: ["↑/↓"],
    keys: "up, down",
  },
  extendCategories: {
    label: "Select multiple categories",
    section: "Plan Actions",
    caps: ["shift", "↑/↓"],
    keys: "shift+up, shift+down",
  },

  addTransaction: {
    label: "Add new transaction",
    section: "Account Actions",
    caps: ["shift", "N"],
    keys: "shift+n",
    command: "Add transaction",
  },
  approve: {
    label: "Approve",
    section: "Account Actions",
    caps: ["A"],
    keys: "a",
    command: "Approve selected",
  },
  approveAll: {
    label: "Approve all transactions",
    section: "Account Actions",
    caps: ["shift", "L"],
    keys: "shift+l",
    command: "Approve all transactions",
  },
  reject: {
    label: "Reject",
    section: "Account Actions",
    caps: ["shift", "R"],
    keys: "shift+r",
    command: "Reject selected",
  },
  categorize: {
    label: "Categorize",
    section: "Account Actions",
    caps: ["K"],
    keys: "k",
    command: "Categorize selected",
  },
  split: {
    label: "Split",
    section: "Account Actions",
    caps: ["S"],
    keys: "s",
    command: "Split transaction",
  },
  enterNow: {
    label: "Enter Now",
    section: "Account Actions",
    caps: ["E"],
    keys: "e",
    command: "Enter selected now",
  },
  match: { label: "Match", section: "Account Actions", caps: ["M"], keys: "m", command: "Match" },
  unmatch: {
    label: "Unmatch",
    section: "Account Actions",
    caps: ["shift", "U"],
    keys: "shift+u",
    command: "Unmatch",
  },
  toggleCleared: {
    label: "Toggle cleared state",
    section: "Account Actions",
    caps: ["C"],
    keys: "c",
  },
  duplicate: {
    label: "Duplicate",
    section: "Account Actions",
    caps: ["shift", "D"],
    keys: "shift+d",
    command: "Duplicate selected",
  },
  flag: {
    label: "Flag",
    section: "Account Actions",
    caps: ["shift", "F", "then", "0‑6"],
    keys: "shift+f",
    command: "Flag selected",
  },
  makeRepeating: {
    label: "Make repeating",
    section: "Account Actions",
    caps: ["shift", "T"],
    keys: "shift+t",
    command: "Make repeating",
  },
  // A Mac keyboard's "delete" key is Backspace.
  delete: {
    label: "Delete",
    section: "Account Actions",
    caps: ["delete"],
    keys: "delete, backspace",
    command: "Delete selected",
  },
  reconcile: {
    label: "Reconcile",
    section: "Account Actions",
    caps: ["shift", "E"],
    keys: "shift+e",
    command: "Reconcile account",
  },
  search: {
    label: "Focus on the search bar",
    section: "Account Actions",
    caps: ["mod", "shift", "F"],
    keys: "mod+shift+f",
  },
  rangeClick: {
    label: "Select a group of transactions",
    section: "Account Actions",
    caps: ["shift", "click"],
  },
  extendTransactions: {
    label: "Select multiple transactions",
    section: "Account Actions",
    caps: ["shift", "↑/↓"],
    keys: "shift+up, shift+down",
  },
  moveTransactions: {
    label: "Move between transactions",
    section: "Account Actions",
    caps: ["↑/↓"],
    keys: "up, down",
  },
  nextField: { label: "Move to next transaction field", section: "Account Actions", caps: ["tab"] },
  previousField: {
    label: "Move to previous transaction field",
    section: "Account Actions",
    caps: ["shift", "tab"],
  },

  datePicker: {
    label: "Navigate the date picker",
    section: "Date Picker",
    caps: ["↑", "↓", "←", "→"],
  },
  dayForward: { label: "Move date one day forward", section: "Date Picker", caps: ["+"] },
  dayBackward: { label: "Move date one day backward", section: "Date Picker", caps: ["-"] },
  today: { label: "Select today", section: "Date Picker", caps: ["T"] },
  monthStart: { label: "Select first day of month", section: "Date Picker", caps: ["M"] },
  monthEnd: { label: "Select last day of month", section: "Date Picker", caps: ["shift", "M"] },
  yearStart: { label: "Select first day of year", section: "Date Picker", caps: ["Y"] },
  yearEnd: { label: "Select last day of year", section: "Date Picker", caps: ["shift", "Y"] },
} as const satisfies Record<string, ShortcutDef>;

export type ShortcutId = keyof typeof SHORTCUTS;
/** The shortcuts the hook can bind (the rest are handled by a field, or are mouse gestures). */
export type BoundShortcutId = {
  [K in ShortcutId]: (typeof SHORTCUTS)[K] extends { keys: string } ? K : never;
}[ShortcutId];

/** Whether this is a Mac, where caps read ⌘ for ctrl. */
export function isMac() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

export function capLabel(cap: KeyCap, mac = isMac()) {
  return cap === "mod" ? (mac ? "⌘" : "ctrl") : cap;
}

/**
 * Focus in a dialog, menu or popover keeps its keys: a shortcut there would act on the page
 * behind it.
 */
function inOverlay(event: KeyboardEvent) {
  const target = event.target;
  return (
    target instanceof Element &&
    target.closest(
      "[role=dialog], [role=alertdialog], [role=menu], [role=listbox], [data-radix-popper-content-wrapper]",
    ) !== null
  );
}

export interface ShortcutOptions {
  /** Off while the screen has nothing for it to act on. */
  enabled?: boolean;
  /**
   * Also fires from these fields, for the few shortcuts that keep working while one is focused
   * (Shift+Z in the Assigned input). Returns true for a focused element the shortcut may act from.
   */
  allowIn?: (target: Element) => boolean;
  /** Leaves the browser's own handling alone (the default prevents it). */
  keepDefault?: boolean;
}

/** What a palette command hands a shortcut's callback: no key was pressed. */
const FROM_PALETTE: Parameters<HotkeyCallback>[1] = { hotkey: "", keys: [] };

/**
 * Binds a shortcut. Every shortcut honours the account's "Enable keyboard shortcuts"
 * setting, skips text fields, dialogs and menus, and prevents the browser's default for the key.
 * One with a `command` name is offered in the command palette too while `enabled` (whatever that
 * setting says: the palette isn't a shortcut).
 */
export function useShortcut(
  id: BoundShortcutId,
  callback: HotkeyCallback,
  { enabled = true, allowIn, keepDefault = false }: ShortcutOptions = {},
) {
  const on = useShortcutsEnabled();
  const def: ShortcutDef = SHORTCUTS[id];
  const options: Options = {
    enabled: on && enabled,
    useKey: def.useKey,
    // A typed "?" or ">" comes with Shift held; the character alone decides.
    ignoreModifiers: def.useKey,
    // ">" is the library's sequence separator by default, and Shift+. is ">"; no shortcut here is
    // a sequence (Shift+F's digit goes to the Flag menu it opens).
    sequenceSplitKey: "»",
    preventDefault: !keepDefault,
    enableOnFormTags: allowIn ? true : undefined,
    enableOnContentEditable: false,
    ignoreEventWhen: (event) => {
      if (inOverlay(event)) return true;
      // "?" and ">" ignore Shift (it's how they're typed), but not Ctrl, Cmd or Alt.
      if (def.useKey && (event.ctrlKey || event.metaKey || event.altKey)) return true;
      if (!allowIn) return false;
      const target = event.target;
      // With allowIn the library lets every field through; keep only the ones asked for.
      if (target instanceof Element && isField(target)) return !allowIn(target);
      return false;
    },
  };
  // The latest callback runs without rebinding the listener on every render.
  const latest = useRef(callback);
  latest.current = callback;
  useCommand({
    label: def.command ?? "",
    caps: def.caps,
    group: def.section === "Universal" ? "general" : "screen",
    run: () => latest.current(new KeyboardEvent("keydown"), FROM_PALETTE),
    enabled: enabled && def.command !== undefined,
  });
  return useHotkeys(def.keys ?? "", (event, hotkey) => latest.current(event, hotkey), options, [
    on,
    enabled,
    allowIn,
  ]);
}

/**
 * What react-hotkeys-hook counts as a form field (by tag or role), so `allowIn` lets a shortcut
 * into the fields it names and no others: a toggle-group item is a `radio`, a menu entry a
 * `menuitem…`.
 */
const FIELD = [
  "input",
  "textarea",
  "select",
  "[contenteditable=true]",
  ...[
    "searchbox",
    "slider",
    "spinbutton",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "radio",
    "textbox",
  ].map((role) => `[role=${role}]`),
].join(", ");

function isField(element: Element) {
  return element.closest(FIELD) !== null;
}
