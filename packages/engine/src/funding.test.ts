import { describe, expect, it } from "vitest";
import {
  afterStart,
  FUNDING_STEPS,
  fundUnderfunded,
  paymentFunding,
  spendingFunding,
} from "./funding";
import type { TargetNeed } from "./targets";

const need = (underfunded: bigint, extra: Partial<TargetNeed> = {}): TargetNeed => ({
  needed: 100_00n,
  funded: 100_00n - underfunded,
  underfunded,
  monthAmount: 100_00n,
  overfunded: 0n,
  dueDate: null,
  ...extra,
});
const monthly = { cadence: "monthly" as const, dueDay: null };

describe("spendingFunding", () => {
  it("meets the target or covers overspending, whichever is more", () => {
    expect(spendingFunding("2026-10", -30_00n, monthly, need(100_00n)).underfunded).toBe(100_00n);
    expect(spendingFunding("2026-10", -30_00n, monthly, need(0n)).underfunded).toBe(30_00n);
    expect(spendingFunding("2026-10", -4_00n, null, null)).toEqual({
      underfunded: 4_00n,
      overfunded: 0n,
      parts: [{ amount: 4_00n, step: FUNDING_STEPS.overspent, date: "" }],
    });
    expect(spendingFunding("2026-10", 13_00n, null, null).underfunded).toBe(0n);
  });

  it("places a target's shortfall by its due date", () => {
    expect(spendingFunding("2026-10", 0n, monthly, need(60_00n)).parts).toEqual([
      // End of month is due on the month's last day.
      { amount: 60_00n, step: FUNDING_STEPS.dueThisMonth, date: "2026-10-31" },
    ]);
    expect(
      spendingFunding("2026-11", 0n, { cadence: "monthly", dueDay: 31 }, need(60_00n)).parts,
    ).toEqual([{ amount: 60_00n, step: FUNDING_STEPS.dueThisMonth, date: "2026-11-30" }]);
    // A debt payment target is due like a monthly one.
    expect(
      spendingFunding("2026-10", 0n, { cadence: "debt_monthly", dueDay: null }, need(60_00n)).parts,
    ).toEqual([{ amount: 60_00n, step: FUNDING_STEPS.dueThisMonth, date: "2026-10-31" }]);
    const dated = need(150_00n, { dueDate: "2026-11-30" });
    expect(
      spendingFunding("2026-10", 0n, { cadence: "custom", dueDay: null }, dated).parts,
    ).toEqual([{ amount: 150_00n, step: FUNDING_STEPS.dueLater, date: "2026-11-30" }]);
    expect(
      spendingFunding("2026-11", 0n, { cadence: "custom", dueDay: null }, dated).parts[0]?.step,
    ).toBe(FUNDING_STEPS.dueThisMonth);
  });

  it("splits a weekly shortfall into its occurrences, earliest funded first", () => {
    // $10 on Saturdays: five in October 2026; $15 assigned covers the 3rd and half the 10th.
    const weekly = need(35_00n, { needed: 50_00n });
    expect(
      spendingFunding("2026-10", 15_00n, { cadence: "weekly", dueDay: 6 }, weekly).parts,
    ).toEqual([
      { amount: 5_00n, step: FUNDING_STEPS.dueThisMonth, date: "2026-10-10" },
      { amount: 10_00n, step: FUNDING_STEPS.dueThisMonth, date: "2026-10-17" },
      { amount: 10_00n, step: FUNDING_STEPS.dueThisMonth, date: "2026-10-24" },
      { amount: 10_00n, step: FUNDING_STEPS.dueThisMonth, date: "2026-10-31" },
    ]);
  });
});

describe("paymentFunding", () => {
  it("asks for what's owed beyond Available, less this month's credit overspending", () => {
    expect(paymentFunding(3_00n, 103_00n, 0n).underfunded).toBe(100_00n);
    expect(paymentFunding(-10_00n, 0n, 0n).underfunded).toBe(10_00n);
    expect(paymentFunding(-10_00n, 2_00n, 0n).underfunded).toBe(12_00n);
    expect(paymentFunding(31_00n, 65_00n, 33_00n).underfunded).toBe(1_00n);
    expect(paymentFunding(2_00n, 5_00n, 3_00n).underfunded).toBe(0n);
  });

  it("gives back Available above what's owed", () => {
    expect(paymentFunding(6_00n, 0n, 0n).overfunded).toBe(6_00n);
    expect(paymentFunding(2_00n, 7_00n, 0n).overfunded).toBe(0n);
  });

  it("follows the card's target when it has one", () => {
    // $30.00 a month asks $30.00, credit overspending or not.
    expect(paymentFunding(0n, 105_00n, 5_00n, need(30_00n))).toMatchObject({
      underfunded: 30_00n,
      parts: [{ amount: 30_00n, step: FUNDING_STEPS.cardPayment, date: "", rank: 0 }],
    });
    // Red at −$10.00 still asks its $33.34 share; overspending beyond the share is covered.
    expect(paymentFunding(-10_00n, 90_00n, 0n, need(33_34n)).underfunded).toBe(33_34n);
    expect(paymentFunding(-40_00n, 90_00n, 0n, need(33_34n)).underfunded).toBe(40_00n);
    // $50.00 against a $20.84 share gives back $29.16, not Available above what's owed.
    expect(paymentFunding(50_00n, 125_00n, 0n, need(0n, { overfunded: 29_16n })).overfunded).toBe(
      29_16n,
    );
  });
});

describe("fundUnderfunded", () => {
  const part = (amount: bigint, step: number, date = "") => ({
    amount,
    step: step as (typeof FUNDING_STEPS)[keyof typeof FUNDING_STEPS],
    date,
  });
  const categories = [
    { categoryId: "card", parts: [part(50_00n, FUNDING_STEPS.cardPayment)] },
    { categoryId: "rent", parts: [part(100_00n, FUNDING_STEPS.dueThisMonth, "2026-10-31")] },
    { categoryId: "netflix", parts: [part(15_00n, FUNDING_STEPS.dueThisMonth, "2026-10-23")] },
    { categoryId: "groceries", parts: [part(10_00n, FUNDING_STEPS.dueThisMonth, "2026-10-17")] },
    { categoryId: "over", parts: [part(4_00n, FUNDING_STEPS.overspent)] },
  ];

  it("funds everything when there's enough", () => {
    expect(fundUnderfunded(categories, 1000_00n)).toEqual(
      new Map([
        ["over", 4_00n],
        ["groceries", 10_00n],
        ["netflix", 15_00n],
        ["rent", 100_00n],
        ["card", 50_00n],
      ]),
    );
  });

  it("stops when Ready to Assign runs out, in order", () => {
    expect(fundUnderfunded(categories, 50_00n)).toEqual(
      new Map([
        ["over", 4_00n],
        ["groceries", 10_00n],
        ["netflix", 15_00n],
        ["rent", 21_00n],
      ]),
    );
    expect(fundUnderfunded(categories, 0n).size).toBe(0);
  });

  it("goes top to bottom on the same date", () => {
    const tied = [
      { categoryId: "a", parts: [part(10_00n, FUNDING_STEPS.dueThisMonth, "2026-10-31")] },
      { categoryId: "b", parts: [part(10_00n, FUNDING_STEPS.dueThisMonth, "2026-10-31")] },
    ];
    expect(fundUnderfunded(tied, 15_00n)).toEqual(
      new Map([
        ["a", 10_00n],
        ["b", 5_00n],
      ]),
    );
  });
});

describe("upcoming scheduled transactions", () => {
  const up = (amount: bigint, date = "2026-10-20") => ({ amount, date });

  it("asks what Available doesn't cover, at the earliest upcoming date", () => {
    expect(spendingFunding("2026-10", 0n, null, null, false, up(-30_00n))).toEqual({
      underfunded: 30_00n,
      overfunded: 0n,
      parts: [{ amount: 30_00n, step: FUNDING_STEPS.dueThisMonth, date: "2026-10-20" }],
    });
    // $10.00 available, $30.00 scheduled.
    expect(spendingFunding("2026-10", 10_00n, null, null, false, up(-30_00n)).underfunded).toBe(
      20_00n,
    );
    // Covered; an inflow asks nothing.
    expect(spendingFunding("2026-10", 50_00n, null, null, false, up(-30_00n)).underfunded).toBe(0n);
    expect(spendingFunding("2026-10", 0n, null, null, false, up(25_00n)).underfunded).toBe(0n);
  });

  it("asks the larger of the target and the schedule, all at the schedule's date", () => {
    // $40.00 target, $30.00 scheduled → $40.00, funded whole at its date.
    expect(spendingFunding("2026-10", 0n, monthly, need(40_00n), false, up(-30_00n))).toEqual({
      underfunded: 40_00n,
      overfunded: 0n,
      parts: [{ amount: 40_00n, step: FUNDING_STEPS.dueThisMonth, date: "2026-10-20" }],
    });
    // Target met at $40.00, $60.00 scheduled → $20.00.
    expect(
      spendingFunding("2026-10", 40_00n, monthly, need(0n), false, up(-60_00n)).underfunded,
    ).toBe(20_00n);
    // Snoozed targets ask nothing, scheduled transactions still do.
    expect(
      spendingFunding("2026-10", 0n, monthly, need(40_00n), true, up(-30_00n)).underfunded,
    ).toBe(30_00n);
  });

  it("puts a card with a scheduled payment first among card payments", () => {
    // Owes $10.00, $5.00 payment scheduled → still $10.00.
    const card = paymentFunding(0n, 10_00n, 0n, null, up(-5_00n, "2026-10-21"));
    expect(card.underfunded).toBe(10_00n);
    expect(card.parts).toEqual([
      { amount: 10_00n, step: FUNDING_STEPS.cardPayment, date: "2026-10-21", rank: 1 },
    ]);
    const plain = paymentFunding(0n, 10_00n, 0n);
    expect(
      fundUnderfunded(
        [
          { categoryId: "plain", parts: plain.parts },
          { categoryId: "scheduled", parts: card.parts },
        ],
        10_00n,
      ),
    ).toEqual(new Map([["scheduled", 10_00n]]));
  });

  // $15.00 for three cards owing $10.00, listed A (alert), C (pay off by October), B ($10.00
  // payment scheduled on the 20th).
  it("funds scheduled payments, then payment targets, then plain alerts", () => {
    const alert = paymentFunding(0n, 10_00n, 0n);
    const target = paymentFunding(0n, 10_00n, 0n, need(10_00n));
    const scheduled = paymentFunding(0n, 10_00n, 0n, null, up(-10_00n, "2026-10-20"));
    expect(
      fundUnderfunded(
        [
          { categoryId: "A", parts: alert.parts },
          { categoryId: "C", parts: target.parts },
          { categoryId: "B", parts: scheduled.parts },
        ],
        15_00n,
      ),
    ).toEqual(
      new Map([
        ["B", 10_00n],
        ["C", 5_00n],
      ]),
    );
  });
});

describe("Underfunded in the budget's first month", () => {
  type Target = { cadence: "monthly" | "weekly"; dueDay: number | null };
  const eom: Target = { cadence: "monthly", dueDay: null };
  const due = (day: number): Target => ({ cadence: "monthly", dueDay: day });
  const weekly: Target = { cadence: "weekly", dueDay: 6 };
  const parts = (target: Target, needed: bigint) =>
    afterStart(
      spendingFunding("2026-10", 0n, target, need(needed, { needed })).parts,
      "2026-10-12",
    );

  it("funds what fell due before the start after the rest of the month, before later months", () => {
    const later = need(20_00n, { needed: 60_00n, dueDate: "2026-12-31" });
    const categories = [
      {
        categoryId: "d",
        parts: spendingFunding("2026-10", 0n, { cadence: "custom", dueDay: null }, later).parts,
      },
      { categoryId: "c", parts: parts(eom, 20_00n) },
      { categoryId: "b", parts: parts(due(5), 20_00n) },
      { categoryId: "a", parts: parts(due(20), 20_00n) },
    ];
    // $30: A then C; $50: A, C, then B before D.
    expect(fundUnderfunded(categories, 30_00n)).toEqual(
      new Map([
        ["a", 20_00n],
        ["c", 10_00n],
      ]),
    );
    expect(fundUnderfunded(categories, 50_00n).get("b")).toBe(10_00n);
    expect(fundUnderfunded(categories, 50_00n).has("d")).toBe(false);
  });

  it("counts the start day itself as coming up", () => {
    expect(parts(due(12), 20_00n)[0]?.step).toBe(FUNDING_STEPS.dueThisMonth);
    expect(parts(due(11), 20_00n)[0]?.step).toBe(FUNDING_STEPS.beforeStart);
  });

  it("moves a weekly target's occurrences before the start too (Groceries' Oct 2 and 9)", () => {
    expect(parts(weekly, 50_00n).map((p) => [p.date, p.step])).toEqual([
      ["2026-10-03", FUNDING_STEPS.beforeStart],
      ["2026-10-10", FUNDING_STEPS.beforeStart],
      ["2026-10-17", FUNDING_STEPS.dueThisMonth],
      ["2026-10-24", FUNDING_STEPS.dueThisMonth],
      ["2026-10-31", FUNDING_STEPS.dueThisMonth],
    ]);
  });

  it("ties a weekly occurrence on the last day with end of month by list order", () => {
    const categories = [
      {
        categoryId: "weekly",
        parts: [{ amount: 10_00n, step: FUNDING_STEPS.dueThisMonth, date: "2026-10-31" }],
      },
      { categoryId: "eom", parts: parts(eom, 20_00n) },
    ];
    expect(fundUnderfunded(categories, 10_00n)).toEqual(new Map([["weekly", 10_00n]]));
  });
});
