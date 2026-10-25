import { describe, expect, it } from "vitest";
import type { DateFormat } from "./format-settings";
import { completeDate, incomeTerm, parseSearch, type SearchSettings } from "./register-search";

const settings: SearchSettings = {
  currency: "USD",
  numberFormat: "comma_dot",
  dateFormat: "MM/DD/YYYY",
};

describe("parseSearch", () => {
  it("reads the terms the suggestions write, comma separated", () => {
    expect(parseSearch("Payee: sto, Is: Cleared, Outflow: >=25,", settings)).toEqual([
      { kind: "payee", text: "sto" },
      { kind: "is", state: "cleared" },
      { kind: "amount", direction: "outflow", op: "gte", amount: 2500n },
    ]);
  });

  it("reads free text, with the amount a number stands for", () => {
    expect(parseSearch("ent,", settings)).toEqual([{ kind: "text", text: "ent", amount: null }]);
    expect(parseSearch("5", settings)).toEqual([{ kind: "text", text: "5", amount: 500n }]);
  });

  it("reads every labelled term, ignoring the label's case", () => {
    expect(
      parseSearch(
        "category: Split, Category: 🛒 Groceries, memo: rent, Account: Wallet, Flag: Red, " +
          "is: cleared or reconciled, Inflow: <=1000.50, Outflow: 25, On: 10/02/2026, " +
          "Before: 1/2/2026, After: 12/31/2025",
        settings,
      ),
    ).toEqual([
      { kind: "split" },
      { kind: "category", text: "🛒 Groceries" },
      { kind: "memo", text: "rent" },
      { kind: "account", text: "Wallet" },
      { kind: "flag", text: "Red" },
      { kind: "is", state: "cleared_or_reconciled" },
      { kind: "amount", direction: "inflow", op: "lte", amount: 100050n },
      { kind: "amount", direction: "outflow", op: "eq", amount: 2500n },
      { kind: "date", op: "on", date: "2026-10-02" },
      { kind: "date", op: "before", date: "2026-01-02" },
      { kind: "date", op: "after", date: "2025-12-31" },
    ]);
  });

  it("reads the approval terms", () => {
    expect(
      parseSearch(
        "Is: Approved, is: unapproved, IS: NEEDS CATEGORY, Is: Unapproved or Needs Category",
        settings,
      ),
    ).toEqual([
      { kind: "is", state: "approved" },
      { kind: "is", state: "unapproved" },
      { kind: "is", state: "needs_category" },
      { kind: "is", state: "unapproved_or_needs_category" },
    ]);
  });

  it("reads Income: as a month name, in full or three letters, with an optional year", () => {
    // The forms that match October.
    expect(
      parseSearch(
        "Income: October 2026, income: oct 2026, INCOME: OCTOBER 2026, Income: Oct, Income: may",
        settings,
      ),
    ).toEqual([
      { kind: "income", month: 10, year: 2026 },
      { kind: "income", month: 10, year: 2026 },
      { kind: "income", month: 10, year: 2026 },
      { kind: "income", month: 10, year: null },
      { kind: "income", month: 5, year: null },
    ]);
    // And the ones that matched nothing.
    expect(parseSearch("Income: 10/2026, Income: 2026-10, Income: sept 2026", settings)).toEqual([
      { kind: "text", text: "Income: 10/2026", amount: null },
      { kind: "text", text: "Income: 2026-10", amount: null },
      { kind: "text", text: "Income: sept 2026", amount: null },
    ]);
    expect(incomeTerm(10, 2026)).toBe("Income: October 2026");
  });

  it("searches a term it can't read as free text", () => {
    expect(parseSearch("Is: sideways, Outflow: lots, Colour: red, is:", settings)).toEqual([
      { kind: "text", text: "Is: sideways", amount: null },
      { kind: "text", text: "Outflow: lots", amount: null },
      { kind: "text", text: "Colour: red", amount: null },
      { kind: "text", text: "is:", amount: null },
    ]);
  });
});

describe("parseSearch dates", () => {
  it("completes a partial date in a typed On:/Before:/After: term", () => {
    // "On: 10/11," and "On: x1011," match the 10/11/2026 rows; "After: 10/14," shows 10/14/2026
    // onward.
    expect(
      parseSearch("On: 10/11, On: x1011, After: 10/14, Before: 5, On: 13", settings, TODAY),
    ).toEqual([
      { kind: "date", op: "on", date: "2026-10-11" },
      { kind: "date", op: "on", date: "2026-10-11" },
      { kind: "date", op: "after", date: "2026-10-14" },
      { kind: "date", op: "before", date: "2026-05-01" },
      { kind: "text", text: "On: 13", amount: null },
    ]);
  });
});

const TODAY = "2026-10-16";
const read = (format: DateFormat, ...texts: string[]) =>
  texts.map((t) => completeDate(t, format, TODAY));

describe("completeDate", () => {
  it("reads full dates in the budget's format", () => {
    expect(read("MM/DD/YYYY", "10/02/2026", "1/2/2030", "02/29/2028")).toEqual([
      "2026-10-02",
      "2030-01-02",
      "2028-02-29",
    ]);
    expect(read("DD/MM/YYYY", "02/10/2026")).toEqual(["2026-10-02"]);
    expect(read("YYYY-MM-DD", "2026-10-05", "2026/10/5")).toEqual(["2026-10-05", "2026-10-05"]);
    expect(read("DD.MM.YYYY", "2.10.2026")).toEqual(["2026-10-02"]);
  });

  it("reads each part from the next digits, in the format's order", () => {
    expect(
      read(
        "MM/DD/YYYY",
        "5",
        "05",
        "12",
        "1",
        "10/02",
        "10/2",
        "5/",
        "1/",
        "/5",
        "5a",
        "Card 5",
        "Before: 5",
        "105",
        "1005",
        "1231",
        "12312025",
        "10/2026",
        "010/02",
        "1 2",
        "10-02",
        "10.02",
        "5.5",
        "10/02 abc",
        "10/2/2026/5",
        "x-c11-135",
      ),
    ).toEqual([
      "2026-05-01",
      "2026-05-01",
      "2026-12-01",
      "2026-01-01",
      "2026-10-02",
      "2026-10-02",
      "2026-05-01",
      "2026-01-01",
      "2026-05-01",
      "2026-05-01",
      "2026-05-01",
      "2026-05-01",
      "2026-10-05",
      "2026-10-05",
      "2026-12-31",
      "2025-12-31",
      "2026-10-20",
      "2026-01-02",
      "2026-01-02",
      "2026-10-02",
      "2026-10-02",
      "2026-05-05",
      "2026-10-02",
      "2026-10-02",
      "2026-11-13",
    ]);
  });

  it("fills a missing year and month from today until the first part typed", () => {
    expect(read("DD/MM/YYYY", "5", "13", "5/", "25/12", "3112", "1/2/3", "10/02")).toEqual([
      "2026-10-05",
      "2026-10-13",
      "2026-10-05",
      "2026-12-25",
      "2026-12-31",
      "2026-02-01",
      "2026-02-10",
    ]);
    expect(
      read(
        "YYYY-MM-DD",
        "12",
        "13",
        "2026",
        "202610",
        "2026-10",
        "26-10-05",
        "10/02",
        "10-05",
        "5-3",
        "x-c11-1",
      ),
    ).toEqual([
      "2012-01-01",
      "2013-01-01",
      "2026-01-01",
      "2026-10-01",
      "2026-10-01",
      "2026-10-05",
      "2010-02-01",
      "2010-05-01",
      "2026-03-01",
      "2011-01-01",
    ]);
  });

  it("gives nothing for a month or day that doesn't exist", () => {
    expect(
      read(
        "MM/DD/YYYY",
        "13",
        "31",
        "0",
        "00",
        "100",
        "2026",
        "2026-10",
        "10/0",
        "10/00",
        "0/5",
        "10/32",
        "13/01",
        "2/30",
        "2/29",
        "2/29/2027",
        "abc",
        "",
      ),
    ).toEqual(Array(17).fill(null));
    expect(read("DD/MM/YYYY", "1231", "12/25", "10/2026", "x-c11-135")).toEqual(
      Array(4).fill(null),
    );
    expect(read("YYYY-MM-DD", "10-13", "2026-02-30", "x-c11-135")).toEqual(Array(3).fill(null));
  });

  it("keeps years within 20 of today's, putting this year in place of others", () => {
    expect(
      read(
        "MM/DD/YYYY",
        "10/02/25",
        "10/02/2025",
        "10/02/10",
        "10/02/30",
        "10/02/2006",
        "10/02/2046",
        "10/02/2005",
        "12/31/2005",
        "10/02/2047",
        "10/02/1999",
        "10/02/99",
        "10/02/68",
        "10/02/00",
        "10/02/3",
        "10/02/203",
        "10/02/20261",
      ),
    ).toEqual([
      "2025-10-02",
      "2025-10-02",
      "2010-10-02",
      "2030-10-02",
      "2006-10-02",
      "2046-10-02",
      "2026-10-02",
      "2026-12-31",
      "2026-10-02",
      "2026-10-02",
      "2026-10-02",
      "2026-10-02",
      "2026-10-02",
      "2026-10-02",
      "2026-10-02",
      "2026-10-02",
    ]);
    expect(read("YYYY-MM-DD", "5", "0", "1999", "2050", "1999-03", "2004-02-29")).toEqual([
      "2026-01-01",
      "2026-01-01",
      "2026-01-01",
      "2026-01-01",
      "2026-03-01",
      "2026-02-28",
    ]);
  });
});
