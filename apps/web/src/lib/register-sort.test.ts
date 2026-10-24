import { describe, expect, it } from "vitest";
import { DEFAULT_SORT, formatSort, nextSort, readSort, type SortField } from "./register-sort";

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
