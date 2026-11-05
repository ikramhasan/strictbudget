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
  /** Outflow and Inflow folded into one signed figure, where the register is too narrow for both. */
  | "amount"
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
  /** Fixed width; Payee, Category and Memo share what's left (FLEX). */
  width?: string;
  align?: "right" | "center";
  srOnly?: boolean;
}

export const COLUMN_SPECS: Record<ColumnId, ColumnSpec> = {
  select: { header: "Select", width: "1.75rem", align: "center", srOnly: true },
  review: { header: "Approval", width: "2.25rem", align: "center", srOnly: true },
  flag: { header: "Flag", width: "1.75rem", align: "center", srOnly: true },
  attachment: { header: "Attachment", width: "1.75rem", align: "center", srOnly: true },
  account: { header: "Account", width: "7rem" },
  // layoutColumns sizes the date to its format (dateWidth).
  date: { header: "Date", width: "7rem" },
  payee: { header: "Payee" },
  category: { header: "Category" },
  memo: { header: "Memo" },
  // Fits "$10,000.00" with the cell padding; the row editor's amount fits too.
  outflow: { header: "Outflow", width: "5.75rem", align: "right" },
  inflow: { header: "Inflow", width: "5.75rem", align: "right" },
  // Signed, and its editor has a direction toggle beside the figure.
  amount: { header: "Amount", width: "6.5rem", align: "right" },
  // Fits "-$10,000.00".
  balance: { header: "Balance", width: "6.25rem", align: "right" },
  enteredBy: { header: "Entered by", width: "2.5rem", align: "center", srOnly: true },
  cleared: { header: "Cleared", width: "2.25rem", align: "center", srOnly: true },
  actions: { header: "Actions", width: "2.25rem", srOnly: true },
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
  row: "bg-background [tr[data-highlighted=jump]>&]:animate-[row-highlight-pinned_2.5s_ease-out] [tr[data-highlighted=saved]>&]:animate-[row-highlight-pinned_0.9s_ease-out]",
  /** The inline editor's rows (`bg-muted/50`). */
  editor: "bg-[color-mix(in_oklab,var(--muted)_50%,var(--background))]",
  /** Scheduled rows (`bg-muted/40`); their selected tint comes from the row (SCHEDULED_ROW in scheduled-section). */
  scheduled: "bg-[color-mix(in_oklab,var(--muted)_40%,var(--background))]",
  /** Header cells are already opaque (the tray's colour); they sit above the body's pinned cells. */
  head: "z-[2]",
};

/**
 * Pins Cleared and Actions to the right edge while the other columns scroll beneath them: sticky
 * at the summed width of the pinned columns after it, the first one with a divider on its left
 * while the table is wider than the register (`data-overflowing` on the table). `null` for the
 * scrolling columns.
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
      visible[0] === id ? "[table[data-overflowing]_&]:shadow-[inset_1px_0_0_var(--border)]" : "",
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

/** Columns whose header edge can be dragged; Memo takes what's left, the icon columns stay put. */
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

const REM_PX = 16;

/**
 * Payee, Category and Memo share what the fixed columns leave, in these proportions.
 * `comfortable` is what each needs to read most entries whole (longer ones truncate, with the full
 * text on hover): a layout that gives every one of them that much wins over a wider one that
 * doesn't. `min` is the least they're squeezed to before the register scrolls sideways. Memo takes
 * the remainder (Category without it), so the row always fills the register.
 */
const FLEX: Partial<Record<ColumnId, { min: number; comfortable: number; share: number }>> = {
  payee: { min: 96, comfortable: 132, share: 0.36 },
  category: { min: 104, comfortable: 140, share: 0.36 },
  memo: { min: 72, comfortable: 100, share: 0.28 },
};

/**
 * Wide enough for the row editor's date field (the date and its calendar button, see
 * DATE_EDITOR_FIT), so the column is the same width whether or not a row is being edited. Dashes
 * are wider than slashes and dots.
 */
function dateWidth(format: string) {
  return (format.includes("-") ? 7.25 : 7) * REM_PX;
}

/** The columns that hold money, sized to their widest figure. */
export type MoneyColumn = "outflow" | "inflow" | "amount" | "balance";
export const MONEY_COLUMNS: readonly MoneyColumn[] = ["outflow", "inflow", "amount", "balance"];

/**
 * What the rows need (px, the content alone): each money column's widest figure, and the widest
 * payee and category (with a transfer's icon), which the spare room goes to first.
 */
export type ContentWidths = Partial<Record<MoneyColumn | "payee" | "category", number>>;

/** Past this a payee or category truncates rather than take more room (a long imported name). */
const READ_WHOLE_PX = 280;

/**
 * The least a money column narrows to: its header, and a short amount in its row editor. Amount
 * keeps room for its editor's direction toggle.
 */
const MONEY_MIN_PX: Record<MoneyColumn, number> = {
  outflow: 4.5 * REM_PX,
  inflow: 4.5 * REM_PX,
  amount: 6.5 * REM_PX,
  balance: 4.75 * REM_PX,
};
/** A cell's padding (px-2 on each side), and a little air so tabular figures never clip. */
const MONEY_PADDING_PX = 2 * 8 + 4;

interface Sizing {
  dragged: ColumnWidths;
  dateFormat: string;
  /** The account column shows each account's name without its logo, in less room. */
  accountCompact?: boolean;
  /**
   * The widest figure in each money column: the column fits it (with a floor), rather than a fixed
   * width for "$10,000.00", so Payee and Category get the room it doesn't need.
   */
  content?: ContentWidths;
}

/** Room for "Checking" or "Visa Card" with the cell's padding; longer names truncate. */
const ACCOUNT_COMPACT_PX = 84;

const isMoney = (id: ColumnId): id is MoneyColumn => MONEY_COLUMNS.includes(id as MoneyColumn);

function fixedWidth(id: ColumnId, { dragged, dateFormat, accountCompact, content }: Sizing) {
  if (id === "date") return Math.max(dragged.date ?? 0, dateWidth(dateFormat));
  const fits = isMoney(id) ? content?.[id] : undefined;
  if (dragged[id] === undefined && isMoney(id) && fits !== undefined) {
    return Math.max(MONEY_MIN_PX[id], Math.ceil(fits + MONEY_PADDING_PX));
  }
  const width = dragged[id] ?? Number.parseFloat(COLUMN_SPECS[id].width ?? "0") * REM_PX;
  return id === "account" && accountCompact ? Math.min(width, ACCOUNT_COMPACT_PX) : width;
}

const isFlex = (id: ColumnId, dragged: ColumnWidths) =>
  FLEX[id] !== undefined && dragged[id] === undefined;

type Fit = "min" | "comfortable";

/** The width a set of columns needs: the fixed ones, and the flexible ones at `fit`. */
function neededWidth(columns: readonly ColumnId[], sizing: Sizing, fit: Fit) {
  return columns.reduce(
    (sum, id) =>
      sum + (isFlex(id, sizing.dragged) ? (FLEX[id]?.[fit] ?? 0) : fixedWidth(id, sizing)),
    0,
  );
}

export interface ColumnLayout {
  columns: ColumnId[];
  /** Each column's width in px; undefined for the one that takes what's left (Memo, if shown). */
  widths: Partial<Record<ColumnId, number>>;
  /** The table's least width: wider than the register only when even the narrowest layout isn't. */
  minWidth: number;
  /** The account column shows each account's name without its logo. */
  accountCompact: boolean;
  /** Memo is on but has no room: each row shows it after the payee, and edits it there. */
  memoInPayee: boolean;
}

/**
 * Fits the View menu's columns into the register's width (`available`, px; null before it's
 * measured), so the money columns never scroll under the pinned Cleared and Actions and Payee and
 * Category keep room to read. When they don't all fit, All Accounts first narrows its account
 * column to the name alone; then Memo goes (each row shows its memo after the payee); then
 * Outflow and Inflow fold into one signed Amount; then the running balance goes. Where even that
 * leaves Payee and Category short of comfortable, the most compact layout gives them what room
 * there is. The row editors use the same layout (they edit a folded Amount in place), so nothing
 * moves when a row starts or stops being edited. Past the narrowest layout the table scrolls
 * sideways.
 */
export function layoutColumns(
  shown: readonly ColumnId[],
  {
    dragged,
    available,
    dateFormat,
    content,
  }: {
    dragged: ColumnWidths;
    available: number | null;
    dateFormat: string;
    /** The widest figure in each money column (`measureMoney`); fixed widths without it. */
    content?: ContentWidths;
  },
): ColumnLayout {
  const folded = shown.flatMap((id): ColumnId[] =>
    id === "outflow" ? ["amount"] : id === "inflow" ? [] : [id],
  );
  const without =
    (drop: ColumnId) =>
    (columns: readonly ColumnId[]): ColumnId[] =>
      columns.filter((id) => id !== drop);
  const noMemo = without("memo");
  const noBalance = without("balance");
  const base = { dragged, dateFormat, content };
  const compact = { ...base, accountCompact: shown.includes("account") };
  const tiers: { columns: readonly ColumnId[]; sizing: Sizing }[] = [
    { columns: shown, sizing: base },
    { columns: shown, sizing: compact },
    { columns: noMemo(shown), sizing: compact },
    { columns: noMemo(folded), sizing: compact },
    { columns: noBalance(noMemo(folded)), sizing: compact },
  ];
  const tier =
    (available === null
      ? tiers[0]
      : (tiers.find((t) => neededWidth(t.columns, t.sizing, "comfortable") <= available) ??
        tiers.at(-1))) ?? (tiers[0] as (typeof tiers)[number]);
  const columns = [...tier.columns];
  const { sizing } = tier;

  const minWidth = neededWidth(columns, sizing, "min");
  const fixed = columns
    .filter((id) => !isFlex(id, dragged))
    .reduce((sum, id) => sum + fixedWidth(id, sizing), 0);
  const free = Math.max((available ?? minWidth) - fixed, 0);
  // Floors at the comfortable widths where there's room for them all.
  const flexible = columns.filter((id) => isFlex(id, dragged));
  const fit: Fit = neededWidth(flexible, sizing, "comfortable") <= free ? "comfortable" : "min";
  const widths: Partial<Record<ColumnId, number>> = {};
  for (const id of columns) {
    if (!isFlex(id, dragged)) widths[id] = fixedWidth(id, sizing);
  }
  // Each flexible column starts at its floor (all of them, where there's room for that). What's
  // left goes first to Payee, then Category, until they read their entries whole (Memo giving up
  // its comfortable room for them, down to its least), then to each by its share.
  const floor = (id: ColumnId) => FLEX[id]?.[fit] ?? 0;
  for (const id of flexible) widths[id] = floor(id);
  let left = free - flexible.reduce((sum, id) => sum + floor(id), 0);
  const memo = FLEX.memo;
  const lent = flexible.includes("memo") && memo ? Math.max(0, floor("memo") - memo.min) : 0;
  let pool = Math.max(left, 0) + lent;
  for (const id of ["payee", "category"] as const) {
    const whole = flexible.includes(id) ? content?.[id] : undefined;
    if (whole === undefined) continue;
    const need = Math.max(0, Math.min(READ_WHOLE_PX, Math.ceil(whole + 16)) - (widths[id] ?? 0));
    const given = Math.min(pool, need);
    widths[id] = (widths[id] ?? 0) + given;
    pool -= given;
  }
  // What Memo lent and wasn't needed goes back to it.
  const kept = Math.min(pool, lent);
  if (widths.memo !== undefined) widths.memo -= lent - kept;
  left = pool - kept;
  if (left > 0) {
    const shares = flexible.reduce((sum, id) => sum + (FLEX[id]?.share ?? 0), 0);
    for (const id of flexible) {
      widths[id] = (widths[id] ?? 0) + Math.floor((left * (FLEX[id]?.share ?? 0)) / shares);
    }
  }
  // Memo takes what's left (Category, or Payee, without it), so rounding never leaves a gap.
  const remainder = (["memo", "category", "payee"] as const).find((id) => flexible.includes(id));
  if (remainder) delete widths[remainder];
  return {
    columns,
    widths,
    minWidth,
    accountCompact: sizing.accountCompact ?? false,
    memoInPayee: shown.includes("memo") && !columns.includes("memo"),
  };
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

let canvas: HTMLCanvasElement | null = null;

/** A cell's text, and any room beside it (a transfer's icon). */
export type CellText = string | { text: string; extra: number };

/**
 * Each column's widest cell, in px, as `font` draws its text. Without a canvas (tests), an
 * estimate from the characters, about 0.6em each.
 */
export function measureContent(
  texts: Partial<Record<keyof ContentWidths, readonly CellText[]>>,
  font: string,
): ContentWidths {
  // jsdom has no canvas (and says so on every call).
  const drawable = typeof document !== "undefined" && !navigator.userAgent.includes("jsdom");
  if (!canvas && drawable) canvas = document.createElement("canvas");
  const context = canvas?.getContext("2d") ?? null;
  if (context) context.font = font;
  const size = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? "14");
  const width = (cell: CellText) => {
    const text = typeof cell === "string" ? cell : cell.text;
    const extra = typeof cell === "string" ? 0 : cell.extra;
    return (context?.measureText(text).width ?? text.length * size * 0.6) + extra;
  };
  const widths: ContentWidths = {};
  for (const [id, list] of Object.entries(texts) as [keyof ContentWidths, readonly CellText[]][]) {
    // The table sets figures in tabular digits, all as wide as a 0; a canvas can't.
    const tabular = (cell: CellText) =>
      isMoney(id) && typeof cell === "string" ? cell.replace(/\d/g, "0") : cell;
    widths[id] = list.reduce((widest, cell) => Math.max(widest, width(tabular(cell))), 0);
  }
  return widths;
}
