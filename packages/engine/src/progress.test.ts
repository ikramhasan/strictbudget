import { describe, expect, it } from "vitest";
import { type ProgressBar, progressBar } from "./progress";
import type { CategoryTarget, TargetNeed } from "./targets";

/** Each section's share of the bar and its segments' shares, in percent. */
function drawn(bar: ProgressBar) {
  const total = bar.sections.reduce((sum, s) => sum + s.size, 0n);
  const pct = (part: bigint, whole: bigint) =>
    whole === 0n ? 0 : Math.round(Number((part * 1000n) / whole)) / 10;
  return bar.sections.map(
    (s) =>
      `${s.kind === "target" ? "" : `${s.kind} `}${pct(s.size, total)}[${s.segments
        .map((g) => `${g.kind} ${pct(g.amount, s.size)}`)
        .join(", ")}]`,
  );
}

const fig = (carried: bigint, assigned: bigint, activity = 0n) => ({ carried, assigned, activity });
const target = (
  behavior: CategoryTarget["behavior"],
  cadence: CategoryTarget["cadence"] = "monthly",
  amount = 100_00n,
) => ({ behavior, cadence, amount, dueDay: cadence === "weekly" ? 6 : null });
const need = (needed: bigint, funded: bigint, underfunded: bigint): TargetNeed => ({
  needed,
  funded,
  underfunded,
  monthAmount: needed,
  overfunded: 0n,
  dueDate: null,
});
const bar = (
  f: ReturnType<typeof fig>,
  t: ReturnType<typeof target> | null,
  n: TargetNeed | null,
  snoozed = false,
) => progressBar(f, t, n, snoozed, "2026-10");

describe("progressBar", () => {
  it("draws money and spending over the month without a target", () => {
    expect(drawn(bar(fig(0n, 20_00n, -7_00n), null, null))).toEqual([
      "100[spent 35, available 65]",
    ]);
    expect(drawn(bar(fig(0n, 5_00n, -8_00n), null, null))).toEqual([
      "100[spent 62.5, overspent 37.5]",
    ]);
    expect(drawn(bar(fig(0n, 0n, -4_00n), null, null))).toEqual(["100[overspent 100]"]);
    expect(drawn(bar(fig(0n, 10_00n, -10_00n), null, null))).toEqual(["100[spent 100]"]);
    // An inflow that wasn't assigned isn't drawn, nor is anything with no money.
    expect(drawn(bar(fig(0n, 0n, 2_00n), null, null))).toEqual(["0[]"]);
    expect(bar(fig(0n, 5_00n, 2_00n), null, null).tone).toBe("funded");
  });

  it("measures a monthly target against what it needs", () => {
    const refill = target("refill");
    // $70.00 carried, $20.00 spent, $30.00 to go.
    const h = bar(fig(70_00n, 0n, -20_00n), refill, need(100_00n, 70_00n, 30_00n));
    expect(h.tone).toBe("underfunded");
    expect(drawn(h)).toEqual(["100[spent 20, available 50]"]);
    // A refund isn't drawn, only what counts ($40.00 assigned).
    expect(drawn(bar(fig(0n, 40_00n, 20_00n), refill, need(100_00n, 40_00n, 60_00n)))).toEqual([
      "100[available 40]",
    ]);
    // Nothing in, $30.00 spent: the overspending fills the empty bar.
    expect(drawn(bar(fig(0n, 0n, -30_00n), refill, need(100_00n, 0n, 100_00n)))).toEqual([
      "100[overspent 30]",
    ]);
  });

  it("grows the bar to the money or spending beyond the target", () => {
    const setAside = target("set_aside");
    expect(drawn(bar(fig(0n, 150_00n), setAside, need(100_00n, 150_00n, 0n)))).toEqual([
      "100[available 100]",
    ]);
    expect(drawn(bar(fig(0n, 150_00n, -120_00n), setAside, need(100_00n, 150_00n, 0n)))).toEqual([
      "100[spent 80, available 20]",
    ]);
    expect(drawn(bar(fig(0n, 100_00n, -130_00n), setAside, need(100_00n, 100_00n, 0n)))).toEqual([
      "100[spent 76.9, overspent 23]",
    ]);
  });

  it("puts money carried into a set aside target first, and spends it first", () => {
    const setAside = target("set_aside");
    expect(drawn(bar(fig(150_00n, 50_00n), setAside, need(100_00n, 50_00n, 50_00n)))).toEqual([
      "rollover 60[available 100]",
      "40[available 50]",
    ]);
    expect(
      drawn(bar(fig(80_00n, 30_00n, -50_00n), setAside, need(100_00n, 30_00n, 70_00n))),
    ).toEqual(["rollover 44.4[spent 62.5, available 37.5]", "55.5[available 30]"]);
  });

  it("draws a weekly target week by week", () => {
    // $10.00 on Saturdays (five in October), $25.00 assigned.
    const weekly = target("set_aside", "weekly", 10_00n);
    expect(drawn(bar(fig(0n, 25_00n), weekly, need(50_00n, 25_00n, 25_00n)))).toEqual([
      "20[available 100]",
      "20[available 100]",
      "20[available 50]",
      "20[]",
      "20[]",
    ]);
    // $70.00 assigned: an extra section for the $20.00 beyond the five weeks.
    expect(drawn(bar(fig(0n, 70_00n), weekly, need(50_00n, 70_00n, 0n)))).toEqual([
      "14.2[available 100]",
      "14.2[available 100]",
      "14.2[available 100]",
      "14.2[available 100]",
      "14.2[available 100]",
      "extra 28.5[available 100]",
    ]);
    const refill = target("refill", "weekly", 10_00n);
    expect(drawn(bar(fig(0n, 30_00n, -15_00n), refill, need(50_00n, 30_00n, 20_00n)))).toEqual([
      "20[spent 100]",
      "20[spent 50, available 50]",
      "20[available 100]",
      "20[]",
      "20[]",
    ]);
  });

  it("measures a dated target against its total", () => {
    const yearly = target("refill", "yearly", 1000_00n);
    expect(drawn(bar(fig(70_00n, 0n), yearly, need(1000_00n, 70_00n, 465_00n)))).toEqual([
      "100[available 7]",
    ]);
  });

  it("draws a snoozed target as the month, in green", () => {
    const setAside = target("set_aside");
    const e = bar(fig(70_00n, 0n), setAside, need(100_00n, 0n, 100_00n), true);
    expect(e.tone).toBe("funded");
    expect(drawn(e)).toEqual(["100[available 100]"]);
    // Nothing in, $30.00 spent, snoozed: all red.
    expect(drawn(bar(fig(0n, 0n, -30_00n), setAside, need(100_00n, 0n, 100_00n), true))).toEqual([
      "100[overspent 100]",
    ]);
  });
});

// $10 on Saturdays from Monday the 12th: three weeks.
describe("progressBar for a weekly target that starts mid-month", () => {
  it("draws only the weeks it asks for", () => {
    const weekly = {
      ...target("set_aside", "weekly", 10_00n),
      startMonth: "2026-10",
      startDay: 12,
    };
    expect(
      drawn(progressBar(fig(0n, 0n), weekly, need(30_00n, 0n, 30_00n), false, "2026-10")),
    ).toEqual(["33.3[]", "33.3[]", "33.3[]"]);
  });
});

describe("progressBar for a dated set aside with money left from its last period", () => {
  it("draws the rollover first, then the period", () => {
    const dated = { ...target("set_aside", "custom", 60_00n), dueDay: null };
    expect(
      drawn(
        progressBar(fig(80_00n, 0n), dated, need(60_00n, 0n, 30_00n), false, "2026-10", 80_00n),
      ),
    ).toEqual(["rollover 57.1[available 100]", "42.8[]"]);
    expect(
      drawn(
        progressBar(fig(110_00n, 0n), dated, need(60_00n, 30_00n, 0n), false, "2026-11", 80_00n),
      ),
    ).toEqual(["rollover 57.1[available 100]", "42.8[available 50]"]);
  });
});

describe("progressBar for a save-up goal", () => {
  it("fills with everything put in, with what was spent on it eaten from the front", () => {
    const saveUp = { ...target("set_aside"), goal: "save_up" as const };
    // $3,000 goal: $1,000 carried in, $250 assigned, $500 spent.
    const b = bar(fig(1_000_00n, 250_00n, -500_00n), saveUp, need(3_000_00n, 1_250_00n, 0n));
    expect(drawn(b)).toEqual(["100[spent 16.6, available 25]"]);
    expect(b.tone).toBe("funded");
  });
});
