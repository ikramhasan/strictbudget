import { describe, expect, it } from "vitest";
import type { CategoryHistory } from "@/lib/category-history";
import { emptyHistory, historyRange, stableMax } from "./category-history-panel";

describe("the inspector's history range", () => {
  it("writes the months the chart shows one way, whichever month is inspected", () => {
    expect(historyRange({ from: "2025-12", to: "2026-11" })).toBe("Dec 2025 – Nov 2026");
    expect(historyRange({ from: "2026-09", to: "2026-11" })).toBe("Sep – Nov 2026");
    expect(historyRange({ from: "2026-09", to: "2026-10" })).toBe("Sep – Oct 2026");
    expect(historyRange({ from: "2026-11", to: "2026-11" })).toBe("Nov 2026");
  });
});

describe("the inspector chart's value axis", () => {
  it("starts above the tallest bar, at a round number", () => {
    expect(stableMax(undefined, 200)).toBe(250);
    expect(stableMax(undefined, 215)).toBe(300);
    expect(stableMax(undefined, 1400)).toBe(2000);
    expect(stableMax(undefined, 0)).toBe(1);
  });

  it("holds while amounts change under it, so a raised amount's bar grows", () => {
    const top = stableMax(undefined, 200);
    expect(stableMax(top, 215)).toBe(top);
    expect(stableMax(top, 50)).toBe(top);
    // Outgrown, it moves up.
    expect(stableMax(top, 400)).toBe(500);
    expect(stableMax(top, 420)).toBe(600);
  });
});

describe("an empty history", () => {
  const month = (assigned: string, activity: string) =>
    ({ assigned, activity }) as CategoryHistory["months"][number];
  it("is one with nothing assigned or spent in any month", () => {
    expect(emptyHistory({ months: [month("0", "0"), month("0", "0")] } as CategoryHistory)).toBe(
      true,
    );
    expect(emptyHistory({ months: [month("0", "0"), month("100", "0")] } as CategoryHistory)).toBe(
      false,
    );
    expect(emptyHistory({ months: [month("0", "-50")] } as CategoryHistory)).toBe(false);
  });
});
