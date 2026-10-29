import { describe, expect, it } from "vitest";
import type { MonthFigures } from "./months";
import {
  type CategoryTarget,
  periodRollover,
  saveUpPerMonth,
  saveUpReachedMonth,
  targetInBase,
  targetNeed,
  targetPercent,
  weekdaysIn,
  weeklyDays,
} from "./targets";

const target = (
  behavior: CategoryTarget["behavior"],
  startMonth = "2026-10",
  extra: Partial<CategoryTarget> = {},
): CategoryTarget => ({
  cadence: "monthly",
  behavior,
  amount: 100_00n,
  dueDay: null,
  dueDate: null,
  repeatEvery: null,
  repeatUnit: null,
  startMonth,
  ...extra,
});
const f = (month: string, assigned: bigint, activity = 0n): MonthFigures => ({
  month,
  assigned,
  activity,
});
const need = (h: MonthFigures[], t: CategoryTarget, month = "2026-10") =>
  targetNeed(h, t, month, "2026-10");

describe("targetNeed", () => {
  it("set aside counts only this month's Assigned", () => {
    const setAside = target("set_aside");
    expect(need([], setAside)).toMatchObject({
      needed: 100_00n,
      funded: 0n,
      underfunded: 100_00n,
      dueDate: null,
    });
    expect(need([f("2026-10", 40_00n)], setAside)?.underfunded).toBe(60_00n);
    expect(need([f("2026-10", 100_00n, -30_00n)], setAside)?.underfunded).toBe(0n);
    expect(need([f("2026-10", 40_00n, 20_00n)], setAside)?.funded).toBe(40_00n);
    expect(need([f("2026-09", 70_00n)], setAside)?.underfunded).toBe(100_00n);
    expect(need([f("2026-10", 150_00n)], setAside)).toMatchObject({
      needed: 100_00n,
      funded: 150_00n,
      underfunded: 0n,
    });
    expect(need([f("2026-09", 150_00n), f("2026-10", 50_00n)], setAside)?.underfunded).toBe(50_00n);
  });

  it("refill counts what was carried in plus this month's Assigned", () => {
    const refill = target("refill");
    expect(need([], refill)?.underfunded).toBe(100_00n);
    expect(need([f("2026-09", 70_00n)], refill)?.underfunded).toBe(30_00n);
    expect(need([f("2026-09", 70_00n), f("2026-10", 0n, -20_00n)], refill)?.funded).toBe(70_00n);
    expect(need([f("2026-10", 100_00n, -30_00n)], refill)?.underfunded).toBe(0n);
    expect(need([f("2026-10", 40_00n, 20_00n)], refill)?.underfunded).toBe(60_00n);
    expect(need([f("2026-09", 70_00n, -20_00n)], refill)?.underfunded).toBe(50_00n);
    expect(need([f("2026-09", 70_00n), f("2026-10", -20_00n)], refill)?.underfunded).toBe(50_00n);
  });

  it("ignores carried money in a future month, for refill too", () => {
    const history = [f("2026-09", 70_00n)];
    expect(need(history, target("refill"), "2026-11")?.funded).toBe(0n);
    expect(need([...history, f("2026-11", 30_00n)], target("refill"), "2026-11")?.funded).toBe(
      30_00n,
    );
  });

  it("asks for nothing before the start month", () => {
    expect(need([f("2026-09", 70_00n)], target("refill"), "2026-09")).toBeNull();
    expect(need([f("2026-09", 70_00n)], target("refill", "2026-09"), "2026-09")?.funded).toBe(
      70_00n,
    );
  });
});

describe("weekly targets ($10 on Saturdays)", () => {
  it("counts the weekday's occurrences", () => {
    expect(weekdaysIn("2026-10", 6)).toBe(5);
    expect(weekdaysIn("2026-11", 6)).toBe(4);
    expect(weekdaysIn("2026-02", 0)).toBe(4);
    expect(weekdaysIn("2024-02", 4)).toBe(5);
  });
  it("asks the weekly amount once per occurrence", () => {
    const weekly = target("set_aside", "2026-10", { cadence: "weekly", amount: 10_00n, dueDay: 6 });
    expect(need([], weekly)?.needed).toBe(50_00n);
    expect(need([], weekly, "2026-11")?.needed).toBe(40_00n);
    expect(need([f("2026-10", 20_00n)], weekly)?.underfunded).toBe(30_00n);
  });
  it("refills the month's occurrences, counting what was carried in", () => {
    const weekly = target("refill", "2026-10", { cadence: "weekly", amount: 10_00n, dueDay: 6 });
    expect(need([], weekly)?.underfunded).toBe(50_00n);
    expect(need([], weekly, "2026-11")?.underfunded).toBe(40_00n);
    expect(need([f("2026-09", 15_00n)], weekly)).toMatchObject({
      funded: 15_00n,
      underfunded: 35_00n,
    });
    expect(need([f("2026-10", 25_00n, -15_00n)], weekly)?.underfunded).toBe(25_00n);
  });
});

describe("dated targets", () => {
  const yearly = target("set_aside", "2026-10", {
    cadence: "yearly",
    amount: 1000_00n,
    dueDate: "2026-12-30",
  });
  it("spreads what's missing over the months left, rounding up", () => {
    expect(need([], yearly)).toMatchObject({
      needed: 1000_00n,
      funded: 0n,
      underfunded: 333_34n,
      dueDate: "2026-12-30",
    });
    expect(need([], yearly, "2026-11")?.underfunded).toBe(500_00n);
    expect(need([], yearly, "2026-12")?.underfunded).toBe(1000_00n);
    const paid = [f("2026-10", 333_34n)];
    expect(need(paid, yearly)).toMatchObject({ funded: 333_34n, underfunded: 0n });
    expect(need(paid, yearly, "2026-11")).toMatchObject({ funded: 333_34n, underfunded: 333_33n });
    expect(need(paid, yearly, "2026-12")?.underfunded).toBe(666_66n);
  });

  it("starts a new period the month after the due month", () => {
    const everyTwo = target("set_aside", "2026-10", {
      cadence: "custom",
      amount: 300_00n,
      dueDate: "2026-11-01",
      repeatEvery: 2,
      repeatUnit: "month",
    });
    expect(need([], everyTwo)?.underfunded).toBe(150_00n);
    expect(need([f("2026-10", 150_00n), f("2026-11", 150_00n)], everyTwo, "2026-12")).toMatchObject(
      {
        needed: 300_00n,
        funded: 0n,
        underfunded: 150_00n,
        dueDate: "2027-01-01",
      },
    );
    const refill = target("refill", "2026-10", {
      cadence: "yearly",
      amount: 1000_00n,
      dueDate: "2026-11-01",
    });
    const carried = [f("2026-09", 70_00n)];
    expect(need(carried, refill)).toMatchObject({
      needed: 1000_00n,
      funded: 70_00n,
      underfunded: 465_00n,
      dueDate: "2026-11-01",
    });
    // December is a future month: carried money doesn't count yet; 12 months to next November.
    expect(need(carried, refill, "2026-12")).toMatchObject({
      underfunded: 83_34n,
      dueDate: "2027-11-01",
    });
  });

  it("stops asking after a one-time target's due month, but keeps it on", () => {
    const once = target("set_aside", "2026-10", {
      cadence: "custom",
      amount: 300_00n,
      dueDate: "2026-11-30",
    });
    expect(need([], once)?.underfunded).toBe(150_00n);
    expect(need([f("2026-10", 30_00n)], once, "2026-12")).toMatchObject({
      needed: 300_00n,
      funded: 30_00n,
      underfunded: 0n,
      monthAmount: 0n,
      overfunded: 0n,
      dueDate: "2026-11-30",
    });
    // Set aside $100.00 due Sep 15, $30.00 assigned in October: nothing over.
    const p1 = { ...once, amount: 100_00n, dueDate: "2026-09-15" };
    expect(need([f("2026-10", 30_00n)], p1)).toMatchObject({ funded: 30_00n, overfunded: 0n });
    // Fill up to $200.00 due Sep 8 with $40.00 carried in: Funded $40.00, nothing asked.
    const u1 = target("refill", "2026-10", {
      cadence: "custom",
      amount: 200_00n,
      dueDate: "2026-09-08",
    });
    expect(need([f("2026-09", 40_00n)], u1)).toMatchObject({ funded: 40_00n, underfunded: 0n });
    // A balance target past its month is gone.
    const pastBalance = { ...u1, behavior: "balance" as const, dueDate: "2026-01-01" };
    expect(need([f("2026-09", 40_00n)], pastBalance)).toBeNull();
  });

  it("balance targets ask only with a date", () => {
    const eventually = target("balance", "2026-10", { cadence: "custom", amount: 300_00n });
    expect(need([], eventually)).toMatchObject({
      needed: 300_00n,
      funded: 0n,
      underfunded: 0n,
      dueDate: null,
    });
    const byDec = { ...eventually, dueDate: "2026-12-01" };
    expect(need([], byDec)?.underfunded).toBe(100_00n);
    expect(need([f("2026-10", 100_00n)], byDec)).toMatchObject({
      funded: 100_00n,
      underfunded: 0n,
    });
  });

  it("balance targets count Available, this month's spending included", () => {
    const h = [f("2026-09", 40_00n), f("2026-10", 0n, -20_00n)];
    const byDec = target("balance", "2026-10", {
      cadence: "custom",
      amount: 200_00n,
      dueDate: "2026-12-01",
    });
    expect(need(h, byDec)).toMatchObject({ funded: 20_00n, underfunded: 60_00n });
    expect(need([f("2026-09", 40_00n)], byDec)?.underfunded).toBe(53_34n);
    const eventually = { ...byDec, dueDate: null };
    expect(need(h, eventually)).toMatchObject({ funded: 20_00n, underfunded: 0n });
  });

  it("refill counts what was carried in, not this month's spending", () => {
    const refill = target("refill", "2026-10", {
      cadence: "custom",
      amount: 1200_00n,
      dueDate: "2027-03-31",
    });
    expect(need([f("2026-09", 300_00n)], refill)?.underfunded).toBe(150_00n);
    expect(need([f("2026-09", 300_00n), f("2026-10", 0n, -120_00n)], refill)).toMatchObject({
      funded: 300_00n,
      underfunded: 150_00n,
    });
    expect(need([f("2026-09", 300_00n, -120_00n)], refill)?.underfunded).toBe(170_00n);
  });
});

describe("what's over and the month's targets", () => {
  const carried = (amount: bigint) => f("2026-09", amount);
  it("takes back Assigned above the month's amount, up to what's Available", () => {
    expect(need([f("2026-10", 150_00n)], target("set_aside"))?.overfunded).toBe(50_00n);
    expect(need([f("2026-10", 150_00n, -120_00n)], target("set_aside"))?.overfunded).toBe(30_00n);
    expect(need([carried(100_00n), f("2026-10", 150_00n)], target("set_aside"))?.overfunded).toBe(
      50_00n,
    );
    expect(need([f("2026-10", 150_00n)], target("refill"))?.overfunded).toBe(50_00n);
    expect(need([f("2026-10", 150_00n, -120_00n)], target("refill"))?.overfunded).toBe(30_00n);
  });

  it("counts carried money for refill, so Assigned can go below zero", () => {
    expect(need([carried(80_00n), f("2026-10", 50_00n)], target("refill"))?.overfunded).toBe(
      30_00n,
    );
    expect(need([carried(150_00n)], target("refill"))?.overfunded).toBe(50_00n);
    // In a future month carried money doesn't count, so nothing is over.
    expect(need([carried(150_00n)], target("refill"), "2026-11")?.overfunded).toBe(0n);
  });

  it("weekly and dated targets compare against this month's amount", () => {
    const weekly = target("set_aside", "2026-10", { cadence: "weekly", amount: 10_00n, dueDay: 6 });
    expect(need([f("2026-10", 70_00n)], weekly)?.overfunded).toBe(20_00n);
    const byDec = target("set_aside", "2026-10", {
      cadence: "custom",
      amount: 100_00n,
      dueDate: "2026-12-31",
    });
    expect(need([f("2026-10", 100_00n)], byDec)).toMatchObject({
      monthAmount: 33_34n,
      overfunded: 66_66n,
    });
    const yearly = target("set_aside", "2026-10", {
      cadence: "yearly",
      amount: 1000_00n,
      dueDate: "2026-12-30",
    });
    expect(need([f("2026-10", 333_34n)], yearly)?.overfunded).toBe(0n);
  });

  it("asks the month's full amount, or this month's share of a dated target", () => {
    // Monthly refill counts in full in the month's targets even with money carried in.
    expect(need([carried(70_00n)], target("refill"))?.monthAmount).toBe(100_00n);
    const refill = target("refill", "2026-10", {
      cadence: "yearly",
      amount: 1000_00n,
      dueDate: "2026-11-01",
    });
    expect(need([carried(70_00n)], refill)?.monthAmount).toBe(465_00n);
    // A custom Fill up repeating every month counts its full amount; every 2 months, or set
    // aside every month, its share.
    const custom = (behavior: CategoryTarget["behavior"], repeatEvery: number) =>
      target(behavior, "2026-10", {
        cadence: "custom",
        amount: 600_00n,
        dueDate: "2026-11-30",
        repeatEvery,
        repeatUnit: "month",
      });
    expect(need([], custom("refill", 1))).toMatchObject({
      underfunded: 300_00n,
      monthAmount: 600_00n,
    });
    expect(need([], custom("refill", 2))?.monthAmount).toBe(300_00n);
    expect(need([], custom("set_aside", 1))?.monthAmount).toBe(300_00n);
    const eventually = target("balance", "2026-10", { cadence: "custom", amount: 300_00n });
    // What it holds above the balance is over.
    expect(need([f("2026-10", 500_00n)], eventually)).toMatchObject({
      monthAmount: 0n,
      overfunded: 200_00n,
    });
    const small = { ...eventually, amount: 10_00n };
    expect(need([f("2026-10", 30_00n)], small)?.overfunded).toBe(20_00n);
    expect(need([f("2026-10", 30_00n, -15_00n)], small)?.overfunded).toBe(5_00n);
  });
});

describe("payment targets", () => {
  const card = (month: string, assigned: bigint, fundedSpending = 0n, payments = 0n) => ({
    month,
    assigned,
    activity: fundedSpending + payments,
    fundedSpending,
    payments,
  });
  const payoff = (dueDate: string) =>
    target("balance", "2026-10", { cadence: "payoff_by_date", amount: 0n, dueDate });
  const pay = (h: MonthFigures[], t: CategoryTarget, owed: bigint, month = "2026-10") =>
    targetNeed(h, t, month, "2026-10", owed);

  it("pay off by date spreads what's owed beyond Available over the months left", () => {
    // $120.00 by March 2027 from October asks a sixth.
    expect(pay([], payoff("2027-03-01"), 120_00n)).toMatchObject({
      needed: 120_00n,
      funded: 0n,
      underfunded: 20_00n,
      monthAmount: 20_00n,
      dueDate: "2027-03-01",
    });
    // $100.00 by December rounds up.
    expect(pay([], payoff("2026-12-01"), 100_00n)?.underfunded).toBe(33_34n);
    // With $5.00 of credit overspending: what's owed rises at once.
    expect(pay([], payoff("2027-03-01"), 125_00n)?.underfunded).toBe(20_84n);
  });

  it("pay off by date: funded card spending changes nothing", () => {
    // $10.00 of funded spending, $110.00 owed: "Pay off $100.00", 0%.
    const h = [card("2026-10", 0n, 10_00n)];
    expect(pay(h, payoff("2026-12-01"), 110_00n)).toMatchObject({
      needed: 100_00n,
      funded: 0n,
      underfunded: 33_34n,
    });
    // November: the $10.00 carried in counts: ($110.00 − $10.00) ÷ 2.
    expect(pay(h, payoff("2026-12-01"), 110_00n, "2026-11")?.underfunded).toBe(50_00n);
  });

  it("pay off by date: a payment without money set aside leaves what's to go alone", () => {
    // After a $20.00 payment: $90.00 owed, −$10.00 Available; still $100.00 to go.
    const h = [card("2026-10", 0n, 10_00n, -20_00n)];
    const need = pay(h, payoff("2026-12-01"), 90_00n);
    expect(need && need.needed - need.funded).toBe(100_00n);
    expect(need?.underfunded).toBe(33_34n);
    // The overpayment is cash overspending and doesn't roll over: November asks $90.00 ÷ 2.
    expect(pay(h, payoff("2026-12-01"), 90_00n, "2026-11")?.underfunded).toBe(45_00n);
  });

  it("pay off by date: assigning more than the share is on track, and the rest is over", () => {
    // $50.00 assigned against $125.00: 40%, nothing more this month, $29.16 over.
    const h = [card("2026-10", 50_00n)];
    const need = pay(h, payoff("2027-03-01"), 125_00n);
    expect(need).toMatchObject({ needed: 125_00n, funded: 50_00n, underfunded: 0n });
    expect(need?.overfunded).toBe(29_16n);
    expect(need && targetPercent(need)).toBe(40);
    // November: ($125.00 − $50.00) ÷ 5.
    expect(pay(h, payoff("2027-03-01"), 125_00n, "2026-11")?.underfunded).toBe(15_00n);
  });

  it("pay off by date asks the rest in its month and nothing after it", () => {
    expect(pay([], payoff("2026-10-01"), 120_00n)?.underfunded).toBe(120_00n);
    expect(pay([card("2026-10", 1_00n)], payoff("2026-09-01"), 2_00n)).toMatchObject({
      needed: 2_00n,
      funded: 1_00n,
      underfunded: 0n,
      monthAmount: 0n,
      dueDate: "2026-09-01",
    });
  });

  it("pay specific amount monthly asks the amount each month, whatever was paid or spent", () => {
    const monthly = target("set_aside", "2026-10", { cadence: "payment_monthly", amount: 30_00n });
    // $30.00 a month, $5.00 credit overspending on the card.
    expect(pay([], monthly, 105_00n)).toMatchObject({ needed: 30_00n, underfunded: 30_00n });
    // $50.00 assigned: met, $20.00 over; November asks $30.00 again with $50.00 carried in.
    const h = [card("2026-10", 50_00n)];
    expect(pay(h, monthly, 105_00n)).toMatchObject({ underfunded: 0n, overfunded: 20_00n });
    expect(pay(h, monthly, 105_00n, "2026-11")?.underfunded).toBe(30_00n);
  });
});

// Set aside $60 every 2 months due Sep 30, $80 assigned in September.
describe("periodRollover", () => {
  const ro = target("set_aside", "2026-09", {
    cadence: "custom",
    amount: 60_00n,
    dueDate: "2026-09-30",
    repeatEvery: 2,
    repeatUnit: "month",
  });
  const h = [f("2026-09", 80_00n), f("2026-10", 30_00n)];

  it("is what the last period left, through the whole new period", () => {
    expect(periodRollover(h, ro, "2026-10")).toBe(80_00n);
    expect(periodRollover(h, ro, "2026-11")).toBe(80_00n);
    // "$30.00 more needed by November 30th".
    expect(need(h, ro, "2026-11")).toMatchObject({ funded: 30_00n, underfunded: 30_00n });
  });

  it("is zero for other targets", () => {
    expect(periodRollover(h, { ...ro, behavior: "refill" }, "2026-10")).toBe(0n);
    expect(periodRollover(h, target("set_aside", "2026-09"), "2026-10")).toBe(0n);
  });
});

describe("weekly targets that start mid-month", () => {
  const saturdays = target("set_aside", "2026-10", {
    cadence: "weekly",
    amount: 10_00n,
    dueDay: 6,
    startDay: 12,
  });

  it("ask only for the weeks from their start day, then every week", () => {
    expect(weeklyDays(saturdays, "2026-10")).toEqual([17, 24, 31]);
    expect(need([], saturdays)).toMatchObject({ needed: 30_00n, underfunded: 30_00n });
    expect(need([], saturdays, "2026-11")).toMatchObject({ needed: 40_00n });
    // The month's targets total still counts all five Saturdays.
    expect(need([], saturdays)?.monthAmount).toBe(50_00n);
  });

  it("count the start day itself", () => {
    expect(weeklyDays({ ...saturdays, startDay: 17 }, "2026-10")).toEqual([17, 24, 31]);
    expect(weeklyDays({ ...saturdays, startDay: null }, "2026-10")).toEqual([3, 10, 17, 24, 31]);
  });
});

describe("targetPercent", () => {
  it("rounds down and stays within 0–100", () => {
    expect(targetPercent({ needed: 100_00n, funded: 40_00n })).toBe(40);
    expect(targetPercent({ needed: 100_00n, funded: 99_99n })).toBe(99);
    expect(targetPercent({ needed: 40_00n, funded: 15_00n })).toBe(37);
    expect(targetPercent({ needed: 100_00n, funded: 150_00n })).toBe(100);
    expect(targetPercent({ needed: 100_00n, funded: -20_00n })).toBe(0);
    // On track for a yearly target: a third of the total.
    expect(targetPercent({ needed: 1000_00n, funded: 333_34n })).toBe(33);
  });
});

describe("debt payment targets", () => {
  const debt = target("set_aside", "2026-10", { cadence: "debt_monthly", amount: 300_00n });

  it("asks the amount each month like set aside, whatever was paid", () => {
    expect(need([], debt)).toMatchObject({
      needed: 300_00n,
      underfunded: 300_00n,
      monthAmount: 300_00n,
    });
    // $100.00 assigned: 33%, $200.00 to go; a $50.00 payment doesn't change it.
    const h = [f("2026-10", 100_00n, -50_00n)];
    const october = need(h, debt);
    expect(october).toMatchObject({ funded: 100_00n, underfunded: 200_00n });
    expect(october && targetPercent(october)).toBe(33);
    // November asks $300.00 again with $50.00 carried in.
    expect(need(h, debt, "2026-11")).toMatchObject({ funded: 0n, underfunded: 300_00n });
  });
});

describe("targetInBase", () => {
  const t = (amount: bigint, currency: "EUR" | "JPY" | "KWD" | "USD") => ({
    ...target("set_aside"),
    amount,
    currency,
    dueDay: 15,
  });

  it("leaves a target in the budget's currency alone", () => {
    const usd = t(100_00n, "USD");
    expect(targetInBase(usd, "1.5", "USD")).toBe(usd);
  });

  it("converts only the amount, keeping cadence and dates", () => {
    expect(targetInBase(t(1500_00n, "EUR"), "1.0842", "USD")).toEqual(t(1626_30n, "USD"));
  });

  it("rounds up at the budget currency's minor unit (2 decimals)", () => {
    // €10.01 × 1.1 = $11.011 → $11.02, never $11.01.
    expect(targetInBase(t(10_01n, "EUR"), "1.1", "USD").amount).toBe(11_02n);
    // An exact result isn't pushed up.
    expect(targetInBase(t(10_00n, "EUR"), "1.1", "USD").amount).toBe(11_00n);
  });

  it("rounds up into a currency without minor units (JPY, 0 decimals)", () => {
    // $10.01 × 149.333 = ¥1494.82… → ¥1495.
    expect(targetInBase(t(10_01n, "USD"), "149.333", "JPY")).toMatchObject({
      amount: 1495n,
      currency: "JPY",
    });
  });

  it("rounds up from JPY and into a three-decimal currency (KWD)", () => {
    // ¥1000 × 0.0067 = $6.70 exactly; ¥1001 × 0.0067 = $6.7067 → $6.71.
    expect(targetInBase(t(1000n, "JPY"), "0.0067", "USD").amount).toBe(6_70n);
    expect(targetInBase(t(1001n, "JPY"), "0.0067", "USD").amount).toBe(6_71n);
    // $100.00 × 0.30771 = KD 30.771 exactly; $100.01 → KD 30.7740771 → KD 30.775.
    expect(targetInBase(t(100_00n, "USD"), "0.30771", "KWD").amount).toBe(30_771n);
    expect(targetInBase(t(100_01n, "USD"), "0.30771", "KWD").amount).toBe(30_775n);
    // KD 1.001 × 3.25 = $3.25325 → $3.26.
    expect(targetInBase(t(1_001n, "KWD"), "3.25", "USD").amount).toBe(3_26n);
  });
});

describe("savings goals", () => {
  describe("keep a safety fund ($10,000, at most $500 a month)", () => {
    const fund = target("refill", "2026-10", { amount: 500_00n, goalAmount: 10_000_00n });

    it("builds up at the monthly limit, then asks only what brings it back", () => {
      expect(need([], fund)).toMatchObject({
        needed: 10_000_00n,
        funded: 0n,
        underfunded: 500_00n,
        monthAmount: 500_00n,
      });
      expect(need([f("2026-09", 9_800_00n)], fund)).toMatchObject({
        funded: 9_800_00n,
        underfunded: 200_00n,
        monthAmount: 200_00n,
      });
      expect(need([f("2026-09", 10_000_00n)], fund)).toMatchObject({
        underfunded: 0n,
        monthAmount: 0n,
      });
    });

    it("asks to refill after money is spent from it, at the limit", () => {
      const h = [f("2026-09", 10_000_00n), f("2026-10", 0n, -1_200_00n)];
      expect(targetNeed(h, fund, "2026-11", "2026-11")?.underfunded).toBe(500_00n);
      const small = [f("2026-09", 10_000_00n), f("2026-10", 0n, -300_00n)];
      expect(targetNeed(small, fund, "2026-11", "2026-11")?.underfunded).toBe(300_00n);
    });

    it("gives back what's put in beyond the balance", () => {
      expect(need([f("2026-09", 10_000_00n), f("2026-10", 300_00n)], fund)?.overfunded).toBe(
        300_00n,
      );
    });

    it("all at once asks like a plain refill, but counts only what it asks in the month", () => {
      const once = target("refill", "2026-10", { amount: 10_000_00n, goalAmount: 10_000_00n });
      const plain = target("refill", "2026-10", { amount: 10_000_00n });
      const h = [f("2026-09", 7_000_00n), f("2026-10", 1_000_00n, -50_00n)];
      expect(need(h, once)).toEqual({ ...need(h, plain), monthAmount: 3_000_00n });
      expect(need(h, once)?.underfunded).toBe(2_000_00n);
      // A full fund adds nothing to the month's targets (Cost to Be Me).
      expect(need([f("2026-09", 10_000_00n)], once)?.monthAmount).toBe(0n);
      expect(need([f("2026-09", 10_000_00n)], plain)?.monthAmount).toBe(10_000_00n);
    });
  });

  describe("save up for something ($3,000 at $250 a month)", () => {
    const saveUp = (startMonth = "2026-10") =>
      target("set_aside", startMonth, {
        goal: "save_up",
        amount: 250_00n,
        goalAmount: 3_000_00n,
      });

    it("counts the money already in the category when the goal began", () => {
      expect(need([f("2026-09", 1_000_00n)], saveUp())).toMatchObject({
        needed: 3_000_00n,
        funded: 1_000_00n,
        underfunded: 250_00n,
        monthAmount: 250_00n,
        dueDate: null,
      });
      expect(need([f("2026-09", 1_000_00n), f("2026-10", 100_00n)], saveUp())).toMatchObject({
        funded: 1_100_00n,
        underfunded: 150_00n,
      });
    });

    it("asks only for what's left, and nothing once reached", () => {
      expect(need([f("2026-09", 2_900_00n)], saveUp())?.underfunded).toBe(100_00n);
      expect(need([f("2026-09", 3_000_00n)], saveUp())).toMatchObject({
        funded: 3_000_00n,
        underfunded: 0n,
        monthAmount: 0n,
      });
    });

    it("stays reached when the money is spent on what it was for", () => {
      const h = [f("2026-09", 3_000_00n, 0n), f("2026-10", 0n, -2_400_00n)];
      expect(targetNeed(h, saveUp("2026-09"), "2026-11", "2026-11")).toMatchObject({
        funded: 3_000_00n,
        underfunded: 0n,
        overfunded: 0n,
      });
    });

    it("asks again when money is moved out of it", () => {
      const h = [f("2026-09", 3_000_00n), f("2026-10", -500_00n)];
      expect(targetNeed(h, saveUp("2026-09"), "2026-11", "2026-11")).toMatchObject({
        funded: 2_500_00n,
        underfunded: 250_00n,
      });
    });

    it("gives back what's put in beyond the goal", () => {
      expect(need([f("2026-09", 3_000_00n), f("2026-10", 200_00n)], saveUp())?.overfunded).toBe(
        200_00n,
      );
    });
  });

  describe("save up by a date ($1,200 by March 2027)", () => {
    const byMarch = target("set_aside", "2026-10", {
      cadence: "custom",
      goal: "save_up",
      amount: 1_200_00n,
      goalAmount: 1_200_00n,
      dueDate: "2027-03-01",
    });

    it("spreads what's left over the months up to the date, rounding up", () => {
      expect(need([], byMarch)).toMatchObject({
        needed: 1_200_00n,
        underfunded: 200_00n,
        dueDate: "2027-03-01",
      });
      expect(need([f("2026-09", 600_00n)], byMarch)?.underfunded).toBe(100_00n);
      expect(need([f("2026-09", 1_000_00n)], byMarch)?.underfunded).toBe(33_34n);
    });

    it("keeps asking for all that's left after the date", () => {
      const h = [f("2026-10", 800_00n)];
      expect(targetNeed(h, byMarch, "2027-05", "2027-05")).toMatchObject({
        funded: 800_00n,
        underfunded: 400_00n,
      });
    });

    it("sets no money apart as left over from an earlier period", () => {
      expect(periodRollover([f("2026-09", 500_00n)], byMarch, "2026-11")).toBe(0n);
    });
  });

  it("works out when a goal is reached and what a date asks each month", () => {
    expect(saveUpReachedMonth(1_000_00n, 250_00n, "2026-10", 250_00n)).toBe("2027-01");
    expect(saveUpReachedMonth(1_000_00n, 250_00n, "2026-10")).toBe("2027-02");
    expect(saveUpReachedMonth(100_00n, 250_00n, "2026-10", 250_00n)).toBe("2026-10");
    expect(saveUpReachedMonth(0n, 250_00n, "2026-10")).toBeNull();
    expect(saveUpReachedMonth(1_000_00n, 0n, "2026-10")).toBeNull();
    expect(saveUpPerMonth(1_200_00n, "2026-10", "2027-03")).toBe(200_00n);
    expect(saveUpPerMonth(1_000_00n, "2026-10", "2027-03")).toBe(166_67n);
    expect(saveUpPerMonth(1_200_00n, "2027-05", "2027-03")).toBe(1_200_00n);
    expect(saveUpPerMonth(0n, "2026-10", "2027-03")).toBe(0n);
  });

  it("converts a goal's amount with its target into the budget's currency", () => {
    const eur = {
      ...target("refill", "2026-10", { amount: 500_00n, goalAmount: 10_000_00n }),
      currency: "EUR" as const,
    };
    expect(targetInBase(eur, "1.1", "USD")).toMatchObject({
      amount: 550_00n,
      goalAmount: 11_000_00n,
      currency: "USD",
    });
  });
});
