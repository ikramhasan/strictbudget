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

/** Newest first (within a day, the last entered on top). */
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

interface DayRow {
  id: string;
  date: string;
  accountId: string;
  amount: string;
  runningBalance: string;
}

/**
 * Under a sort by date alone, each day's transactions in the order they were entered: newest
 * first when dates descend (oldest first when they ascend), so one just added sits at the top of
 * its day instead of wherever its amount puts it. Ids are UUIDv7, so they sort by creation. The API
 * breaks a day's ties by amount, so each account's running balances are worked out again for the
 * new order, ending the day where the API's last one did.
 */
export function enteredOrder<T extends DayRow>(
  rows: readonly T[],
  sort: readonly SortField[],
): readonly T[] {
  const stack = sort.length > 0 ? sort : DEFAULT_SORT;
  const [first] = stack;
  if (stack.length !== 1 || first?.column !== "date") return rows;
  const newestFirst = first.dir === "desc";
  const out: T[] = [];
  for (let start = 0; start < rows.length; ) {
    let end = start + 1;
    while (end < rows.length && rows[end]?.date === rows[start]?.date) end++;
    const day = rows.slice(start, end);
    start = end;
    if (day.length === 1) {
      out.push(...day);
      continue;
    }
    const balances = dayBalances(day);
    day.sort((a, b) => (a.id < b.id ? 1 : -1) * (newestFirst ? 1 : -1));
    out.push(
      ...day.map((row) => {
        const balance = balances.get(row.id);
        return balance === undefined || balance === row.runningBalance
          ? row
          : { ...row, runningBalance: balance };
      }),
    );
  }
  return out;
}

/** One day's running balances, per account, with its transactions in the order they were entered. */
function dayBalances(day: readonly DayRow[]): Map<string, string> {
  const byAccount = new Map<string, DayRow[]>();
  for (const row of day)
    byAccount.set(row.accountId, [...(byAccount.get(row.accountId) ?? []), row]);
  const balances = new Map<string, string>();
  for (const rows of byAccount.values()) {
    // The API's last of the day: the largest outflow, the last entered among equals.
    const last = rows.reduce((a, b) => {
      const diff = BigInt(a.amount) - BigInt(b.amount);
      return diff > 0n || (diff === 0n && b.id > a.id) ? b : a;
    });
    let balance = BigInt(last.runningBalance);
    for (const row of [...rows].sort((a, b) => (a.id < b.id ? 1 : -1))) {
      balances.set(row.id, balance.toString());
      balance -= BigInt(row.amount);
    }
  }
  return balances;
}
