import { describe, expect, it } from "vitest";
import {
  addSavings,
  NO_SAVINGS,
  rollingSavings,
  type SavingsMonth,
  savingsFigures,
} from "./savings-rate";

const month = (m: Partial<SavingsMonth>): SavingsMonth => ({ ...NO_SAVINGS, ...m });

describe("savingsFigures", () => {
  it("adds saving categories and transfers to tracking back to what's left over", () => {
    // $5,000 in; $3,000 spent, of which $500 to an Investments category and $400 moved to a
    // tracking account from another category.
    const f = savingsFigures(
      month({
        income: 500000n,
        spending: -300000n,
        savingCategories: -50000n,
        toTracking: -40000n,
      }),
    );
    expect(f).toEqual({
      income: 500000n,
      netIncome: 200000n,
      savedViaCategories: 50000n,
      movedToTracking: 40000n,
      saved: 290000n,
      rate: 58,
      plainRate: 40,
    });
  });

  it("counts a categorized transfer to a tracking account once", () => {
    // The $1,000 transfer sits in a saving category: the API puts it in savingCategories only,
    // never in toTracking as well.
    const f = savingsFigures(
      month({ income: 400000n, spending: -100000n, savingCategories: -100000n }),
    );
    expect(f.savedViaCategories).toBe(100000n);
    expect(f.movedToTracking).toBe(0n);
    expect(f.saved).toBe(400000n);
    expect(f.rate).toBe(100);
    expect(f.plainRate).toBe(75);
  });

  it("has no rate without income: a gap, not 0% or infinity", () => {
    const none = savingsFigures(month({ spending: -12000n }));
    expect(none.rate).toBeNull();
    expect(none.plainRate).toBeNull();
    const negative = savingsFigures(month({ income: -500n, spending: -12000n }));
    expect(negative.rate).toBeNull();
    expect(negative.plainRate).toBeNull();
    expect(savingsFigures(NO_SAVINGS).rate).toBeNull();
  });

  it("goes negative when spending outruns income", () => {
    const f = savingsFigures(
      month({ income: 100000n, spending: -150000n, savingCategories: -10000n }),
    );
    expect(f.netIncome).toBe(-50000n);
    expect(f.saved).toBe(-40000n);
    expect(f.rate).toBe(-40);
    expect(f.plainRate).toBe(-50);
  });

  it("lowers the saving with a refund into a saving category", () => {
    // $300 into Investments and a $100 refund back into it: $200 saved via the category.
    const f = savingsFigures(
      month({ income: 100000n, spending: -20000n, savingCategories: -20000n }),
    );
    expect(f.savedViaCategories).toBe(20000n);
    // A month where the refund outweighs the saving puts it below what's left over.
    const back = savingsFigures(
      month({ income: 100000n, spending: 5000n, savingCategories: 5000n }),
    );
    expect(back.netIncome).toBe(105000n);
    expect(back.savedViaCategories).toBe(-5000n);
    expect(back.saved).toBe(100000n);
    expect(back.rate).toBe(100);
  });

  it("nets money brought back from tracking accounts out of income and the moved amount", () => {
    // $1,000 moved to investments, $400 of it brought back into Ready to Assign.
    const f = savingsFigures(
      month({
        income: 540000n,
        incomeFromTracking: 40000n,
        spending: -400000n,
        toTracking: -100000n,
      }),
    );
    expect(f.income).toBe(500000n);
    expect(f.movedToTracking).toBe(60000n);
    expect(f.netIncome).toBe(140000n);
    expect(f.saved).toBe(200000n);
    expect(f.rate).toBe(40);
    // The plain rate keeps Income v Expense's income.
    expect(f.plainRate).toBe(25.93);
  });

  it("has no saving rate when all income came back from tracking accounts", () => {
    const f = savingsFigures(
      month({ income: 30000n, incomeFromTracking: 30000n, spending: -1000n }),
    );
    expect(f.income).toBe(0n);
    expect(f.rate).toBeNull();
    expect(f.plainRate).toBe(96.67);
  });
});

describe("rollingSavings", () => {
  it("sums each window rather than averaging monthly rates", () => {
    const months = [
      month({ income: 100000n, spending: -50000n }),
      month({ income: 900000n, spending: -900000n }),
    ];
    const rolling = rollingSavings(months, 12);
    // The monthly rates are 50% and 0%; the window's is 50,000 of 1,000,000.
    expect(savingsFigures(rolling[1] as SavingsMonth).rate).toBe(5);
  });

  it("starts with shorter windows at the first month and slides after `window` months", () => {
    const months = Array.from({ length: 14 }, (_, i) => month({ income: BigInt(i + 1) }));
    const rolling = rollingSavings(months, 12);
    expect(rolling[0]?.income).toBe(1n);
    expect(rolling[2]?.income).toBe(6n);
    // Months 1–12, then 2–13 and 3–14.
    expect(rolling[11]?.income).toBe(78n);
    expect(rolling[12]?.income).toBe(90n);
    expect(rolling[13]?.income).toBe(102n);
  });

  it("keeps a month without income in the window", () => {
    const rolling = rollingSavings([
      month({ income: 1000n, spending: -500n }),
      month({ spending: -500n }),
    ]);
    expect(savingsFigures(rolling[1] as SavingsMonth).rate).toBe(0);
  });
});

describe("addSavings", () => {
  it("adds every part", () => {
    expect(
      addSavings([
        month({
          income: 1n,
          incomeFromTracking: 2n,
          spending: 3n,
          savingCategories: 4n,
          toTracking: 5n,
        }),
        month({
          income: 10n,
          incomeFromTracking: 20n,
          spending: 30n,
          savingCategories: 40n,
          toTracking: 50n,
        }),
      ]),
    ).toEqual({
      income: 11n,
      incomeFromTracking: 22n,
      spending: 33n,
      savingCategories: 44n,
      toTracking: 55n,
    });
    expect(addSavings([])).toEqual(NO_SAVINGS);
  });
});
