import { describe, expect, it } from "vitest";
import {
  addDays,
  ageOfMoneyAt,
  ageOfMoneyByMonth,
  countedAmount,
  type MoneyFlow,
  outflowAges,
} from "./age-of-money";

const usd = (dollars: number) => BigInt(Math.round(dollars * 100));
const inflow = (date: string, dollars: number): MoneyFlow => ({ date, amount: usd(dollars) });
const outflow = (date: string, dollars: number): MoneyFlow => ({ date, amount: -usd(dollars) });
const days = (from: string, count: number) =>
  Array.from({ length: count }, (_, i) => addDays(from, i));
const ageOf = (flows: MoneyFlow[], asOf?: string) => ageOfMoneyAt(outflowAges(flows), asOf);

describe("ageOfMoney: crafted cases", () => {
  it("averages the last ten outflows plainly, not by amount, and floors (16)", () => {
    const flows = [
      inflow("2026-04-01", 205),
      inflow("2026-04-22", 85),
      outflow("2026-05-01", 200),
      ...days("2026-05-02", 9).map((d) => outflow(d, 10)),
    ];
    // Ages 30, 20.5 → 20, 11 … 18: mean 16.6 (amount-weighted would be 25).
    expect(outflowAges(flows).map((a) => a.days)).toEqual([30, 20, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(ageOf(flows)).toBe(16);
  });

  it("keeps money's age across a transfer between cash accounts (32)", () => {
    expect(countedAmount([{ amount: -usd(100), transferFamily: "cash" }])).toBe(0n);
    const flows = [
      inflow("2026-02-01", 100),
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 12].map((d) =>
        outflow(`2026-03-${String(d).padStart(2, "0")}`, 10),
      ),
    ];
    expect(ageOf(flows)).toBe(32); // 32.7
    // April has no outflows: its month end still shows March's last ten.
    expect(ageOf(flows, "2026-04-30")).toBe(32);
  });

  it("floors each outflow's age before averaging (26)", () => {
    const flows = [
      inflow("2026-03-20", 7),
      ...Array.from({ length: 9 }, (_, j) => inflow(addDays("2026-03-24", 4 * j), 10)),
      inflow("2026-04-29", 3),
      ...days("2026-05-01", 10).map((d) => outflow(d, 10)),
    ];
    // Each $10 takes $7 from one inflow and $3 from the next, 4 days younger: x.8 days.
    expect(outflowAges(flows).map((a) => a.days)).toEqual([40, 37, 34, 31, 28, 25, 22, 19, 16, 13]);
    expect(ageOf(flows)).toBe(26); // unfloored ages would give 27
  });

  /** The case above, then June–August with a $100 loan transfer (06-15) and $3 (08-15). */
  const caseA = [
    inflow("2026-03-20", 7),
    ...Array.from({ length: 9 }, (_, j) => inflow(addDays("2026-03-24", 4 * j), 10)),
    inflow("2026-04-29", 3),
    ...days("2026-05-01", 10).map((d) => outflow(d, 10)),
  ];
  const summer = (tracking: MoneyFlow) => [
    ...caseA,
    tracking,
    outflow("2026-06-03", 100), // nothing in the pool
    inflow("2026-06-05", 100), // repays that first
    outflow("2026-06-15", 100),
    outflow("2026-07-01", 50),
    inflow("2026-07-01", 50),
    outflow("2026-08-15", 3),
  ];
  const monthEnds = (flows: MoneyFlow[]) =>
    ageOfMoneyByMonth(outflowAges(flows), "2026-05", "2026-08-31").map((m) => m.days);

  it("counts an outflow with no money as 0 days and repays it from the next inflow (19/15/12)", () => {
    // A $20 transfer in from a tracking account on 06-01 is an inflow.
    expect(countedAmount([{ amount: usd(20), transferFamily: "tracking" }])).toBe(usd(20));
    expect(monthEnds(summer(inflow("2026-06-01", 20)))).toEqual([26, 19, 15, 12]);
  });

  it("counts a categorized transfer to a tracking account as an outflow (15/12/9)", () => {
    expect(countedAmount([{ amount: -usd(20), transferFamily: "tracking" }])).toBe(-usd(20));
    expect(monthEnds(summer(outflow("2026-06-01", 20)))).toEqual([26, 15, 12, 9]);
  });

  it("gives the same result whichever of a same-day inflow and outflow comes first", () => {
    const base = [inflow("2026-06-01", 5), ...days("2026-06-02", 9).map((d) => outflow(d, 1))];
    const a = [...base, inflow("2026-06-20", 50), outflow("2026-06-20", 50)];
    const b = [...base, outflow("2026-06-20", 50), inflow("2026-06-20", 50)];
    expect(outflowAges(a)).toEqual(outflowAges(b));
  });
});

describe("ageOfMoney: a realistic budget's shape (14 days)", () => {
  it("counts a starting balance and card payments; 14", () => {
    const flows = [
      inflow("2026-10-02", 12000), // starting balance
      outflow("2026-10-03", 3000),
      outflow("2026-10-10", 40), // a card payment
      outflow("2026-10-15", 8),
      ...Array.from({ length: 8 }, () => outflow("2026-10-16", 1)),
      outflow("2026-10-17", 10), // a transfer to a loan account
    ];
    expect(
      outflowAges(flows)
        .slice(-10)
        .map((a) => a.days),
    ).toEqual([13, 14, 14, 14, 14, 14, 14, 14, 14, 15]);
    expect(ageOf(flows)).toBe(14);
  });
});

describe("countedAmount", () => {
  it("counts what moves money in or out of the cash accounts", () => {
    expect(countedAmount([{ amount: -usd(5) }])).toBe(-usd(5));
    expect(countedAmount([{ amount: usd(5) }])).toBe(usd(5));
    expect(countedAmount([{ amount: usd(500), startingBalance: true }])).toBe(usd(500));
    // A card payment is an outflow; money coming back from a card is ignored.
    expect(countedAmount([{ amount: -usd(40), transferFamily: "credit" }])).toBe(-usd(40));
    expect(countedAmount([{ amount: usd(40), transferFamily: "credit" }])).toBe(0n);
    expect(countedAmount([{ amount: -usd(40), transferFamily: "loan" }])).toBe(-usd(40));
    // So is a negative starting balance.
    expect(countedAmount([{ amount: -usd(500), startingBalance: true }])).toBe(0n);
  });

  it("nets a split's lines, leaving out a line that moves money between cash accounts", () => {
    expect(
      countedAmount([
        { amount: -usd(30) },
        { amount: -usd(20), transferFamily: "cash" },
        { amount: usd(5) },
      ]),
    ).toBe(-usd(25));
  });
});

describe("ageOfMoneyAt", () => {
  it("needs ten outflows", () => {
    const flows = [inflow("2026-01-01", 100), ...days("2026-01-02", 9).map((d) => outflow(d, 1))];
    expect(ageOf(flows)).toBeNull();
    expect(ageOf([...flows, outflow("2026-01-20", 1)])).toBe(6); // ages 1..9 and 19: 6.4
  });

  it("reads the window as of a date", () => {
    const flows = [inflow("2026-01-01", 100), ...days("2026-01-02", 20).map((d) => outflow(d, 1))];
    expect(ageOf(flows, "2026-01-11")).toBe(5); // ages 1..10
    expect(ageOf(flows, "2026-01-05")).toBeNull();
    expect(ageOf(flows)).toBe(15); // ages 11..20
  });

  it("is 0 days when everything is spent the day it arrives", () => {
    const flows = days("2026-01-01", 10).flatMap((d) => [inflow(d, 3), outflow(d, 3)]);
    expect(ageOf(flows)).toBe(0);
  });
});

describe("ageOfMoneyByMonth", () => {
  it("gives each month's end, the current month as of today, null before ten outflows", () => {
    const flows = [inflow("2026-07-15", 100), ...days("2026-08-01", 40).map((d) => outflow(d, 1))];
    expect(ageOfMoneyByMonth(outflowAges(flows), "2026-07", "2026-09-05")).toEqual([
      { month: "2026-07", days: null },
      { month: "2026-08", days: 42 }, // outflows 08-22..08-31: 38..47 days
      { month: "2026-09", days: 47 },
    ]);
  });
});

describe("addDays", () => {
  it("crosses month and year ends", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
