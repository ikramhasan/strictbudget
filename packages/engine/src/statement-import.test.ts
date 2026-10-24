import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyStatementOptions, ofxRows, qifRows, readOfx, readQif } from "./statement-import";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("OFX, QFX and QIF import", () => {
  it("reads an SGML bank statement, naming it by account type and last digits", () => {
    const statement = readOfx(fixture("bank.ofx"), "USD");
    expect(statement.source).toBe("CHECKING: ***2345");
    expect(ofxRows(statement)).toEqual([
      { date: "2026-10-14", amount: -1234n, payee: "OFX Shop", memo: "ofx memo" },
      { date: "2026-10-15", amount: 5000n, payee: "OFX Pay", memo: "pay memo" },
    ]);
  });

  it("reads an XML credit card statement, a PAYEE aggregate and a decimal comma", () => {
    const statement = readOfx(fixture("card.qfx"), "USD");
    expect(statement.source).toBe("CREDIT CARD: ***9876");
    expect(ofxRows(statement)).toEqual([
      { date: "2026-10-03", amount: -123456n, payee: "Hardware Store", memo: "" },
      { date: "2026-10-04", amount: 2500n, payee: "Refund", memo: "returned item" },
    ]);
  });

  it("refuses files that aren't OFX", () => {
    expect(() => readOfx("date,amount\n", "USD")).toThrow();
  });

  it("reads QIF records in the file's date format", () => {
    const statement = readQif(fixture("bank.qif"), "USD", "comma_dot");
    expect(statement.source).toBe("Bank");
    // "10/15'2026" reads like "10/15/2026", so the file has one format.
    expect(statement.entries.map((e) => e.date)).toEqual(["10/14/2026", "10/15/2026"]);
    expect(qifRows(statement, "MM/DD/YYYY")).toEqual([
      { date: "2026-10-14", amount: -725n, payee: "QIF Shop", memo: "qif memo" },
      { date: "2026-10-15", amount: 2000n, payee: "QIF Pay", memo: "" },
    ]);
  });

  it("reads a QIF file without a closing caret, and U amounts", () => {
    const statement = readQif("!Type:CCard\nD01/02/2026\nU-1,000.00\nPShop", "USD", "comma_dot");
    expect(statement).toEqual({
      source: "CCard",
      entries: [{ date: "01/02/2026", amount: -100000n, payee: "Shop", memo: "" }],
    });
  });

  it("applies Import Memos, Swap Payee and Memo and Swap Inflow and Outflow", () => {
    const rows = [
      { date: "2026-10-14", amount: -725n, payee: "Shop", memo: "note" },
      { date: "2026-10-15", amount: 2000n, payee: "Pay", memo: "" },
    ];
    const none = { importMemos: true, swapPayeeMemo: false, swapInflowOutflow: false };
    expect(applyStatementOptions(rows, none)).toEqual(rows);
    expect(applyStatementOptions(rows, { ...none, importMemos: false }).map((r) => r.memo)).toEqual(
      ["", ""],
    );
    expect(
      applyStatementOptions(rows, { ...none, swapPayeeMemo: true }).map((r) => [r.payee, r.memo]),
    ).toEqual([
      ["note", "Shop"],
      ["", "Pay"],
    ]);
    expect(
      applyStatementOptions(rows, { ...none, swapInflowOutflow: true }).map((r) => r.amount),
    ).toEqual([725n, -2000n]);
  });
});
