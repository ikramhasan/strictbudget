import type { BulkAction } from "@/components/selection-bar";

const transactions = (count: number) => `${count} transaction${count === 1 ? "" : "s"}`;

/**
 * A bulk action as the undo history names it ("delete 2 transactions"): the Undo button's tooltip
 * reads "Undo delete 2 transactions", its toast "Undone · Delete 2 transactions".
 */
export function bulkLabel(action: BulkAction, count: number): string {
  const n = transactions(count);
  switch (action.type) {
    case "cleared":
      return `mark ${n} ${action.cleared}`;
    case "flag":
      return action.flag ? `flag ${n}` : `remove the flag from ${n}`;
    case "memo":
      return `change the memo on ${n}`;
    case "enterNow":
      return `enter ${n} now`;
    default:
      return `${action.type} ${n}`;
  }
}

/** What the toast says once a bulk action is done ("Deleted 2 transactions"). */
export function bulkDoneMessage(action: BulkAction, count: number): string {
  const n = transactions(count);
  switch (action.type) {
    case "delete":
      return `Deleted ${n}`;
    case "approve":
      return `Approved ${n}`;
    case "reject":
      return `Rejected ${n}`;
    case "move":
      return `Moved ${n}`;
    case "duplicate":
      return `Duplicated ${n}`;
    case "enterNow":
      return `Entered ${n}`;
    default:
      return `Updated ${n}`;
  }
}

/** Bulk actions that remove transactions: their toast stays up longer, with Undo. */
export function bulkRemoves(action: BulkAction): boolean {
  return action.type === "delete" || action.type === "reject";
}
