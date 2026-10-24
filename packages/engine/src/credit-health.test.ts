import { describe, expect, it } from "vitest";
import { cardHealth, coverAmount } from "./credit-health";

describe("cardHealth", () => {
  it("is covered when Available pays the whole balance", () => {
    expect(cardHealth(5000n, 0n, 0n)).toEqual({
      status: "covered",
      covered: 5000n,
      gap: 0n,
      fromCreditOverspending: 0n,
      other: 0n,
    });
  });

  it("is covered for a card that owes nothing", () => {
    expect(cardHealth(0n, 0n, 0n).status).toBe("covered");
  });

  it("is partly covered when some of the balance is set aside", () => {
    expect(cardHealth(10000n, 4000n, 0n)).toMatchObject({
      status: "partial",
      covered: 6000n,
      gap: 4000n,
      other: 4000n,
    });
  });

  it("is unfunded when none of it is, and a negative Available still counts as the gap", () => {
    expect(cardHealth(9000n, 9000n, 0n)).toMatchObject({ status: "unfunded", covered: 0n });
    // Owing $90 at an Available of −$10: the screen's Underfunded is $100, more than the balance.
    expect(cardHealth(9000n, 10000n, 0n)).toMatchObject({
      status: "unfunded",
      covered: 0n,
      gap: 10000n,
    });
  });

  it("splits the gap into credit overspending and the rest", () => {
    expect(cardHealth(10000n, 7000n, 2500n)).toMatchObject({
      fromCreditOverspending: 2500n,
      other: 4500n,
    });
    // Credit overspending can't explain more than the gap.
    expect(cardHealth(10000n, 1000n, 2500n)).toMatchObject({
      fromCreditOverspending: 1000n,
      other: 0n,
    });
  });
});

describe("coverAmount", () => {
  it("covers the gap with what Ready to Assign has, never more", () => {
    expect(coverAmount(4000n, 10000n)).toBe(4000n);
    expect(coverAmount(4000n, 1500n)).toBe(1500n);
  });

  it("offers nothing without a gap or without money to assign", () => {
    expect(coverAmount(0n, 10000n)).toBe(0n);
    expect(coverAmount(4000n, 0n)).toBe(0n);
    expect(coverAmount(4000n, -200n)).toBe(0n);
  });
});
