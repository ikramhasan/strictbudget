import { describe, expect, it } from "vitest";
import {
  DEFAULT_SORT,
  enteredOrder,
  formatSort,
  nextSort,
  readSort,
  type SortField,
} from "./register-sort";

describe("register sort", () => {
  it("stacks clicks: a new column first and descending, the first one flips", () => {
    // Clicks: Payee, Payee, Date, Date, Memo.
    let stack: SortField[] = [...DEFAULT_SORT];
    stack = nextSort(stack, "payee");
    expect(formatSort(stack)).toBe("payee:desc,date:desc");
    stack = nextSort(stack, "payee");
    expect(formatSort(stack)).toBe("payee:asc,date:desc");
    stack = nextSort(stack, "date");
    expect(formatSort(stack)).toBe("date:desc,payee:asc");
    stack = nextSort(stack, "date");
    expect(formatSort(stack)).toBe("date:asc,payee:asc");
    stack = nextSort(stack, "memo");
    expect(formatSort(stack)).toBe("memo:desc,date:asc,payee:asc");
    // A column already in the stack comes back descending, whatever it was.
    expect(formatSort(nextSort(stack, "payee"))).toBe("payee:desc,memo:desc,date:asc");
  });

  it("reads a stored stack, falling back to the default for anything else", () => {
    expect(readSort([{ column: "flag", dir: "asc" }])).toEqual([{ column: "flag", dir: "asc" }]);
    expect(readSort(undefined)).toEqual(DEFAULT_SORT);
    expect(readSort([])).toEqual(DEFAULT_SORT);
    expect(readSort([{ column: "amount", dir: "asc" }])).toEqual(DEFAULT_SORT);
    expect(readSort([{ column: "date", dir: "up" }])).toEqual(DEFAULT_SORT);
    expect(
      readSort([
        { column: "date", dir: "asc" },
        { column: "date", dir: "desc" },
      ]),
    ).toEqual([{ column: "date", dir: "asc" }]);
  });
});

describe("enteredOrder", () => {
  // Ids sort by creation (UUIDv7): b was entered after a, c after b.
  const row = (id: string, date: string, amount: string, runningBalance: string) => ({
    id,
    date,
    accountId: "checking",
    amount,
    runningBalance,
  });
  // As the API sends them: the 2nd's largest outflow on top, its balance the day's end.
  const api = [
    row("d", "2026-11-03", "-500", "8500"),
    row("c", "2026-11-02", "-5000", "9000"),
    row("a", "2026-11-02", "-1000", "14000"),
    row("b", "2026-11-02", "2000", "15000"),
    row("z", "2026-11-01", "13000", "13000"),
  ];

  it("puts each day's newest entry first, its running balances in that order", () => {
    const rows = enteredOrder(api, DEFAULT_SORT);
    expect(rows.map((r) => r.id)).toEqual(["d", "c", "b", "a", "z"]);
    // The day still ends at 9,000 and starts from the day before's 13,000.
    expect(rows.map((r) => r.runningBalance)).toEqual(["8500", "9000", "14000", "12000", "13000"]);
  });

  it("puts the oldest first when dates ascend, and leaves other sorts alone", () => {
    const asc = [...api].reverse();
    expect(enteredOrder(asc, [{ column: "date", dir: "asc" }]).map((r) => r.id)).toEqual([
      "z",
      "a",
      "b",
      "c",
      "d",
    ]);
    const byPayee: SortField[] = [{ column: "payee", dir: "asc" }];
    expect(enteredOrder(api, byPayee)).toBe(api);
    expect(enteredOrder(api, [...DEFAULT_SORT, ...byPayee])).toBe(api);
  });
});
