import { useCallback, useState } from "react";

export type ColumnId =
  | "select"
  | "review"
  | "flag"
  | "attachment"
  | "account"
  | "date"
  | "payee"
  | "category"
  | "memo"
  | "outflow"
  | "inflow"
  | "balance"
  | "enteredBy"
  | "cleared"
  | "actions";

/** Fields that can be edited in place, in Tab order. */
export type EditableColumn = Extract<
  ColumnId,
  "account" | "date" | "payee" | "category" | "memo" | "outflow" | "inflow"
>;

interface ColumnSpec {
  header: string;
  /** Fixed width; the memo column takes what's left. */
  width?: string;
  align?: "right" | "center";
  srOnly?: boolean;
}

export const COLUMN_SPECS: Record<ColumnId, ColumnSpec> = {
  select: { header: "Select", width: "2.25rem", align: "center", srOnly: true },
  review: { header: "Approval", width: "2.25rem", align: "center", srOnly: true },
  flag: { header: "Flag", width: "2.5rem", align: "center", srOnly: true },
  attachment: { header: "Attachment", width: "2.75rem", align: "center", srOnly: true },
  account: { header: "Account", width: "8rem" },
  // Room for the date editor: the date plus its calendar button.
  date: { header: "Date", width: "8.75rem" },
  payee: { header: "Payee", width: "11.5rem" },
  category: { header: "Category", width: "12.5rem" },
  memo: { header: "Memo" },
  // Fits "$100,000.00" with the cell padding.
  outflow: { header: "Outflow", width: "6.5rem", align: "right" },
  inflow: { header: "Inflow", width: "6.5rem", align: "right" },
  balance: { header: "Balance", width: "6.5rem", align: "right" },
  enteredBy: { header: "Entered by", width: "2.75rem", align: "center", srOnly: true },
  cleared: { header: "Cleared", width: "2.75rem", align: "center", srOnly: true },
  actions: { header: "Actions", width: "2.75rem", srOnly: true },
};

/**
 * All-accounts view adds the account and drops the running balance. The flag comes first, before
 * the date.
 */
export function registerColumns(allAccounts: boolean): ColumnId[] {
  return [
    "select",
    // Shown only while a row needs approval or a category.
    "review",
    "flag",
    // Photos and PDFs, right after the flag.
    "attachment",
    ...(allAccounts ? (["account"] as const) : []),
    "date",
    "payee",
    "category",
    "memo",
    "outflow",
    "inflow",
    ...(allAccounts ? [] : (["balance"] as const)),
    // Off unless the View menu turns it on.
    "enteredBy",
    "cleared",
    "actions",
  ];
}

export function isEditable(column: ColumnId): column is EditableColumn {
  return ["account", "date", "payee", "category", "memo", "outflow", "inflow"].includes(column);
}

/** The columns people act on in every row, kept in view at the register's right edge. */
const PINNED: readonly ColumnId[] = ["cleared", "actions"];

/**
 * Opaque stand-ins for the rows' see-through backgrounds (each the row's colour mixed onto the page
 * background), so cells scrolling underneath don't show through. Written out in full so Tailwind
 * finds the classes.
 */
export const PINNED_BG = {
  /**
   * Transaction and split-line rows at rest, and jumped to. Hover, an open menu and selection come
   * from RegisterRow, which paints them on every cell in opaque colours.
   */
  row: "bg-background [tr[data-highlighted]>&]:animate-[row-highlight-pinned_2.5s_ease-out]",
  /** The inline editor's rows (`bg-muted/50`). */
  editor: "bg-[color-mix(in_oklab,var(--muted)_50%,var(--background))]",
  /** Scheduled rows (`bg-muted/40`); their selected tint comes from the row (SCHEDULED_ROW in scheduled-section). */
  scheduled: "bg-[color-mix(in_oklab,var(--muted)_40%,var(--background))]",
  /** Header cells are already opaque (the tray's colour); they sit above the body's pinned cells. */
  head: "z-[2]",
};

/**
 * Pins Cleared and Actions to the right edge while the other columns scroll beneath them: sticky
 * at the summed width of the pinned columns after it, the first one with a divider on its left.
 * `null` for the scrolling columns.
 */
export function pinned(
  columns: readonly ColumnId[],
  id: ColumnId,
): { className: string; style: { right: string } } | null {
  if (!PINNED.includes(id)) return null;
  const visible = columns.filter((c) => PINNED.includes(c));
  const after = visible.slice(visible.indexOf(id) + 1);
  const right = `calc(0rem${after.map((c) => ` + ${COLUMN_SPECS[c].width}`).join("")})`;
  return {
    className: [
      "sticky z-[1]",
      visible[0] === id ? "shadow-[inset_1px_0_0_var(--border)]" : "",
    ].join(" "),
    style: { right },
  };
}

export const pinnedColumns = (columns: readonly ColumnId[]) =>
  columns.filter((c) => PINNED.includes(c));

export const pinnedWidth = (columns: readonly ColumnId[]) =>
  `calc(0rem${pinnedColumns(columns)
    .map((c) => ` + ${COLUMN_SPECS[c].width}`)
    .join("")})`;

/**
 * Memo takes what's left, so it grows and shrinks as the others are dragged; the icon columns stay
 * as they are.
 */
export const RESIZABLE: readonly ColumnId[] = [
  "account",
  "date",
  "payee",
  "category",
  "outflow",
  "inflow",
  "balance",
];
export const MIN_COLUMN_PX = 30;

export type ColumnWidths = Partial<Record<ColumnId, number>>;

export function columnWidth(widths: ColumnWidths, id: ColumnId): string | undefined {
  const dragged = widths[id];
  return dragged === undefined ? COLUMN_SPECS[id].width : `${dragged}px`;
}

/** Dragged widths per register (an account's, or All Accounts'), kept in this browser. */
export function useColumnWidths(register: string) {
  const key = `strictbudget:register-columns:${register}`;
  const [widths, setWidths] = useState<ColumnWidths>(() => readWidths(key));
  const [loadedKey, setLoadedKey] = useState(key);
  if (loadedKey !== key) {
    setLoadedKey(key);
    setWidths(readWidths(key));
  }
  const setWidth = useCallback(
    (id: ColumnId, px: number) =>
      setWidths((current) => {
        const next = { ...current, [id]: Math.max(MIN_COLUMN_PX, Math.round(px)) };
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // Storage can be unavailable (private windows); the width still holds for this visit.
        }
        return next;
      }),
    [key],
  );
  return { widths, setWidth };
}

function readWidths(key: string): ColumnWidths {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([id, px]) =>
          RESIZABLE.includes(id as ColumnId) && typeof px === "number" && px >= MIN_COLUMN_PX,
      ),
    );
  } catch {
    return {};
  }
}
