import { describe, expect, it } from "vitest";
import { type PaceSummary, paceCallout } from "./spending-pace";

const summary = (over: Partial<PaceSummary>): PaceSummary => ({
  start: "30000",
  spent: "10000",
  remaining: "20000",
  usedPercent: 33.33,
  status: "on_pace",
  safePerDay: "952",
  projectedEnd: "0",
  runOutDate: null,
  ...over,
});
const format = (minorUnits: bigint) => `$${(Number(minorUnits) / 100).toFixed(2)}`;

describe("paceCallout", () => {
  it("names the day the money runs out at this pace", () => {
    const line = summary({ status: "behind", runOutDate: "2026-11-22", projectedEnd: "-5000" });
    expect(paceCallout(line, false, format)).toBe("At this pace you'll run out on Nov 22.");
  });

  it("says when it already ran out", () => {
    const line = summary({ status: "behind", remaining: "-1000", runOutDate: "2026-11-06" });
    expect(paceCallout(line, false, format)).toBe("Ran out on Nov 6: $10.00 over.");
  });

  it("says what's left at month end on pace or ahead", () => {
    expect(paceCallout(summary({ projectedEnd: "8500" }), false, format)).toBe(
      "On pace, about $85.00 left at month end.",
    );
    expect(paceCallout(summary({ status: "ahead", projectedEnd: "9000" }), false, format)).toBe(
      "Ahead of pace, about $90.00 left at month end.",
    );
  });

  it("sums up a finished month", () => {
    expect(paceCallout(summary({ remaining: "500" }), true, format)).toBe(
      "Finished with $5.00 left.",
    );
    expect(paceCallout(summary({ remaining: "-500", status: "behind" }), true, format)).toBe(
      "Overspent by $5.00.",
    );
  });

  it("has nothing to say with nothing to spend", () => {
    expect(paceCallout(summary({ status: null }), false, format)).toBe(
      "Nothing to spend this month.",
    );
  });
});
