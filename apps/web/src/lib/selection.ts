/**
 * The register's selection: rows ticked one by one, or "all matching the filter" (including rows
 * not loaded yet) minus the ones unticked after.
 */
export type Selection =
  | { mode: "some"; ids: ReadonlySet<string> }
  | { mode: "all"; except: ReadonlySet<string> };

export const NOTHING: Selection = { mode: "some", ids: new Set() };

export function isSelected(selection: Selection, id: string) {
  return selection.mode === "some" ? selection.ids.has(id) : !selection.except.has(id);
}

export function isEmpty(selection: Selection) {
  return selection.mode === "some" && selection.ids.size === 0;
}

/** Ticks or unticks `ids` (one row, or a shift-click range). */
export function setSelected(selection: Selection, ids: readonly string[], on: boolean): Selection {
  if (selection.mode === "some") {
    const next = new Set(selection.ids);
    for (const id of ids) on ? next.add(id) : next.delete(id);
    return { mode: "some", ids: next };
  }
  const except = new Set(selection.except);
  for (const id of ids) on ? except.delete(id) : except.add(id);
  return { mode: "all", except };
}

/**
 * The rows from the last ticked one to `id`, in register order, for shift-click. Just `id` when
 * there's no anchor or it's no longer loaded.
 */
export function rangeTo(order: readonly string[], anchor: string | null, id: string) {
  const to = order.indexOf(id);
  const from = anchor === null ? -1 : order.indexOf(anchor);
  if (from === -1 || to === -1) return [id];
  return order.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/** What the API takes; `filter` is the register's current filter. */
export function selectionBody<F>(selection: Selection, filter: F) {
  return selection.mode === "some"
    ? { ids: [...selection.ids] }
    : { filter, exclude: [...selection.except] };
}

/** Where keyboard selection stands: the row a Shift range starts from, and the row it reaches. */
export interface KeyCursor {
  anchor: string | null;
  head: string | null;
}

/**
 * Up/Down over a list of rows (the budget screen and the register). With nothing selected, Down
 * selects the first row and Up the last. Plain Up/Down moves a single selection one row, wrapping at
 * the ends; with several selected the register moves on from the range's anchor and the budget
 * screen does nothing (`several`). Shift grows or shrinks a range from the anchor and stops at the
 * ends. Null when nothing changes.
 */
export function stepSelection(
  order: readonly string[],
  selected: ReadonlySet<string>,
  cursor: KeyCursor,
  direction: 1 | -1,
  { extend = false, several }: { extend?: boolean; several: "anchor" | "none" },
): { ids: string[]; cursor: KeyCursor } | null {
  if (order.length === 0) return null;
  const inList = [...selected].filter((id) => order.includes(id));
  if (inList.length === 0) {
    const id = (direction > 0 ? order[0] : order.at(-1)) as string;
    return { ids: [id], cursor: { anchor: id, head: id } };
  }
  const first = order.find((id) => selected.has(id)) as string;
  const anchor =
    inList.length === 1
      ? (inList[0] as string)
      : cursor.anchor !== null && selected.has(cursor.anchor)
        ? cursor.anchor
        : first;
  if (extend) {
    const head =
      cursor.head !== null && order.includes(cursor.head) && inList.length > 1
        ? cursor.head
        : anchor;
    const at = order.indexOf(head) + direction;
    if (at < 0 || at >= order.length) return null;
    const next = order[at] as string;
    return { ids: rangeTo(order, anchor, next), cursor: { anchor, head: next } };
  }
  if (inList.length > 1 && several === "none") return null;
  const at = (order.indexOf(anchor) + direction + order.length) % order.length;
  const next = order[at] as string;
  return { ids: [next], cursor: { anchor: next, head: next } };
}
