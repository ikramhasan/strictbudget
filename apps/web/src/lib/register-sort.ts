/** What a register can sort by (the API's `sort` columns). */
export const SORT_COLUMNS = [
  "date",
  "account",
  "payee",
  "category",
  "memo",
  "outflow",
  "inflow",
  "flag",
  "cleared",
] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];
export type SortDir = "asc" | "desc";
export interface SortField {
  column: SortColumn;
  dir: SortDir;
}

/** Newest first (a day's largest outflow on top). */
export const DEFAULT_SORT: readonly SortField[] = [{ column: "date", dir: "desc" }];

/**
 * A stacked sort: every column clicked is kept, most recent first, and earlier ones break ties in
 * their own direction. A column that isn't first moves to the front descending; clicking the first
 * one flips it.
 */
export function nextSort(stack: readonly SortField[], column: SortColumn): SortField[] {
  const [first] = stack;
  if (first?.column === column) {
    return [{ column, dir: first.dir === "asc" ? "desc" : "asc" }, ...stack.slice(1)];
  }
  return [{ column, dir: "desc" }, ...stack.filter((f) => f.column !== column)];
}

/** The API's `sort` parameter: `payee:desc,date:asc`. */
export function formatSort(stack: readonly SortField[]) {
  return (stack.length > 0 ? stack : DEFAULT_SORT).map((f) => `${f.column}:${f.dir}`).join(",");
}

/** A stored stack, or the default when it isn't one (an old or hand-edited value). */
export function readSort(value: unknown): SortField[] {
  if (!Array.isArray(value)) return [...DEFAULT_SORT];
  const stack: SortField[] = [];
  for (const item of value) {
    const { column, dir } = (item ?? {}) as Partial<SortField>;
    if (!SORT_COLUMNS.includes(column as SortColumn) || (dir !== "asc" && dir !== "desc")) {
      return [...DEFAULT_SORT];
    }
    if (!stack.some((f) => f.column === column)) stack.push({ column: column as SortColumn, dir });
  }
  return stack.length > 0 ? stack : [...DEFAULT_SORT];
}
