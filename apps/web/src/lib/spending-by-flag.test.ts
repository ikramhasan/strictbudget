import { describe, expect, it } from "vitest";
import type { CategoryList } from "./categories";
import { FLAG_COLOR, flagName } from "./flags";
import type { ReportSum } from "./reports";
import { exportRows, flagRows, monthBars, spendingByFlagSearchSchema } from "./spending-by-flag";

const sum = (keys: Partial<ReportSum>, net: number, count = 1): ReportSum => ({
  ...keys,
  outflow: String(Math.min(net, 0)),
  inflow: String(Math.max(net, 0)),
  net: String(net),
  count,
});

const flags = [
  { color: "blue" as const, name: "Japan trip" },
  { color: "green" as const, name: "Reimburse" },
  { color: "purple" as const, name: "" },
];

describe("flagName", () => {
  it("uses the custom name, else the colour, and calls null No flag", () => {
    expect(flagName("blue", flags)).toBe("Japan trip");
    expect(flagName("purple", flags)).toBe("Purple");
    expect(flagName("red", flags)).toBe("Red");
    expect(flagName(null, flags)).toBe("No flag");
  });
});

describe("flagRows", () => {
  it("lists used and named flags in flag order, unflagged spending aside", () => {
    const { rows, unflagged } = flagRows(
      [
        sum({ flag: "red" }, -5000, 2),
        sum({ flag: "blue" }, -12000, 3),
        sum({ flag: null }, -40500, 9),
        sum({ flag: "blue" }, 2000),
      ],
      flags,
    );
    // Green has a name but no lines (still listed); purple has neither.
    expect(rows.map((r) => [r.key, r.name, r.net, r.count])).toEqual([
      ["red", "Red", -5000n, 2],
      ["green", "Reimburse", 0n, 0],
      ["blue", "Japan trip", -10000n, 4],
    ]);
    expect(rows[2]?.color).toBe(FLAG_COLOR.blue);
    expect(unflagged).toEqual({ net: -40500n, count: 9 });
  });

  it("has nothing unflagged when every line is flagged", () => {
    expect(flagRows([sum({ flag: "red" }, -1)], []).unflagged).toEqual({ net: 0n, count: 0 });
  });
});

describe("monthBars", () => {
  it("gives every month of the range, spending positive and refunds negative", () => {
    const bars = monthBars([sum({ month: "2026-08" }, -700), sum({ month: "2026-10" }, 300, 2)], {
      from: "2026-08",
      to: "2026-10",
    });
    expect(bars).toEqual([
      { month: "2026-08", spent: 700n, count: 1 },
      { month: "2026-09", spent: 0n, count: 0 },
      { month: "2026-10", spent: -300n, count: 2 },
    ]);
  });
});

describe("the search", () => {
  it("keeps a known flag or none and drops anything else", () => {
    expect(spendingByFlagSearchSchema.parse({ flag: "blue" }).flag).toBe("blue");
    expect(spendingByFlagSearchSchema.parse({ flag: "none" }).flag).toBe("none");
    expect(spendingByFlagSearchSchema.parse({ flag: "pink" }).flag).toBeUndefined();
  });
});

describe("exportRows", () => {
  const category = (id: string, groupId: string, name: string) =>
    ({ id, groupId, name, hidden: false }) as CategoryList["groups"][number]["categories"][number];
  const categories: CategoryList = {
    readyToAssignCategoryId: "rta",
    uncategorizedCategoryId: "unc",
    groups: [
      {
        id: "g",
        name: "Needs",
        hidden: false,
        kind: null,
        categories: [category("food", "g", "Food"), category("fuel", "g", "Fuel")],
      },
    ],
  };

  it("orders flags as the app does with No flag last, categories in plan order", () => {
    const rows = exportRows(
      [
        sum({ flag: null, categoryId: "food" }, -100),
        sum({ flag: "blue", categoryId: "fuel" }, -2500, 2),
        sum({ flag: "blue", categoryId: "unc" }, -50),
        sum({ flag: "red", categoryId: "food" }, 1999),
      ],
      flags,
      categories,
      "comma_dot",
      "USD",
    );
    expect(rows).toEqual([
      ["Flag", "Category Group", "Category", "Spending", "Transactions"],
      ["Red", "Needs", "Food", { raw: "-19.99" }, { raw: "1" }],
      ["Japan trip", "", "Uncategorized", { raw: "0.50" }, { raw: "1" }],
      ["Japan trip", "Needs", "Fuel", { raw: "25.00" }, { raw: "2" }],
      ["No flag", "Needs", "Food", { raw: "1.00" }, { raw: "1" }],
    ]);
  });
});
