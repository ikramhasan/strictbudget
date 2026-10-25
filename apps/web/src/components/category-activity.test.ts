import { describe, expect, it } from "vitest";
import { cardActivity } from "./category-activity";

describe("cardActivity", () => {
  it("adds up a card's Activity window", () => {
    // Spending −$12, no returns, $9 funded, $16 paid: Total Activity −$7.
    expect(
      cardActivity({
        spendingAndOutflows: "-1200",
        paymentsAndInflows: "1600",
        fundedSpending: "900",
        paymentsMade: "-1600",
      }),
    ).toEqual({ spending: -1200n, returns: 0n, funded: 900n, paymentsAndReturns: -1600n });
  });

  it("lists returns and statement credits apart from payments", () => {
    expect(
      cardActivity({
        spendingAndOutflows: "-500",
        paymentsAndInflows: "900",
        fundedSpending: "-200",
        paymentsMade: "-600",
      }),
    ).toEqual({ spending: -500n, returns: 300n, funded: 0n, paymentsAndReturns: -800n });
  });
});
