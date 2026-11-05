import { describe, expect, it } from "vitest";
import {
  chartNumber,
  chartTick,
  distinctColors,
  monthLabel,
  OTHER_COLOR,
  planHues,
  REPORT_HUES,
  REPORT_TINTS,
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

describe("planHues", () => {
  it("gives each group its place in the plan and its categories the group's hue", () => {
    const hues = planHues({
      groups: [
        { id: "g1", categories: [{ id: "a" }, { id: "b" }] },
        { id: "g2", categories: [{ id: "c" }] },
      ],
    });
    expect([...hues.categories]).toEqual([
      ["a", { hue: 0, family: "g1" }],
      ["b", { hue: 0, family: "g1" }],
      ["c", { hue: 4, family: "g2" }],
    ]);
    expect(hues.groups.get("g2")).toBe(4);
  });
});

describe("distinctColors", () => {
  it("gives a family one hue and its series the hue's tints, biggest strongest", () => {
    const colors = distinctColors([
      { key: "rent", family: "bills", hue: 1 },
      { key: "dining", family: "wants", hue: 2 },
      { key: "phone", family: "bills", hue: 1 },
    ]);
    expect(colors.get("rent")).toBe("var(--report-2-1)");
    expect(colors.get("phone")).toBe("var(--report-2-2)");
    expect(colors.get("dining")).toBe("var(--report-3-1)");
  });

  it("never repeats a colour within a chart", () => {
    // Two families wanting the same hue (a plan past seven groups): the bigger keeps it.
    const colors = distinctColors([
      { key: "rent", hue: 1 },
      { key: "dining", hue: 1 },
      { key: "phone", hue: 0 },
    ]);
    expect(colors.get("rent")).toBe("var(--report-2-1)");
    expect(colors.get("dining")).toBe("var(--report-1-1)");
    expect(colors.get("phone")).toBe("var(--report-3-1)");
    expect(new Set(colors.values()).size).toBe(3);
  });

  it("keeps fixed colours and gives series past the palette the Other colour", () => {
    const series = [
      { key: "uncat", color: UNCATEGORIZED_COLOR },
      ...Array.from({ length: REPORT_HUES + 2 }, (_, i) => ({ key: `c${i}`, hue: i % 3 })),
    ];
    const colors = distinctColors(series);
    expect(colors.get("uncat")).toBe(UNCATEGORIZED_COLOR);
    const hued = series.slice(1, REPORT_HUES + 1).map((s) => colors.get(s.key));
    expect(new Set(hued).size).toBe(REPORT_HUES);
    expect(colors.get(`c${REPORT_HUES}`)).toBe(OTHER_COLOR);
    expect(colors.get(`c${REPORT_HUES + 1}`)).toBe(OTHER_COLOR);
  });

  it("folds a family past its tints, and series past `max`, into Other", () => {
    const one = Array.from({ length: REPORT_TINTS + 1 }, (_, i) => ({
      key: `c${i}`,
      family: "g",
      hue: 0,
    }));
    expect(distinctColors(one).get(`c${REPORT_TINTS}`)).toBe(OTHER_COLOR);
    const capped = distinctColors(one, 2);
    expect([...capped.values()]).toEqual([
      "var(--report-1-1)",
      "var(--report-1-2)",
      ...Array(REPORT_TINTS - 1).fill(OTHER_COLOR),
    ]);
  });

  it("doesn't hand out a hue a series owns", () => {
    const colors = distinctColors([
      { key: "a", hue: 0 },
      { key: "own", color: "var(--report-2)" },
      { key: "b", hue: 1 },
    ]);
    expect(colors.get("b")).toBe("var(--report-3-1)");
  });

  it("picks label ink that reads on each colour", () => {
    expect(reportInk("var(--report-4-1)")).toBe("var(--report-ink-strong)");
    expect(reportInk("var(--report-4-5)")).toBe("var(--report-ink-soft)");
    expect(reportInk(UNCATEGORIZED_COLOR)).toBe("var(--report-ink-strong)");
    expect(reportInk(OTHER_COLOR)).toBe("var(--report-ink-soft)");
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
