import { describe, expect, it } from "vitest";
import type { MonthlySummary } from "./data";
import { monthlySummaryEmail } from "./email";

const summary: MonthlySummary = {
  month: "2026-09",
  currency: "USD",
  income: 100000n,
  spent: 5000n,
  previous: null,
  assigned: 100000n,
  readyToAssign: 0n,
  groups: [],
  overspent: [],
  targets: { total: 0, funded: 0, partly: 0, short: [] },
  largest: [],
  categories: [],
  upcoming: { count: 0, items: [] },
};

const render = (s: MonthlySummary) =>
  monthlySummaryEmail({
    to: "dana@example.com",
    webOrigin: "https://app.example.com",
    budget: {
      id: "b1",
      name: "Home",
      numberFormat: "comma_dot",
      currencySymbolPosition: "none",
      dateFormat: "YYYY-MM-DD",
    },
    summary: s,
    overview: null,
    unsubscribeUrl: "https://app.example.com/unsubscribe#token=t",
    oneClickUrl: "https://app.example.com/v1/email/unsubscribe?token=t",
  });

describe("monthly summary email", () => {
  it("names the currency of a scheduled transaction in another one", () => {
    const mail = render({
      ...summary,
      upcoming: {
        count: 2,
        items: [
          {
            payee: "Landlord",
            date: "2026-10-01",
            category: "Rent",
            amount: -90000n,
            currency: "USD",
          },
          {
            payee: "Telco",
            date: "2026-10-05",
            category: "Phone",
            amount: -4500n,
            currency: "EUR",
          },
        ],
      },
    });
    expect(mail.text).toContain("- 1 Oct Landlord: -900.00\n");
    expect(mail.text).toContain("- 5 Oct Telco: -45.00 EUR");
    expect(mail.html).toContain("45.00 EUR");
    expect(mail.html).toContain("the budget's currency, unless another currency is named.");
  });

  it("makes no such caveat when every amount is the budget's", () => {
    const mail = render(summary);
    expect(mail.html).toContain("Amounts are in USD, the budget's currency.");
    expect(mail.subject).toBe("Your September in strictbudget: Home");
  });
});
