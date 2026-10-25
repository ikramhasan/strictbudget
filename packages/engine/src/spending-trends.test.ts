import { describe, expect, it } from "vitest";
import {
  averageMonthlySpending,
  comparedToAverage,
  percentTenths,
  rollingAverage,
  topSpenders,
  trendMonths,
} from "./spending-trends";

// In cents: Sep spent $2,905.00 (Uncategorized $2,900.00, Food $5.00) and a refund left "Test"
// $353.00 positive.
const cells = [
  { month: "2026-08", key: "food", net: -300n },
  { month: "2026-09", key: "uncat", net: -290000n },
  { month: "2026-09", key: "food", net: -500n },
  { month: "2026-09", key: "test", net: 35300n },
  { month: "2026-10", key: "uncat", net: -283200n },
  { month: "2026-10", key: "food", net: -76900n },
] as const;
const months = trendMonths([...cells], ["2026-08", "2026-09", "2026-10"]);

describe("spending trends", () => {
  it("totals each month as Spending Breakdown does", () => {
    expect(months.map((m) => m.total)).toEqual([300n, 255200n, 360100n]);
    expect(months[1]).toMatchObject({ spending: 290500n, netInflows: 35300n });
    expect(months[1]?.nets.get("test")).toBe(35300n);
  });

  it("keeps empty months", () => {
    const [m] = trendMonths([...cells], ["2026-07"]);
    expect(m).toMatchObject({ total: 0n, spending: 0n, netInflows: 0n });
  });

  it("averages the range and compares each month with it", () => {
    const average = averageMonthlySpending(months);
    expect(average).toBe(205200n);
    expect(months.map((m) => comparedToAverage(m.total, average))).toEqual([
      { difference: -204900n, percent: "99.9" },
      { difference: 50000n, percent: "24.4" },
      { difference: 154900n, percent: "75.5" },
    ]);
  });

  it("reads a share to one decimal, rounded half away from zero, unsigned", () => {
    expect(percentTenths(290000n, 290500n)).toBe("99.8");
    expect(percentTenths(-1n, 8n)).toBe("12.5");
    expect(percentTenths(1n, 3n)).toBe("33.3");
    expect(percentTenths(0n, 5n)).toBe("0.0");
    expect(percentTenths(5n, 0n)).toBeNull();
  });

  it("averages each value with the ones before it", () => {
    expect(rollingAverage([300n, 100n, 200n, 401n], 3)).toEqual([null, null, 200n, 234n]);
    expect(rollingAverage([1n], 0)).toEqual([null]);
  });

  it("picks the categories that spent the most", () => {
    expect(topSpenders(months, 1)).toEqual(["uncat"]);
    expect(topSpenders(months, 5)).toEqual(["uncat", "food"]);
  });
});
