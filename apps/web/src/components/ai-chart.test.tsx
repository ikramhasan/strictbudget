import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BudgetProvider } from "@/lib/budget-context";
import type { Budget } from "@/lib/budgets";
import { AiChart, aiChartColors, chartSpec } from "./ai-chart";

afterEach(cleanup);

const budget = {
  id: "b",
  name: "Household",
  currency: "USD",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
  role: "owner",
  archivedAt: null,
  lastUsedAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
} as Budget;

const spec = {
  type: "pie",
  title: "Spending by category",
  description: "October 2026",
  valueFormat: "money",
  data: [
    { label: "Rent/Mortgage", spent: 140000 },
    { label: "Groceries", spent: 29247 },
  ],
  series: [{ key: "spent", label: "Spent" }],
};

describe("AiChart", () => {
  it("reads a tool call's input as a chart, and nothing else", () => {
    expect(chartSpec(spec)?.type).toBe("pie");
    expect(chartSpec({ ...spec, type: "histogram" })).toBeNull();
    expect(chartSpec("not a chart")).toBeNull();
  });

  it("titles the chart and gives screen readers its numbers, in the budget's money", () => {
    const parsed = chartSpec(spec);
    if (!parsed) throw new Error("no spec");
    render(
      <BudgetProvider budget={budget}>
        <AiChart spec={parsed} />
      </BudgetProvider>,
    );
    expect(screen.getByText("October 2026")).toBeTruthy();
    const table = screen.getByRole("table", { name: "Spending by category" });
    expect(table.textContent).toContain("Rent/Mortgage$1,400.00");
    expect(table.textContent).toContain("Groceries$292.47");
  });

  it("gives income and spending blue and orange, the rest the palette without repeats", () => {
    expect(aiChartColors(["Spending", "Income", "Savings"])).toEqual([
      "var(--report-2)",
      "var(--report-1)",
      "var(--report-3)",
    ]);
    expect(aiChartColors(["Rent", "Food"])).toEqual(["var(--report-1)", "var(--report-2)"]);
    const many = aiChartColors(Array.from({ length: 10 }, (_, i) => `C${i}`));
    expect(new Set(many.slice(0, 8)).size).toBe(8);
    expect(many.slice(8)).toEqual(["var(--report-other)", "var(--report-other)"]);
  });
});
