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
  it("shows every money column side by side when the register is wide enough", () => {
    // A 1440px window with the sidebar open.
    const layout = fit(account, 1166);
    expect(layout.columns).toEqual(account);
    // Memo takes what's left; the rest leave it room to read.
    expect(layout.widths.memo).toBeUndefined();
    expect(1166 - sum(layout.widths)).toBeGreaterThanOrEqual(140);
    expect(layout.widths.payee).toBeGreaterThanOrEqual(176);
    expect(layout.widths.category).toBeGreaterThanOrEqual(200);
  });

  it("drops Memo into the payee cell before Payee and Category get cramped", () => {
    // A 1280px window with the sidebar open: Memo would fit, but only by squeezing the payee.
    const layout = fit(account, 998);
    expect(layout.columns).not.toContain("memo");
    expect(layout.memoInPayee).toBe(true);
    expect(layout.columns).toEqual(expect.arrayContaining(["outflow", "inflow", "balance"]));
    // Category takes what's left; the payee keeps a comfortable width.
    expect(layout.widths.category).toBeUndefined();
    expect(layout.widths.payee).toBeGreaterThanOrEqual(176);
    expect(998 - sum(layout.widths)).toBeGreaterThanOrEqual(200);
    expect(fit(account, 1166).memoInPayee).toBe(false);
    // The approval column (while a row needs it) doesn't fold the money columns.
    const withReview = layoutColumns(
      registerColumns(false).filter((c) => c !== "enteredBy"),
      { dragged: {}, available: 998, dateFormat: "MM/DD/YYYY" },
    );
    expect(withReview.columns).toContain("outflow");
  });

  it("then folds Outflow and Inflow into Amount, then drops the balance", () => {
    const folded = fit(account, 920);
    expect(folded.columns).toContain("amount");
    expect(folded.columns).not.toContain("outflow");
    expect(folded.columns).not.toContain("inflow");
    expect(folded.columns).toContain("balance");
    expect(folded.widths.amount).toBe(104);

    const narrower = fit(account, 860);
    expect(narrower.columns).toContain("amount");
    expect(narrower.columns).not.toContain("balance");
  });

  it("shows only account logos last, without scrolling at 1024px", () => {
    // A 1024px window with the sidebar open.
    const narrow = fit(account, 750);
    expect(narrow.columns).toContain("amount");
    expect(narrow.columns).not.toContain("balance");
    expect(narrow.minWidth).toBeLessThanOrEqual(750);

    const layout = fit(all, 750);
    expect(layout.accountIcon).toBe(true);
    expect(layout.widths.account).toBe(36);
    expect(layout.minWidth).toBeLessThanOrEqual(750);
    expect(fit(all, 1006).accountIcon).toBe(false);
  });

  it("sizes the date for its editor, so it's the same width while a row is edited", () => {
    expect(fit(account, 1200).widths.date).toBe(120);
    expect(fit(account, 1200, { dateFormat: "YYYY-MM-DD" }).widths.date).toBe(128);
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
