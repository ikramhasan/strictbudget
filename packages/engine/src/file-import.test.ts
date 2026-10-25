import { describe, expect, it } from "vitest";
import {
  CSV_DATE_FORMATS,
  csvColumnNames,
  csvRows,
  guessCsvMapping,
  importIds,
  parseCsvText,
  parseImportAmount,
  parseImportDate,
  possibleDateFormats,
} from "./file-import";

describe("CSV import", () => {
  it("reads comma and semicolon files, quotes and a BOM", () => {
    expect(parseCsvText('﻿Date,Description,Amount\n10/10/2026,"Shop, Inc",-4.50\n\n')).toEqual([
      ["Date", "Description", "Amount"],
      ["10/10/2026", "Shop, Inc", "-4.50"],
    ]);
    expect(parseCsvText('Posted;Payee;Debit\n2026-10-13;Hardware;"$1,234.56"\n')).toEqual([
      ["Posted", "Payee", "Debit"],
      ["2026-10-13", "Hardware", "$1,234.56"],
    ]);
    expect(parseCsvText("a\tb\n1\t2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("names columns by the lowercased header, or A, B, C without one", () => {
    const table = [
      ["Date", "Description", "Memo"],
      ["x", "y", "z"],
    ];
    expect(csvColumnNames(table, false)).toEqual(["date", "description", "memo"]);
    expect(csvColumnNames(table, true)).toEqual(["A", "B", "C"]);
  });

  it("guesses date, payee (or description) and memo, and nothing else", () => {
    expect(guessCsvMapping(["date", "description", "memo", "amount"])).toEqual({
      date: 0,
      payee: 1,
      memo: 2,
      outflow: null,
      inflow: null,
    });
    expect(guessCsvMapping(["posted", "payee", "debit", "credit"])).toEqual({
      date: null,
      payee: 1,
      memo: null,
      outflow: null,
      inflow: null,
    });
  });

  it("reads the offered date formats", () => {
    expect(parseImportDate("10/12/2026", "MM/DD/YYYY")).toBe("2026-10-12");
    expect(parseImportDate("10/12/2026", "DD/MM/YYYY")).toBe("2026-12-10");
    expect(parseImportDate("1/5/2026", "MM/DD/YYYY")).toBe("2026-01-05");
    expect(parseImportDate("05/Oct/2026", "DD/MMM/YYYY")).toBe("2026-10-05");
    expect(parseImportDate("05/October/2026", "DD/MMMM/YYYY")).toBe("2026-10-05");
    expect(parseImportDate("05-10-26", "DD-MM-YY")).toBe("2026-10-05");
    expect(parseImportDate("05.10.2026", "DD.MM.YYYY")).toBe("2026-10-05");
    expect(parseImportDate("10/05'2026", "MM/DD'YYYY")).toBe("2026-10-05");
    expect(parseImportDate("2026-10-13", "YYYY-MM-DD")).toBe("2026-10-13");
    expect(parseImportDate("13/13/2026", "MM/DD/YYYY")).toBeNull();
    expect(parseImportDate("Posted", "YYYY-MM-DD")).toBeNull();
  });

  it("offers every format that reads all the dates", () => {
    expect(possibleDateFormats(["10/10/2026", "10/11/2026"])).toEqual(["MM/DD/YYYY", "DD/MM/YYYY"]);
    expect(possibleDateFormats(["10/13/2026"])).toEqual(["MM/DD/YYYY"]);
    expect(possibleDateFormats(["2026-10-13"])).toEqual(["YYYY-MM-DD"]);
    expect(possibleDateFormats(["Posted"])).toEqual([]);
    expect(CSV_DATE_FORMATS).toHaveLength(13);
  });

  it("parses amounts into exact minor units in the budget's number format", () => {
    expect(parseImportAmount("$1,234.56", "USD", "comma_dot")).toBe(123456n);
    expect(parseImportAmount("-4.50", "USD", "comma_dot")).toBe(-450n);
    expect(parseImportAmount("1.234,56 €", "EUR", "dot_comma")).toBe(123456n);
    expect(parseImportAmount("12.00-", "USD", "comma_dot")).toBe(-1200n);
    expect(parseImportAmount("1000", "JPY", "comma_dot")).toBe(1000n);
    expect(parseImportAmount("0.001", "USD", "comma_dot")).toBeNull();
    expect(parseImportAmount("", "USD", "comma_dot")).toBeNull();
    expect(parseImportAmount("n/a", "USD", "comma_dot")).toBeNull();
    expect(parseImportAmount("(45.10)", "USD", "comma_dot")).toBeNull();
  });

  const table = parseCsvText(
    "Date,Description,Memo,Amount,Debit,Credit\n10/10/2026,Coffee,latte,-4.50,4.50,\n10/11/2026,Employer,pay,1200.00,,1200.00\n10/12/2026,Zero,,0.00,,\nbad,Oops,,1,,\n",
  );
  const options = {
    noHeaderRow: false,
    swapInflowOutflow: false,
    dateFormat: "MM/DD/YYYY" as const,
  };

  it("maps one signed column to both outflow and inflow, keeping $0 rows", () => {
    const { rows, errors } = csvRows(
      table,
      { date: 0, payee: 1, memo: 2, outflow: 3, inflow: 3 },
      options,
      "USD",
      "comma_dot",
    );
    expect(rows.map((r) => [r.date, r.amount, r.payee, r.memo])).toEqual([
      ["2026-10-10", -450n, "Coffee", "latte"],
      ["2026-10-11", 120000n, "Employer", "pay"],
      ["2026-10-12", 0n, "Zero", ""],
    ]);
    expect(errors).toEqual([{ line: 5, reason: "date" }]);
  });

  it("reads separate outflow and inflow columns, and swaps them on request", () => {
    const mapping = { date: 0, payee: 1, memo: null, outflow: 4, inflow: 5 };
    const read = csvRows(table, mapping, options, "USD", "comma_dot");
    expect(read.rows.map((r) => r.amount)).toEqual([-450n, 120000n]);
    // The $0 row has neither: it can't be read.
    expect(read.errors).toEqual([
      { line: 4, reason: "amount" },
      { line: 5, reason: "date" },
    ]);
    const swapped = csvRows(
      table,
      mapping,
      { ...options, swapInflowOutflow: true },
      "USD",
      "comma_dot",
    );
    expect(swapped.rows.map((r) => r.amount)).toEqual([450n, -120000n]);
  });

  it("gives each row an id from amount, date and occurrence", () => {
    const row = { date: "2026-10-10", amount: -450n, payee: "A", memo: "" };
    expect(importIds([row, { ...row, payee: "B" }, { ...row, amount: 1n }])).toEqual([
      "EC:-450:2026-10-10:1",
      "EC:-450:2026-10-10:2",
      "EC:1:2026-10-10:1",
    ]);
  });
});
