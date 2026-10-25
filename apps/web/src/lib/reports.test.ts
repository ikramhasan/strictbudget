import { describe, expect, it } from "vitest";
import {
  chartNumber,
  chartTick,
  monthLabel,
  planColors,
  rangeLabel,
  reportFilters,
  reportSearchSchema,
  resolveRange,
  splitIds,
  UNCATEGORIZED_COLOR,
} from "./reports";

describe("report search", () => {
  it("drops values it can't read", () => {
    expect(
      reportSearchSchema.parse({ range: "forever", from: "2026-13", compare: "x", view: "pie" }),
    ).toEqual({});
  });

  it("uses a custom range when both ends are set and in order", () => {
    expect(resolveRange({ from: "2026-02", to: "2026-04" }, "this_month", null, "2026-10")).toEqual(
      { range: { from: "2026-02", to: "2026-04" }, preset: undefined },
    );
    // A custom range that matches a preset reads as it.
    expect(resolveRange({ from: "2026-08", to: "2026-10" }, "this_month", null, "2026-10")).toEqual(
      { range: { from: "2026-08", to: "2026-10" }, preset: "last_3_months" },
    );
  });

  it("falls back to the asked preset, then the report's default", () => {
    expect(resolveRange({ range: "last_year" }, "this_month", null, "2026-10").range).toEqual({
      from: "2025-01",
      to: "2025-12",
    });
    expect(resolveRange({ from: "2026-05", to: "2026-04" }, "this_month", null, "2026-10")).toEqual(
      { range: { from: "2026-10", to: "2026-10" }, preset: "this_month" },
    );
    expect(
      resolveRange({ range: "all_dates" }, "this_month", "2024-03", "2026-10").range.from,
    ).toBe("2024-03");
  });

  it("turns the URL's selections into API filters, keeping an empty selection", () => {
    expect(reportFilters({ categories: "a,b", flags: "" })).toEqual({
      categoryIds: "a,b",
      flags: "",
    });
    expect(splitIds(undefined)).toBeUndefined();
    expect(splitIds("")).toEqual([]);
    expect(splitIds("a,b")).toEqual(["a", "b"]);
  });
});

describe("planColors", () => {
  it("gives each category and group one colour, Uncategorized grey", () => {
    const colors = planColors({
      uncategorizedCategoryId: "u",
      groups: [
        { id: "g1", categories: [{ id: "a" }, { id: "b" }] },
        { id: "g2", categories: [{ id: "c" }] },
      ],
    });
    expect(colors.categories.get("u")).toBe(UNCATEGORIZED_COLOR);
    expect([...colors.categories.values()].slice(1)).toEqual([
      "var(--report-1)",
      "var(--report-2)",
      "var(--report-3)",
    ]);
    expect(colors.groups.get("g2")).toBe("var(--report-2)");
  });
});

describe("report labels", () => {
  it("writes months as the reports do", () => {
    expect(monthLabel("2026-10")).toBe("Oct 2026");
    expect(monthLabel("2026-10", "long")).toBe("October 2026");
    expect(monthLabel("2026-08", "axis")).toBe("08/26");
    expect(rangeLabel({ from: "2026-08", to: "2026-10" })).toBe("Aug 2026 – Oct 2026");
    expect(rangeLabel({ from: "2026-10", to: "2026-10" })).toBe("Oct 2026");
  });

  it("labels axis ticks to the minor unit, without decimals when whole", () => {
    const format = (m: bigint) => `$${(Number(m) / 100).toFixed(2)}`;
    expect([0, 0.5, 1, 1.5].map((t) => chartTick(t, "USD", format, "."))).toEqual([
      "$0",
      "$0.50",
      "$1",
      "$1.50",
    ]);
    expect(chartTick(1000, "USD", format, ".")).toBe("$1000");
  });

  it("converts amounts to numbers only for chart positions", () => {
    expect(chartNumber("-283200", "USD")).toBe(-2832);
    expect(chartNumber(1234n, "JPY")).toBe(1234);
    expect(chartNumber("12345", "BHD")).toBe(12.345);
  });
});
