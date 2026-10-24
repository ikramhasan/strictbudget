import { parseCsvText } from "@strictbudget/engine";
import { describe, expect, it } from "vitest";
import { resultMessage } from "@/components/file-import";
import { dateFormatChoices, importFileKind, initialCsvSetup } from "./file-import";

const table = parseCsvText(
  "Date,Description,Memo,Amount\n10/10/2026,Coffee,latte,-4.50\n10/11/2026,Employer,pay,1200\n",
);

describe("file import", () => {
  it("knows the file types File Import takes", () => {
    expect(["a.csv", "b.TSV", "c.ofx", "d.QFX", "e.qif", "f.pdf"].map(importFileKind)).toEqual([
      "csv",
      "csv",
      "ofx",
      "ofx",
      "qif",
      null,
    ]);
  });

  it("starts from a guess, leaving an unclear date format to ask about", () => {
    expect(initialCsvSetup(table, null)).toEqual({
      mapping: { date: 0, payee: 1, memo: 2, outflow: null, inflow: null },
      noHeaderRow: false,
      swapInflowOutflow: false,
      dateFormat: null,
    });
    const iso = parseCsvText("date,payee\n2026-10-13,Shop\n");
    expect(initialCsvSetup(iso, null).dateFormat).toBe("YYYY-MM-DD");
  });

  it("uses the account's remembered settings for the same columns only", () => {
    const remembered = {
      columns: ["date", "description", "memo", "amount"],
      mapping: { date: 0, payee: 1, memo: 2, outflow: 3, inflow: 3 },
      noHeaderRow: false,
      swapInflowOutflow: true,
      dateFormat: "MM/DD/YYYY" as const,
    };
    expect(initialCsvSetup(table, remembered)).toMatchObject({
      mapping: remembered.mapping,
      swapInflowOutflow: true,
      dateFormat: "MM/DD/YYYY",
    });
    const other = parseCsvText("Posted,Payee,Debit\n2026-10-13,Shop,1\n");
    expect(initialCsvSetup(other, remembered).mapping.outflow).toBeNull();
  });

  it("offers the first date's readings, or every format when none fits", () => {
    expect(dateFormatChoices("10/10/2026", ["MM/DD/YYYY", "DD/MM/YYYY"], [])).toEqual([
      { format: "MM/DD/YYYY", label: "October 10, 2026 (MM/DD/YYYY)" },
      { format: "DD/MM/YYYY", label: "October 10, 2026 (DD/MM/YYYY)" },
    ]);
    expect(
      dateFormatChoices("Posted", [], ["YYYY-MM-DD", "DD.MM.YYYY"]).map((c) => c.label),
    ).toEqual(["YYYY-MM-DD", "DD.MM.YYYY"]);
  });

  it("words the result", () => {
    expect(resultMessage(4, 4)).toEqual({
      title: "Import Successful",
      message: "4 transactions have been successfully imported.",
    });
    expect(resultMessage(4, 0).title).toBe("Import Matched");
    expect(resultMessage(1, 1).message).toBe("1 transaction has been successfully imported.");
    expect(resultMessage(3, 2, 1).message).toBe(
      "2 transactions have been successfully imported. 1 previously imported transaction has been matched.",
    );
  });
});
