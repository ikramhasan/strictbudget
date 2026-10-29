import type { BudgetMonth } from "@strictbudget/engine";
import { describe, expect, it } from "vitest";
import { goalFromInput, goalInputText, incomeSources, OTHER_SOURCES } from "./savings-rate";

const months = ["2026-08", "2026-09", "2026-10"] as BudgetMonth[];

describe("incomeSources", () => {
  it("keeps the five largest payees and folds the rest into Other, exactly", () => {
    const payees = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: `Payee ${i}` }));
    const sums = payees.flatMap((p, i) => [
      { month: "2026-08", payeeId: p.id, net: String((i + 1) * 1000) },
      { month: "2026-10", payeeId: p.id, net: String((i + 1) * 101) },
    ]);
    sums.push({ month: "2026-09", payeeId: null as unknown as string, net: "5" });
    const { sources, total, grandTotal } = incomeSources({
      months,
      current: "2026-10",
      sums,
      payees,
    });
    expect(sources.map((s) => s.name)).toEqual([
      "Payee 6",
      "Payee 5",
      "Payee 4",
      "Payee 3",
      "Payee 2",
      OTHER_SOURCES,
    ]);
    const other = sources.at(-1);
    // Payees 1 and 0, and the 5 with no payee.
    expect(other?.folded).toBe(3);
    expect(other?.months).toEqual([3000n, 5n, 303n]);
    const summed = months.map((_, i) => sources.reduce((s, src) => s + (src.months[i] ?? 0n), 0n));
    expect(summed).toEqual(total);
    expect(grandTotal).toBe(28000n + 5n + 2828n);
  });

  it("gives each source's share and the months it came in", () => {
    const { sources, monthsCounted } = incomeSources({
      months,
      current: "2026-09",
      sums: [
        { month: "2026-08", payeeId: "job", net: "3000" },
        { month: "2026-09", payeeId: "job", net: "3000" },
        { month: "2026-10", payeeId: "job", net: "3000" },
        { month: "2026-09", payeeId: "gift", net: "1000" },
      ],
      payees: [
        { id: "job", name: "Employer" },
        { id: "gift", name: "Gran" },
      ],
    });
    // October is still to come, so it doesn't count as a month received or missed.
    expect(monthsCounted).toBe(2);
    expect(sources).toMatchObject([
      { name: "Employer", total: 9000n, share: 90, monthsReceived: 2 },
      { name: "Gran", total: 1000n, share: 10, monthsReceived: 1 },
    ]);
  });

  it("has no shares without income", () => {
    const { sources } = incomeSources({
      months,
      current: "2026-10",
      sums: [{ month: "2026-08", payeeId: "x", net: "-100" }],
      payees: [{ id: "x", name: "Clawback" }],
    });
    expect(sources[0]?.share).toBeNull();
  });
});

describe("goalFromInput", () => {
  it("reads a percent as basis points", () => {
    expect(goalFromInput("20")).toBe(2000);
    expect(goalFromInput("12.5")).toBe(1250);
    expect(goalFromInput("12,25 %")).toBe(1225);
    expect(goalFromInput("100")).toBe(10000);
    expect(goalFromInput("")).toBeNull();
  });

  it("refuses anything else", () => {
    expect(goalFromInput("101")).toBeUndefined();
    expect(goalFromInput("-5")).toBeUndefined();
    expect(goalFromInput("1.234")).toBeUndefined();
    expect(goalFromInput("abc")).toBeUndefined();
  });

  it("shows basis points as a percent", () => {
    expect(goalInputText(1250)).toBe("12.5");
    expect(goalInputText(null)).toBe("");
  });
});
