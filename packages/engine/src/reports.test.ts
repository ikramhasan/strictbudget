import { describe, expect, it } from "vitest";
import {
  averageOf,
  changeOf,
  comparisonRange,
  exportDelimiter,
  foldTail,
  monthsIn,
  percentOf,
  plainAmount,
  presetOf,
  presetRange,
  shareLabel,
  splitSpending,
  toDelimited,
} from "./reports";

describe("presetRange", () => {
  it("counts back from the current month", () => {
    expect(presetRange("this_month", "2026-10")).toEqual({ from: "2026-10", to: "2026-10" });
    expect(presetRange("last_3_months", "2026-10")).toEqual({ from: "2026-08", to: "2026-10" });
    expect(presetRange("last_6_months", "2026-02")).toEqual({ from: "2025-09", to: "2026-02" });
    expect(presetRange("last_12_months", "2026-10")).toEqual({ from: "2025-11", to: "2026-10" });
    expect(presetRange("year_to_date", "2026-10")).toEqual({ from: "2026-01", to: "2026-10" });
    expect(presetRange("last_year", "2026-10")).toEqual({ from: "2025-01", to: "2025-12" });
  });

  it("starts all dates at the first month with a transaction", () => {
    expect(presetRange("all_dates", "2026-10", "2024-03")).toEqual({
      from: "2024-03",
      to: "2026-10",
    });
    expect(presetRange("all_dates", "2026-10", null)).toEqual({ from: "2026-10", to: "2026-10" });
  });

  it("finds the preset a range matches", () => {
    expect(presetOf({ from: "2026-08", to: "2026-10" }, "2026-10")).toBe("last_3_months");
    expect(presetOf({ from: "2026-07", to: "2026-09" }, "2026-10")).toBeUndefined();
  });
});

describe("comparisonRange", () => {
  const range = { from: "2026-08", to: "2026-10" };

  it("takes the previous period of the same length", () => {
    expect(comparisonRange(range, "previous_period")).toEqual({
      from: "2026-05",
      to: "2026-07",
      average: false,
    });
  });

  it("takes the same months a year earlier", () => {
    expect(comparisonRange(range, "last_year")).toEqual({
      from: "2025-08",
      to: "2025-10",
      average: false,
    });
  });

  it("averages the N months before the range", () => {
    expect(comparisonRange(range, "average_6")).toEqual({
      from: "2026-02",
      to: "2026-07",
      average: true,
    });
  });

  it("lists a range's months", () => {
    expect(monthsIn({ from: "2025-11", to: "2026-02" })).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });
});

describe("averages and percentages", () => {
  it("rounds averages half away from zero to the minor unit", () => {
    // −$5,732.00 / 3 = −$1,910.67.
    expect(averageOf(-573200n, 3)).toBe(-191067n);
    expect(averageOf(5n, 2)).toBe(3n);
    expect(averageOf(-5n, 2)).toBe(-3n);
    // Average Daily Spending: $3,601.00 / 31 days = $116.16.
    expect(averageOf(360100n, 31)).toBe(11616n);
    expect(averageOf(100n, 0)).toBe(0n);
  });

  it("labels shares of gross outflows", () => {
    expect(shareLabel(283200n, 365300n)).toBe("78%");
    expect(shareLabel(13000n, 365300n)).toBe("4%");
    expect(shareLabel(3000n, 365300n)).toBe("<1%");
    expect(shareLabel(0n, 365300n)).toBe("");
  });

  it("measures changes against the previous amount's size", () => {
    const change = changeOf(-32265374n, -30668700n);
    expect(change.amount).toBe(-1596674n);
    expect(change.percent?.toFixed(1)).toBe("-5.2");
    expect(changeOf(500n, 0n).percent).toBeNull();
    expect(percentOf(154900n, 205200n)?.toFixed(1)).toBe("75.5");
  });
});

describe("splitSpending", () => {
  it("subtracts positive inflow categories from total spending", () => {
    const split = splitSpending([
      { key: "uncategorized", net: -283200n },
      { key: "O13", net: -13000n },
      { key: "R4", net: 0n },
      { key: "T8 D", net: 2000n },
      { key: "Vacation", net: 200n },
    ]);
    expect(split.spending.map((r) => r.key)).toEqual(["uncategorized", "O13", "R4"]);
    expect(split.positive.map((r) => r.key)).toEqual(["Vacation", "T8 D"]);
    expect(split.grossOutflows).toBe(296200n);
    expect(split.positiveInflows).toBe(2200n);
    expect(split.total).toBe(294000n);
  });
});

describe("export text", () => {
  it("writes the CSV shape", () => {
    const text = toDelimited(
      [
        ["Category Group", "Category", "Oct 2026"],
        ["", "Uncategorized", { raw: "-2832.00" }],
        ['Say "hi"', "A,B", { raw: "2.00" }],
      ],
      ",",
    );
    expect(text).toBe(
      '\uFEFF"Category Group","Category","Oct 2026"\n"","Uncategorized",-2832.00\n"Say ""hi""","A,B",2.00',
    );
  });

  it("uses TSV and the comma mark for comma-decimal formats", () => {
    expect(exportDelimiter("comma_dot")).toBe(",");
    expect(exportDelimiter("dot_comma")).toBe("\t");
    expect(plainAmount(-13000n, 2, "comma_dot")).toBe("-130.00");
    expect(plainAmount(5n, 2, "dot_comma")).toBe("0,05");
    expect(plainAmount(-1234n, 0, "comma_dot")).toBe("-1234");
    expect(plainAmount(12345n, 3, "comma_dot")).toBe("12.345");
  });
});

describe("foldTail", () => {
  const size = (n: number) => BigInt(n);
  it("keeps the largest, largest first, and folds the rest", () => {
    expect(foldTail([3, 9, 1, 7, 5, 2, 8], 3, size)).toEqual({
      top: [9, 8, 7],
      rest: [5, 3, 2, 1],
    });
  });

  it("keeps ties in their order", () => {
    const items = [
      { id: "a", n: 5 },
      { id: "b", n: 5 },
      { id: "c", n: 1 },
    ];
    expect(foldTail(items, 1, (i) => BigInt(i.n)).top.map((i) => i.id)).toEqual(["a"]);
  });

  it("doesn't fold a single item into Other", () => {
    expect(foldTail([1, 2, 3], 2, size)).toEqual({ top: [3, 2, 1], rest: [] });
    expect(foldTail([], 5, size)).toEqual({ top: [], rest: [] });
  });
});
