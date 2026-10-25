import { describe, expect, it } from "vitest";
import {
  currentFragment,
  type SuggestionSources,
  searchSuggestions,
  withTerm,
} from "./search-suggestions";

const sources: SuggestionSources = {
  categories: [{ name: "Groceries" }, { name: "Rent/Mortgage" }, { name: "Entertainment" }],
  accounts: [{ name: "Wallet" }],
  flags: [
    { color: "red", name: "" },
    { color: "blue", name: "Reimburse" },
  ],
  settings: {
    currency: "USD",
    numberFormat: "comma_dot",
    currencySymbolPosition: "before",
    dateFormat: "MM/DD/YYYY",
  },
  today: "2026-10-15",
};
const terms = (typed: string, from = sources) => searchSuggestions(typed, from).map((s) => s.term);
const FIND = (t: string) => [t, `Payee: ${t}`, `Category: ${t}`, `Memo: ${t}`];

describe("search suggestions", () => {
  it("suggests matching categories and accounts, then a find in each field", () => {
    expect(terms("ent")).toEqual([
      "Category: Rent/Mortgage",
      "Category: Entertainment",
      ...FIND("ent"),
    ]);
    expect(terms("wal")).toEqual(["Account: Wallet", ...FIND("wal")]);
    expect(terms("")).toEqual([]);
  });

  it("suggests flags and states by name", () => {
    expect(terms("red")).toEqual([
      "Flag: Red",
      "Is: Uncleared",
      "Is: Cleared",
      "Is: Cleared or Reconciled",
      ...FIND("red"),
    ]);
    expect(terms("reimb")).toEqual(["Flag: Reimburse", ...FIND("reimb")]);
  });

  it("lists every option of a label typed", () => {
    expect(terms("is:").slice(0, 10)).toEqual([
      "Is: Uncleared",
      "Is: Cleared",
      "Is: Reconciled",
      "Is: Unreconciled",
      "Is: Cleared or Reconciled",
      "Is: Matched",
      "Is: Approved",
      "Is: Unapproved",
      "Is: Needs Category",
      "Is: Unapproved or Needs Category",
    ]);
    expect(terms("is: appr")[0]).toBe("Is: Uncleared");
    expect(terms("flag").slice(0, 3)).toEqual(["Flag: None", "Flag: Red", "Flag: Reimburse"]);
  });

  it("reads amounts and dates", () => {
    expect(searchSuggestions("25", sources).slice(1, 4)).toEqual([
      { label: "Outflow:", text: "Outflow equals $25.00", term: "Outflow: 25" },
      { label: "Outflow:", text: "Outflow more or equal to $25.00", term: "Outflow: >=25" },
      { label: "Outflow:", text: "Outflow less or equal to $25.00", term: "Outflow: <=25" },
    ]);
    expect(terms("10/02/2026").slice(0, 3)).toEqual([
      "On: 10/02/2026",
      "Before: 10/02/2026",
      "After: 10/02/2026",
    ]);
  });

  it("offers Income: for this month after a start of 'income' or a digit", () => {
    const income = {
      label: "Income:",
      text: "Enter month like 'Income: October 2026'",
      term: "Income: October 2026",
      calendar: true,
    };
    for (const typed of ["i", "inco", "income", "Income:", "income: ", "2026"]) {
      expect(searchSuggestions(typed, sources)[0], typed).toEqual(income);
    }
    expect(searchSuggestions("5", sources)[3]).toEqual(income);
    // After the date options, before the amounts.
    expect(terms("10/02/2026").slice(0, 4)).toEqual([
      "On: 10/02/2026",
      "Before: 10/02/2026",
      "After: 10/02/2026",
      "Income: October 2026",
    ]);
    for (const typed of ["oct", "October", "income: o", "ix"]) {
      expect(terms(typed), typed).not.toContain("Income: October 2026");
    }
    expect(terms("i", { ...sources, today: "2027-01-03" })[0]).toBe("Income: January 2027");
  });

  it("completes partial dates and writes the full date", () => {
    expect(searchSuggestions("5", sources).slice(0, 3)).toEqual([
      { label: "On:", text: "On 05/01/2026", term: "On: 05/01/2026" },
      { label: "Before:", text: "On or before 05/01/2026", term: "Before: 05/01/2026" },
      { label: "After:", text: "On or after 05/01/2026", term: "After: 05/01/2026" },
    ]);
    expect(terms("10/2026").slice(0, 3)).toEqual([
      "On: 10/20/2026",
      "Before: 10/20/2026",
      "After: 10/20/2026",
    ]);
    expect(terms("Card 5")[0]).toBe("On: 05/01/2026");
    expect(terms("13")[0]).toBe("Income: October 2026");
    const ddmm = {
      ...sources,
      settings: { ...sources.settings, dateFormat: "DD/MM/YYYY" as const },
    };
    expect(terms("5", ddmm)[0]).toBe("On: 05/10/2026");
    expect(terms("12/25", ddmm)[0]).toBe("Income: October 2026");
  });

  it("keeps the amounts when a number also reads as a date", () => {
    expect(terms("5").slice(3, 6)).toEqual(["Income: October 2026", "Outflow: 5", "Outflow: >=5"]);
    expect(terms("10/02")).not.toContain("Outflow: 10/02");
  });

  it("offers Income: for the date's month unless an amount was typed", () => {
    expect(terms("5/")).toContain("Income: May 2026");
    expect(terms("10/02/25")).toContain("Income: October 2025");
    expect(terms("x-c11-135")).toContain("Income: November 2026");
    expect(terms("Card 5")).toContain("Income: May 2026");
    for (const typed of ["5", "105", "10.02"]) {
      expect(terms(typed), typed).toContain("Income: October 2026");
    }
  });

  it("replaces what's being typed with the picked term", () => {
    expect(currentFragment("Payee: sto, gro")).toBe("gro");
    expect(withTerm("Payee: sto, gro", "Category: Groceries")).toBe(
      "Payee: sto, Category: Groceries, ",
    );
    expect(withTerm("gro", "Category: Groceries")).toBe("Category: Groceries, ");
  });
});
