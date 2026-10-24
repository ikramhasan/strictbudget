import type { components } from "@strictbudget/api-client";
import type { AutoAssignOption, BudgetMonth } from "@strictbudget/engine";
import type { QueryClient } from "@tanstack/react-query";
import { $api } from "./api";

export type MoneyMove = components["schemas"]["MoneyMove"];

/** Recent Moves: the last 34 days of the budget's moves. */
export const movesQueryOptions = (budgetId: string) =>
  $api.queryOptions("get", "/v1/budgets/{budgetId}/moves", { params: { path: { budgetId } } });

/** Every move of one month, behind each category's history popover. */
export const monthMovesQueryOptions = (budgetId: string, month: BudgetMonth) =>
  $api.queryOptions("get", "/v1/budgets/{budgetId}/months/{month}/moves", {
    params: { path: { budgetId, month } },
  });

/** Refetches Recent Moves and every month's moves: call after any change to assigned money. */
export function invalidateMoves(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["get", "/v1/budgets/{budgetId}/moves"] }),
    queryClient.invalidateQueries({
      queryKey: ["get", "/v1/budgets/{budgetId}/months/{month}/moves"],
    }),
  ]);
}

/** Money into a category from Ready to Assign is positive; back to it, negative. */
const assignedDelta = (m: MoneyMove) =>
  m.kind === "assigned" ? BigInt(m.amount) : m.kind === "removed" ? -BigInt(m.amount) : 0n;

/** One line of Recent Moves: a move, or every move of one Auto-Assign. */
export type MoveEntry =
  | { type: "move"; move: MoneyMove }
  | {
      type: "autoAssign";
      /** The first (newest) move, for who, when and the method. */
      move: MoneyMove;
      moves: MoneyMove[];
      method: AutoAssignOption;
      /** "auto-assigned" when the batch added money overall, "removed" when it took some back. */
      verb: "auto-assigned" | "removed";
      /** The batch's net, as a positive amount. */
      total: bigint;
      /** Each category's part, negative when it went against the batch. */
      parts: { move: MoneyMove; amount: bigint }[];
    };

/**
 * Folds each Auto-Assign's moves into one entry where its newest move was: "auto-assigned $60.00 to
 * 3 categories" with the net amount, or "removed" when the net is negative; a part that went the
 * other way shows negative.
 */
export function moveEntries(moves: readonly MoneyMove[]): MoveEntry[] {
  const batches = new Map<string, MoneyMove[]>();
  for (const m of moves) {
    if (m.autoAssign)
      batches.set(m.autoAssign.batchId, [...(batches.get(m.autoAssign.batchId) ?? []), m]);
  }
  const entries: MoveEntry[] = [];
  const seen = new Set<string>();
  for (const m of moves) {
    if (!m.autoAssign) {
      entries.push({ type: "move", move: m });
      continue;
    }
    if (seen.has(m.autoAssign.batchId)) continue;
    seen.add(m.autoAssign.batchId);
    const batch = batches.get(m.autoAssign.batchId) ?? [m];
    const net = batch.reduce((sum, b) => sum + assignedDelta(b), 0n);
    const sign = net < 0n ? -1n : 1n;
    entries.push({
      type: "autoAssign",
      move: m,
      moves: batch,
      method: m.autoAssign.method,
      verb: net < 0n ? "removed" : "auto-assigned",
      total: net * sign,
      parts: batch.map((b) => ({ move: b, amount: assignedDelta(b) * sign })),
    });
  }
  return entries;
}

/** A move as one category's history lists it (the "Moves" popover). */
export interface CategoryMoveLine {
  move: MoneyMove;
  /** "Assigned", "Removed", "Moved from Rent", "Moved to Groceries", "Auto-Assigned". */
  label: string;
  /** The Auto-Assign option, shown small after "Auto-Assigned". */
  method: AutoAssignOption | null;
  /** Signed from the category's side: money in is positive. */
  amount: bigint;
}

/**
 * One category's moves in a month, worded and signed: "Assigned $20.00", "Removed -$5.00", "Moved
 * from Rent $5.00", "Moved to Groceries -$5.00", "Auto-Assigned Assigned Last Month $10.00".
 */
export function categoryMoveLines(
  moves: readonly MoneyMove[],
  categoryId: string,
  name: (id: string | null, deleted: string | null) => string,
): CategoryMoveLine[] {
  const lines: CategoryMoveLine[] = [];
  for (const m of moves) {
    const into = m.toCategoryId === categoryId;
    if (!into && m.fromCategoryId !== categoryId) continue;
    const amount = into ? BigInt(m.amount) : -BigInt(m.amount);
    const label = m.autoAssign
      ? "Auto-Assigned"
      : m.kind === "assigned"
        ? "Assigned"
        : m.kind === "removed"
          ? "Removed"
          : into
            ? `Moved from ${name(m.fromCategoryId, m.fromDeletedCategory)}`
            : `Moved to ${name(m.toCategoryId, m.toDeletedCategory)}`;
    lines.push({ move: m, label, method: m.autoAssign?.method ?? null, amount });
  }
  return lines;
}

/** Category ids with any move in the list (the history icon shows only for these). */
export function categoriesWithMoves(moves: readonly MoneyMove[]) {
  const ids = new Set<string>();
  for (const m of moves) {
    if (m.fromCategoryId) ids.add(m.fromCategoryId);
    if (m.toCategoryId) ids.add(m.toCategoryId);
  }
  return ids;
}

/** Category history is offered in the current and future months, or up to three months in the past. */
export const HISTORY_MONTHS_BACK = 3;

/** The member filter's value for moves with no mover left ("Inactive members"). */
export const INACTIVE_MEMBERS = "inactive";

export interface MemberFilterOption {
  value: string;
  label: string;
}

/**
 * The Recent Moves member filter, after "Everyone": each member by name; someone who left the budget
 * only if they made one of the moves, as "Name (removed)"; "Inactive members" when a move's user is
 * gone. The filter shows only with two or more of these.
 */
export function memberFilterOptions(
  moves: readonly MoneyMove[],
  members: readonly { userId: string; name: string }[],
): MemberFilterOption[] {
  const options = members.map((m) => ({ value: m.userId, label: m.name }));
  const listed = new Set(options.map((o) => o.value));
  let inactive = false;
  for (const m of moves) {
    if (!m.userId || !m.userName) inactive = true;
    else if (!listed.has(m.userId)) {
      listed.add(m.userId);
      options.push({ value: m.userId, label: `${m.userName} (removed)` });
    }
  }
  if (inactive) options.push({ value: INACTIVE_MEMBERS, label: "Inactive members" });
  return options;
}

export function matchesMember(move: MoneyMove, member: string): boolean {
  if (!member) return true;
  if (member === INACTIVE_MEMBERS) return !move.userId || !move.userName;
  return move.userId === member;
}
