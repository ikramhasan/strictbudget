import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BudgetProvider } from "@/lib/budget-context";
import type { Budget } from "@/lib/budgets";
import type { HealthCard } from "@/lib/credit-card-health";
import { CardTable, FloatTable } from "./credit-card-health";

const budget = {
  id: "b",
  name: "Household",
  currency: "USD",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
  role: "owner",
} as Budget;

const card: HealthCard = {
  accountId: "a",
  name: "Visa",
  type: "credit_card",
  categoryId: "c",
  balance: "11500",
  available: "6000",
  status: "partial",
  covered: "6000",
  gap: "5500",
  fromCreditOverspending: "4000",
  other: "1500",
  cover: "5500",
  series: [
    { month: "2026-10", spending: "10000", payments: "0", balance: "10000", available: "6000" },
    { month: "2026-11", spending: "4000", payments: "2500", balance: "11500", available: "6000" },
  ],
};

describe("Credit card health tables", () => {
  it("lists the card's months with what it owed and what was set aside", () => {
    render(
      <BudgetProvider budget={budget}>
        <CardTable card={card} />
      </BudgetProvider>,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    const november = within(rows[1] as HTMLElement)
      .getAllByRole("cell")
      .map((c) => c.textContent);
    expect(november).toEqual(["November 2026", "$40.00", "$25.00", "$115.00", "$60.00"]);
  });

  it("lists what the cards carried on the float at each month's end", () => {
    render(
      <BudgetProvider budget={budget}>
        <FloatTable
          float={[
            { month: "2026-10", carried: "4000" },
            { month: "2026-11", carried: "0" },
          ]}
        />
      </BudgetProvider>,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual(["October 2026$40.00", "November 2026$0.00"]);
  });
});
