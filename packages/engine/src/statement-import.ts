import { parseSync } from "ofx-js";
import type { CurrencyCode } from "./currency";
import type { ImportRow } from "./file-import";
import { type CsvDateFormat, parseImportAmount, parseImportDate } from "./file-import";
import type { NumberFormat } from "./format-settings";

/**
 * A bank statement file (OFX/QFX or QIF), read: where it says it's from ("CHECKING: ***2345", or
 * the QIF type such as "Bank") and its transactions with their dates as written.
 */
export interface Statement {
  source: string;
  entries: StatementEntry[];
}

export interface StatementEntry {
  /** As written: OFX's YYYYMMDD…, QIF's in whatever format the bank used. */
  date: string;
  amount: bigint;
  payee: string;
  memo: string;
}

type Loose = Record<string, unknown>;
const asList = (v: unknown): Loose[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? (v as Loose[]) : [v as Loose];
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * OFX amounts use a decimal point, or a comma when there's no point ("12,34"), as some banks
 * write them; grouping isn't allowed.
 */
function ofxAmount(value: string, currency: CurrencyCode): bigint | null {
  const decimalComma = value.includes(",") && !value.includes(".");
  return parseImportAmount(value, currency, decimalComma ? "dot_comma" : "comma_dot");
}

/**
 * Reads an OFX or QFX file (SGML 1.x or XML 2.x) with ofx-js: every bank and credit card
 * statement's transactions (`STMTTRN`: `DTPOSTED`, `TRNAMT`, `NAME` or `PAYEE.NAME`, `MEMO`).
 * Throws when it isn't OFX or has no statement.
 */
export function readOfx(data: string, currency: CurrencyCode): Statement {
  const root = (parseSync(data) as unknown as Loose).OFX as Loose | undefined;
  if (!root) throw new Error("Not an OFX file");
  const statements: { source: string; list: Loose[] }[] = [];
  for (const response of asList((root.BANKMSGSRSV1 as Loose | undefined)?.STMTTRNRS)) {
    const rs = response.STMTRS as Loose | undefined;
    if (!rs) continue;
    const from = (rs.BANKACCTFROM ?? {}) as Loose;
    statements.push({
      source: accountLabel(text(from.ACCTTYPE) || "BANK", text(from.ACCTID)),
      list: asList((rs.BANKTRANLIST as Loose | undefined)?.STMTTRN),
    });
  }
  for (const response of asList((root.CREDITCARDMSGSRSV1 as Loose | undefined)?.CCSTMTTRNRS)) {
    const rs = response.CCSTMTRS as Loose | undefined;
    if (!rs) continue;
    const from = (rs.CCACCTFROM ?? {}) as Loose;
    statements.push({
      source: accountLabel("CREDIT CARD", text(from.ACCTID)),
      list: asList((rs.BANKTRANLIST as Loose | undefined)?.STMTTRN),
    });
  }
  if (statements.length === 0) throw new Error("No statement in this OFX file");
  const entries: StatementEntry[] = [];
  for (const { list } of statements) {
    for (const t of list) {
      const amount = ofxAmount(text(t.TRNAMT), currency);
      const date = text(t.DTPOSTED).slice(0, 8);
      if (amount === null || !/^\d{8}$/.test(date)) continue;
      const payee = text(t.NAME) || text((t.PAYEE as Loose | undefined)?.NAME);
      entries.push({ date, amount, payee, memo: text(t.MEMO) });
    }
  }
  return { source: statements.map((s) => s.source).join(", "), entries };
}

function accountLabel(type: string, id: string) {
  return id ? `${type}: ***${id.slice(-4)}` : type;
}

/**
 * Reads a QIF file. Hand-written: QIF is a plain line format (a `!Type:` header, then records of
 * one-letter fields ended by `^`), and no maintained parser exists (qif-ts was last released in
 * 2022). Split lines (`S`/`$`) aren't read: the transaction's total (`T`) is imported.
 */
export function readQif(
  data: string,
  currency: CurrencyCode,
  numberFormat: NumberFormat,
): Statement {
  let source = "";
  const entries: StatementEntry[] = [];
  let record: Partial<Record<"D" | "T" | "U" | "P" | "M", string>> = {};
  const finish = () => {
    const raw = record.T ?? record.U;
    const amount = raw === undefined ? null : parseImportAmount(raw, currency, numberFormat);
    if (record.D && amount !== null) {
      entries.push({
        date: qifDate(record.D),
        amount,
        payee: record.P ?? "",
        memo: record.M ?? "",
      });
    }
    record = {};
  };
  for (const rawLine of data.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line === "") continue;
    if (line.startsWith("!")) {
      const type = /^!Type:(.*)$/i.exec(line);
      if (type && !source) source = (type[1] ?? "").trim();
      continue;
    }
    if (line === "^") {
      finish();
      continue;
    }
    const code = line[0] as string;
    if (code === "D" || code === "T" || code === "U" || code === "P" || code === "M") {
      record[code] = line.slice(1).trim();
    }
  }
  if (Object.keys(record).length > 0) finish();
  return { source: source || "QIF", entries };
}

/**
 * QIF writes the year after an apostrophe in some dates ("10/15'2026") and pads with spaces
 * ("1/ 5/2026"); a file mixing "10/14/2026" and "10/15'2026" reads as one format.
 */
function qifDate(value: string) {
  return value.replace(/'/g, "/").replace(/\s+/g, "");
}

/** OFX dates as YYYY-MM-DD. */
export function ofxRows(statement: Statement): ImportRow[] {
  return statement.entries.map((e) => ({
    ...e,
    date: `${e.date.slice(0, 4)}-${e.date.slice(4, 6)}-${e.date.slice(6, 8)}`,
  }));
}

/** QIF entries read with `format`; ones whose date doesn't read are left out. */
export function qifRows(statement: Statement, format: CsvDateFormat): ImportRow[] {
  return statement.entries.flatMap((e) => {
    const date = parseImportDate(e.date, format);
    return date ? [{ ...e, date }] : [];
  });
}

export interface StatementOptions {
  importMemos: boolean;
  swapPayeeMemo: boolean;
  swapInflowOutflow: boolean;
}

export function applyStatementOptions(
  rows: readonly ImportRow[],
  options: StatementOptions,
): ImportRow[] {
  return rows.map((row) => {
    const [payee, memo] = options.swapPayeeMemo ? [row.memo, row.payee] : [row.payee, row.memo];
    return {
      ...row,
      payee,
      memo: options.importMemos ? memo : "",
      amount: options.swapInflowOutflow ? -row.amount : row.amount,
    };
  });
}
