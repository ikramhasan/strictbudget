import { describe, expect, it } from "vitest";
import { layoutColumns, registerColumns } from "./register-columns";

const account = registerColumns(false).filter((c) => c !== "enteredBy" && c !== "review");
const all = registerColumns(true).filter((c) => c !== "enteredBy" && c !== "review");
const fit = (
  columns: typeof account,
  available: number | null,
  options: { dateFormat?: string } = {},
) =>
  layoutColumns(columns, {
    dragged: {},
    available,
    dateFormat: options.dateFormat ?? "MM/DD/YYYY",
  });
const sum = (widths: Partial<Record<string, number>>) =>
  Object.values(widths).reduce((total = 0, w) => total + (w ?? 0), 0) ?? 0;

describe("layoutColumns", () => {
  it("shows every column side by side down to about 1000px of register", () => {
    // A 1280px window with the sidebar open.
    const layout = fit(account, 1006);
    expect(layout.columns).toEqual(account);
    // Memo takes what's left; the rest leave it room to read.
    expect(layout.widths.memo).toBeUndefined();
    expect(1006 - sum(layout.widths)).toBeGreaterThanOrEqual(100);
    expect(layout.widths.payee).toBeGreaterThanOrEqual(132);
    expect(layout.widths.category).toBeGreaterThanOrEqual(140);
    // A 1200px window: still Memo, Outflow, Inflow and Balance.
    expect(fit(account, 926).columns).toEqual(account);
  });

  it("narrows All Accounts' account column to the name before dropping Memo", () => {
    const wide = fit(all, 1006);
    expect(wide.columns).toEqual(all);
    expect(wide.accountCompact).toBe(false);
    expect(wide.widths.account).toBe(112);
    // A 1200px window.
    const layout = fit(all, 926);
    expect(layout.columns).toEqual(all);
    expect(layout.accountCompact).toBe(true);
    expect(layout.widths.account).toBe(84);
    expect(layout.memoInPayee).toBe(false);
  });

  it("then drops Memo into the payee cell before Payee and Category get cramped", () => {
    const layout = fit(account, 900);
    expect(layout.columns).not.toContain("memo");
    expect(layout.memoInPayee).toBe(true);
    expect(layout.columns).toEqual(expect.arrayContaining(["outflow", "inflow", "balance"]));
    // Category takes what's left; the payee keeps a comfortable width.
    expect(layout.widths.category).toBeUndefined();
    expect(layout.widths.payee).toBeGreaterThanOrEqual(132);
    expect(900 - sum(layout.widths)).toBeGreaterThanOrEqual(140);
    // The approval column (while a row needs it) doesn't fold the money columns.
    const withReview = layoutColumns(
      registerColumns(false).filter((c) => c !== "enteredBy"),
      { dragged: {}, available: 900, dateFormat: "MM/DD/YYYY" },
    );
    expect(withReview.columns).toContain("outflow");
  });

  it("then folds Outflow and Inflow into Amount, then drops the balance", () => {
    const folded = fit(account, 800);
    expect(folded.columns).toContain("amount");
    expect(folded.columns).not.toContain("outflow");
    expect(folded.columns).not.toContain("inflow");
    expect(folded.columns).toContain("balance");
    expect(folded.widths.amount).toBe(104);

    const narrower = fit(account, 700);
    expect(narrower.columns).toContain("amount");
    expect(narrower.columns).not.toContain("balance");
  });

  it("keeps All Accounts' account names, without scrolling, at 1024px", () => {
    // A 1040px window with the sidebar open: the account's name, a signed amount.
    const at1040 = fit(all, 766);
    expect(at1040.accountCompact).toBe(true);
    expect(at1040.widths.account).toBe(84);
    expect(at1040.columns).toContain("amount");

    // A 1024px window with the sidebar open.
    const narrow = fit(account, 750);
    expect(narrow.columns).toContain("amount");
    expect(narrow.minWidth).toBeLessThanOrEqual(750);
    const layout = fit(all, 750);
    expect(layout.columns).toContain("account");
    expect(layout.widths.account).toBe(84);
    expect(layout.minWidth).toBeLessThanOrEqual(750);
  });

  it("sizes the date for its editor, so it's the same width while a row is edited", () => {
    expect(fit(account, 1200).widths.date).toBe(112);
    expect(fit(account, 1200, { dateFormat: "YYYY-MM-DD" }).widths.date).toBe(116);
  });

  it("keeps a dragged width and lays out the full set before the register is measured", () => {
    const layout = layoutColumns(account, {
      dragged: { payee: 240 },
      available: null,
      dateFormat: "MM/DD/YYYY",
    });
    expect(layout.columns).toEqual(account);
    expect(layout.widths.payee).toBe(240);
  });
});
