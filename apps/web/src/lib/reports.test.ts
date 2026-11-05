import { describe, expect, it } from "vitest";
import {
  chartNumber,
  chartTick,
  distinctColors,
  monthLabel,
  OTHER_COLOR,
  REPORT_COLORS,
  rangeLabel,
  reportFilters,
  reportInk,
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

describe("distinctColors", () => {
  it("gives each series the colour of its place in the plan", () => {
    const colors = distinctColors([
      { key: "rent", slot: 2 },
      { key: "dining", slot: 0 },
      { key: "phone", slot: 4 },
    ]);
    expect([...colors.values()]).toEqual(["var(--report-3)", "var(--report-1)", "var(--report-5)"]);
    // The same series keeps its colour whatever else the chart shows.
    expect(distinctColors([{ key: "phone", slot: 4 }]).get("phone")).toBe("var(--report-5)");
  });

  it("on a clash, the series earlier in the plan keeps the colour, the other takes the next free", () => {
    const colors = distinctColors([
      { key: "x", slot: 8 },
      { key: "y", slot: 0 },
      { key: "z", slot: 1 },
    ]);
    expect(colors.get("y")).toBe("var(--report-1)");
    expect(colors.get("z")).toBe("var(--report-2)");
    expect(colors.get("x")).toBe("var(--report-3)");
  });

  it("colours series with no place in the plan by their key, whatever the order", () => {
    const one = distinctColors([{ key: "p1" }, { key: "p2" }, { key: "p3" }]);
    const two = distinctColors([{ key: "p3" }, { key: "p1" }, { key: "p2" }]);
    expect(new Set(one.values()).size).toBe(3);
    for (const [key, color] of one) expect(two.get(key)).toBe(color);
  });

  it("keeps own colours without spending a palette colour on them", () => {
    const colors = distinctColors([
      { key: "a", slot: 0 },
      { key: "uncat", color: UNCATEGORIZED_COLOR },
      { key: "b", slot: 1 },
    ]);
    expect(colors.get("uncat")).toBe(UNCATEGORIZED_COLOR);
    expect(colors.get("b")).toBe("var(--report-2)");
  });

  it("never repeats a colour, folding series past the palette or `max` into Other", () => {
    const series = Array.from({ length: REPORT_COLORS + 2 }, (_, i) => ({ key: `c${i}`, slot: i }));
    const colors = distinctColors(series);
    const named = series.slice(0, REPORT_COLORS).map((s) => colors.get(s.key));
    expect(new Set(named).size).toBe(REPORT_COLORS);
    expect(colors.get(`c${REPORT_COLORS}`)).toBe(OTHER_COLOR);
    expect(colors.get(`c${REPORT_COLORS + 1}`)).toBe(OTHER_COLOR);
    expect([...distinctColors(series.slice(0, 3), 2).values()]).toEqual([
      "var(--report-1)",
      "var(--report-2)",
      OTHER_COLOR,
    ]);
  });

  it("picks label ink that reads on each colour", () => {
    expect(reportInk("var(--report-4)")).toBe("var(--report-ink)");
    expect(reportInk(OTHER_COLOR)).toBe("var(--report-ink)");
    expect(reportInk(UNCATEGORIZED_COLOR)).toBe("var(--report-uncategorized-ink)");
  });
});

describe("report labels", () => {
  it("writes months as the reports do", () => {
    expect(monthLabel("2026-10")).toBe("Oct 2026");
    expect(monthLabel("2026-10", "long")).toBe("October 2026");
    expect(monthLabel("2026-08", "axis")).toBe("Aug");
    expect(monthLabel("2027-01", "axis")).toBe("Jan ’27");
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
