import { describe, expect, it } from "vitest";
import { addActivity, paceStatus, spendingPace } from "./spending-pace";

const days = (entries: Record<string, bigint>) => new Map(Object.entries(entries));

describe("spending pace", () => {
  it("runs the money down day by day against an even pace", () => {
    // $300.00 in a 30-day month; $100.00 spent by the 10th is exactly on pace.
    const pace = spendingPace({
      month: "2026-11",
      today: "2026-11-10",
      start: 30000n,
      activity: days({ "2026-11-02": -4000n, "2026-11-09": -6000n }),
    });
    expect(pace).toMatchObject({
      days: 30,
      elapsed: 10,
      finished: false,
      spent: 10000n,
      remaining: 20000n,
      status: "on_pace",
      projectedEnd: 0n,
      runOutDate: null,
    });
    expect(pace?.usedPercent).toBeCloseTo(33.33);
    expect(pace?.passedPercent).toBeCloseTo(33.33);
    expect(pace?.points.map((p) => p.remaining).slice(0, 11)).toEqual([
      30000n,
      26000n,
      26000n,
      26000n,
      26000n,
      26000n,
      26000n,
      26000n,
      20000n,
      20000n,
      null,
    ]);
    expect(pace?.points[9]?.ideal).toBe(20000n);
    expect(pace?.points.at(-1)).toMatchObject({ date: "2026-11-30", ideal: 0n, remaining: null });
    // $200.00 over the 21 days left, today included: $9.523… a day, rounded down.
    expect(pace?.safePerDay).toBe(952n);
  });

  it("projects when the money runs out at the pace so far", () => {
    // $200.00 spent of $300.00 by the 10th: $20.00 a day runs out on the 16th.
    const pace = spendingPace({
      month: "2026-11",
      today: "2026-11-10",
      start: 30000n,
      activity: days({ "2026-11-05": -20000n }),
    });
    expect(pace).toMatchObject({ status: "behind", projectedEnd: -30000n });
    expect(pace?.runOutDate).toBe("2026-11-16");
  });

  it("names the day it went below zero once it has", () => {
    const pace = spendingPace({
      month: "2026-11",
      today: "2026-11-10",
      start: 5000n,
      activity: days({ "2026-11-03": -4000n, "2026-11-06": -2000n }),
    });
    expect(pace).toMatchObject({ remaining: -1000n, safePerDay: 0n, runOutDate: "2026-11-06" });
  });

  it("forgets a dip a refund made good", () => {
    const pace = spendingPace({
      month: "2026-11",
      today: "2026-11-10",
      start: 30000n,
      activity: days({ "2026-11-02": -31000n, "2026-11-03": 29000n }),
    });
    // $20.00 net spent: on pace to leave $240.00.
    expect(pace).toMatchObject({ spent: 2000n, runOutDate: null, projectedEnd: 24000n });
  });

  it("counts a refund as money back", () => {
    const pace = spendingPace({
      month: "2026-11",
      today: "2026-11-10",
      start: 30000n,
      activity: days({ "2026-11-02": -5000n, "2026-11-04": 8000n }),
    });
    expect(pace).toMatchObject({ spent: -3000n, remaining: 33000n, status: "ahead" });
    // Net refunds don't project as negative spending.
    expect(pace?.projectedEnd).toBe(33000n);
  });

  it("takes money assigned mid-month into the whole month's line", () => {
    const activity = days({ "2026-11-03": -11000n });
    const before = spendingPace({ month: "2026-11", today: "2026-11-10", start: 20000n, activity });
    const after = spendingPace({ month: "2026-11", today: "2026-11-10", start: 30000n, activity });
    expect(before?.status).toBe("behind");
    expect(after?.status).toBe("on_pace");
    expect(after?.points[2]?.remaining).toBe(19000n);
    expect(after?.safePerDay).toBe(904n);
  });

  it("shrinks with money moved out", () => {
    const pace = spendingPace({
      month: "2026-11",
      today: "2026-11-10",
      start: 30000n - 25000n,
      activity: days({ "2026-11-03": -4000n }),
    });
    expect(pace).toMatchObject({ remaining: 1000n, status: "behind", runOutDate: "2026-11-13" });
  });

  it.each([
    ["2026-02", 28],
    ["2028-02", 29],
    ["2026-09", 30],
    ["2026-10", 31],
  ])("uses every day of %s (%i days)", (month, length) => {
    const pace = spendingPace({ month, today: `${month}-15`, start: 31000n, activity: new Map() });
    expect(pace?.days).toBe(length);
    expect(pace?.points).toHaveLength(length);
    expect(pace?.points.at(-1)?.ideal).toBe(0n);
    expect(pace?.safePerDay).toBe(31000n / BigInt(length - 14));
    expect(pace?.status).toBe("ahead");
  });

  it("rounds the even pace down so it never overstates what's left", () => {
    const pace = spendingPace({
      month: "2026-10",
      today: "2026-10-01",
      start: 1000n,
      activity: new Map(),
    });
    // $10.00 over 31 days: $9.677… left after day 1, shown as $9.67.
    expect(pace?.points[0]?.ideal).toBe(967n);
    expect(pace?.safePerDay).toBe(32n);
  });

  it("shows a past month finished and hides a future one", () => {
    const past = spendingPace({
      month: "2026-09",
      today: "2026-10-18",
      start: 30000n,
      activity: days({ "2026-09-30": -29500n }),
    });
    expect(past).toMatchObject({
      finished: true,
      elapsed: 30,
      remaining: 500n,
      projectedEnd: 500n,
      safePerDay: null,
      status: "on_pace",
    });
    expect(past?.points.every((p) => p.remaining !== null)).toBe(true);
    expect(
      spendingPace({ month: "2026-11", today: "2026-10-18", start: 1n, activity: new Map() }),
    ).toBeNull();
  });

  it("has no status with nothing to spend and nothing spent", () => {
    expect(paceStatus(0n, 0n, 5, 30)).toBeNull();
    expect(paceStatus(0n, 100n, 5, 30)).toBe("behind");
    // One day's share either way is on pace: $10.00 a day, 5 days in.
    expect(paceStatus(30000n, 6000n, 5, 30)).toBe("on_pace");
    expect(paceStatus(30000n, 3999n, 5, 30)).toBe("ahead");
    expect(paceStatus(30000n, 6001n, 5, 30)).toBe("behind");
  });

  it("adds categories' days together", () => {
    const sum = addActivity([days({ a: -1n, b: -2n }), days({ b: -3n })]);
    expect([...sum]).toEqual([
      ["a", -1n],
      ["b", -5n],
    ]);
  });
});
