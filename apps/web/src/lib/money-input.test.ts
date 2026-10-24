import { formatAmount, money } from "@strictbudget/engine";
import { describe, expect, it } from "vitest";
import { inCurrency, type MoneySettings, parseMoneyInput, toMoneyInput } from "./money-input";

const budget: MoneySettings = {
  currency: "USD",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
};

describe("amounts in an account's own currency", () => {
  it("keeps the budget's number format and symbol position, with the account's currency", () => {
    expect(inCurrency(budget, "EUR")).toEqual({ ...budget, currency: "EUR" });
    expect(inCurrency(budget, "USD")).toBe(budget);
    expect(inCurrency(budget, undefined)).toBe(budget);
    expect(inCurrency(budget, "not a currency")).toBe(budget);
  });

  it("reads and writes yen without decimals", () => {
    const yen = inCurrency(budget, "JPY");
    expect(parseMoneyInput("1,200", yen)).toBe(1200n);
    expect(parseMoneyInput("1000+200", yen)).toBe(1200n);
    expect(parseMoneyInput("12.50", yen)).toEqual(expect.stringContaining("Enter an amount like"));
    expect(toMoneyInput(150000n, yen)).toBe("150,000");
    expect(formatAmount(money(150000n, yen.currency), yen)).toBe("¥150,000");
  });

  it("reads and writes dinars with three decimals", () => {
    const dinar = inCurrency(budget, "KWD");
    expect(parseMoneyInput("1.234", dinar)).toBe(1234n);
    expect(parseMoneyInput("2", dinar)).toBe(2000n);
    expect(toMoneyInput(1234567n, dinar)).toBe("1,234.567");
  });

  it("reads the same text as the budget's cents for a USD account", () => {
    expect(parseMoneyInput("12.50", budget)).toBe(1250n);
    expect(toMoneyInput(1250n, budget)).toBe("12.50");
  });
});
