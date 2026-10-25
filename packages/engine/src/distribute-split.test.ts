import { describe, expect, it } from "vitest";
import { distributeSplit } from "./distribute-split";

/** The lines after Auto-Distribute (cents). */
function after(total: bigint, lines: bigint[]) {
  const remaining = total - lines.reduce((a, b) => a + b, 0n);
  const added = distributeSplit(remaining, lines);
  return added && lines.map((line, i) => line + (added[i] ?? 0n));
}

describe("distributeSplit", () => {
  it("spreads what's unassigned in proportion to the lines", () => {
    expect(after(-1000n, [-300n, -400n])).toEqual([-429n, -571n]);
    expect(after(-1000n, [-100n, -100n, -100n])).toEqual([-334n, -333n, -333n]);
  });

  it("rounds every line but the first half up, and the first takes the rest", () => {
    expect(after(-8n, [-1n, -1n, -3n])).toEqual([-1n, -2n, -5n]);
    expect(after(-8n, [-3n, -1n, -1n])).toEqual([-4n, -2n, -2n]);
    expect(after(-3n, [-1n, -1n])).toEqual([-2n, -1n]);
    expect(after(-5n, [-1n, -1n])).toEqual([-3n, -2n]);
    expect(after(-7n, [-1n, -1n])).toEqual([-4n, -3n]);
    expect(after(5n, [1n, 1n])).toEqual([2n, 3n]);
    expect(after(7n, [1n, 1n])).toEqual([3n, 4n]);
  });

  it("skips lines at zero, and spreads evenly when they're all zero", () => {
    expect(after(-3n, [-1n, -1n, 0n])).toEqual([-2n, -1n, 0n]);
    expect(after(10n, [0n, 0n, 0n])).toEqual([4n, 3n, 3n]);
  });

  it("takes money back off the lines when they're over the total", () => {
    expect(after(-600n, [-300n, -400n])).toEqual([-257n, -343n]);
  });

  it("has no proportion to follow when the lines cancel out", () => {
    expect(distributeSplit(500n, [100n, -100n])).toBeNull();
    expect(distributeSplit(500n, [])).toBeNull();
  });
});
