import { describe, expect, it } from "vitest";
import { barLabel, barParts } from "./progress-bar";

describe("barLabel", () => {
  it("says what the bar's colours show", () => {
    expect(
      barLabel({
        tone: "underfunded",
        sections: [
          {
            kind: "target",
            size: "1000",
            segments: [
              { kind: "spent", amount: "250" },
              { kind: "available", amount: "500" },
            ],
          },
        ],
      } as never),
    ).toBe("Progress: Needs more, 25% spent, 50% available");
    expect(
      barLabel({
        tone: "funded",
        sections: [
          { kind: "target", size: "100", segments: [{ kind: "overspent", amount: "100" }] },
        ],
      } as never),
    ).toBe("Progress: On track, 100% overspent");
  });
});

describe("barParts", () => {
  it("names money carried over from last month apart from this month", () => {
    expect(
      barParts({
        tone: "funded",
        sections: [
          { kind: "rollover", size: "300", segments: [{ kind: "spent", amount: "300" }] },
          {
            kind: "target",
            size: "1000",
            segments: [
              { kind: "spent", amount: "100" },
              { kind: "available", amount: "900" },
            ],
          },
        ],
      } as never),
    ).toEqual([
      {
        label: "From last month",
        size: 300n,
        segments: { spent: 300n, available: 0n, overspent: 0n },
      },
      {
        label: "This month",
        size: 1000n,
        segments: { spent: 100n, available: 900n, overspent: 0n },
      },
    ]);
  });

  it("numbers a weekly target's weeks and names what goes beyond them", () => {
    const parts = barParts({
      tone: "underfunded",
      sections: [
        { kind: "target", size: "100", segments: [] },
        { kind: "target", size: "100", segments: [] },
        { kind: "extra", size: "50", segments: [{ kind: "overspent", amount: "50" }] },
      ],
    } as never);
    expect(parts.map((p) => p.label)).toEqual(["Week 1", "Week 2", "Beyond the weeks"]);
  });
});
