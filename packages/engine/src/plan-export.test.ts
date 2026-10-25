import { describe, expect, it } from "vitest";
import { formatAmount } from "./format-amount";
import {
  exportCategoryColumns,
  exportCleared,
  exportDateStamp,
  exportFlag,
  exportMonthLabel,
  exportSanitize,
  exportSeparator,
  exportSplitMemo,
  exportText,
  planExportNames,
  selectedExportName,
} from "./plan-export";

describe("plan export", () => {
  it("uses a tab for comma-decimal formats", () => {
    expect(exportSeparator("comma_dot")).toBe(",");
    expect(exportSeparator("dot_comma")).toBe("\t");
    expect(exportSeparator("space_comma")).toBe("\t");
  });

  it("quotes text and guards formulas", () => {
    expect(exportText('Say "hi"')).toBe('"Say ""hi"""');
    expect(exportSanitize("=SUM(A1)")).toBe("\\=SUM(A1)");
    expect(exportSanitize("  -5")).toBe("\\-5");
    expect(exportSanitize("@home + more")).toBe("\\@home + more");
    expect(exportSanitize("a=b")).toBe("a=b");
  });

  it("writes amounts without group separators", () => {
    const settings = {
      numberFormat: "comma_dot",
      currencySymbolPosition: "before",
      dateFormat: "MM/DD/YYYY",
    } as const;
    expect(formatAmount({ amount: -123456n, currency: "USD" }, settings, { grouping: false })).toBe(
      "-$1234.56",
    );
    expect(
      formatAmount(
        { amount: 123456789n, currency: "EUR" },
        { numberFormat: "dot_comma", currencySymbolPosition: "none", dateFormat: "DD.MM.YYYY" },
        { grouping: false },
      ),
    ).toBe("1234567,89");
  });

  it("labels months, categories, flags and cleared states", () => {
    expect(exportMonthLabel("2026-10")).toBe("Oct 2026");
    expect(exportMonthLabel("2027-01")).toBe("Jan 2027");
    expect(
      exportCategoryColumns({
        name: "Groceries",
        group: "Needs",
        hidden: false,
        internalKind: null,
      }),
    ).toEqual(["Needs: Groceries", "Needs", "Groceries"]);
    expect(
      exportCategoryColumns({ name: "Old", group: "Needs", hidden: true, internalKind: null }),
    ).toEqual(["Hidden Categories: Old", "Hidden Categories", "Old"]);
    expect(
      exportCategoryColumns({
        name: "x",
        group: "x",
        hidden: false,
        internalKind: "ready_to_assign",
      }),
    ).toEqual(["Inflow: Ready to Assign", "Inflow", "Ready to Assign"]);
    expect(
      exportCategoryColumns({
        name: "x",
        group: "x",
        hidden: false,
        internalKind: "uncategorized",
      }),
    ).toEqual(["", "", ""]);
    expect(exportCategoryColumns(null)).toEqual(["", "", ""]);
    expect(exportFlag(null, undefined)).toBe("");
    expect(exportFlag("red", undefined)).toBe("Red");
    expect(exportFlag("red", "Reimburse")).toBe("Reimburse");
    expect(exportCleared("reconciled")).toBe("Reconciled");
    expect(exportCleared("uncleared")).toBe("Uncleared");
    expect(exportSplitMemo(0, 2, "")).toBe("Split (1/2) ");
  });

  it("names the files", () => {
    expect(planExportNames("Bob's Plan", "2026-10-17 09-05", ",")).toEqual({
      zip: "strictbudget Export - Bob s Plan as of 2026-10-17 09-05.zip",
      plan: "Bob s Plan as of 2026-10-17 09-05 - Plan.csv",
      register: "Bob s Plan as of 2026-10-17 09-05 - Register.csv",
    });
    expect(selectedExportName("Bob's Plan", "2026-10-17 09-05", "\t")).toBe(
      "Selected Transactions for Bob's Plan as of 2026-10-17 09-05.tsv",
    );
    expect(exportDateStamp(new Date())).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}-\d{2}$/);
  });
});
