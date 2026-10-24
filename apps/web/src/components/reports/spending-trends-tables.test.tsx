import { averageMonthlySpending, trendMonths } from "@strictbudget/engine";
import { TooltipProvider } from "@strictbudget/ui/components/tooltip";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BudgetProvider } from "@/lib/budget-context";
import type { Budget } from "@/lib/budgets";
import type { TrendChartData } from "./spending-trends-charts";
import { TrendMonthsTable } from "./spending-trends-tables";

const budget = {
  id: "b",
  name: "Household",
  currency: "USD",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
  role: "owner",
} as Budget;

const months = trendMonths(
  [
    { month: "2026-08", key: "a", net: -300n },
    { month: "2026-09", key: "a", net: -290500n },
    { month: "2026-09", key: "b", net: 35300n },
    { month: "2026-10", key: "a", net: -360100n },
  ],
  ["2026-08", "2026-09", "2026-10"],
);
const data: TrendChartData = {
  months,
  keys: ["a", "b"],
  info: (key) => ({ key, label: key, color: "", order: 0, groupId: null, groupName: "" }),
  average: averageMonthlySpending(months),
  previous: new Map(),
  rolling: new Map(),
  comparison: null,
};

describe("Spending Trends table", () => {
  it("lists months newest first, compared with the average", () => {
    render(
      <BudgetProvider budget={budget}>
        <TooltipProvider>
          <TrendMonthsTable data={data} />
        </TooltipProvider>
      </BudgetProvider>,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(
      rows.map((r) =>
        within(r)
          .getAllByRole("cell")
          .map((c) => c.textContent),
      ),
    ).toEqual([
      ["October 2026 (above average)", "$3,601.00", "↑+$1,549.00 (75.5%)"],
      ["September 2026 (above average)", "$2,552.00", "↑+$500.00 (24.4%)"],
      ["August 2026", "$3.00", "↓-$2,049.00 (99.9%)"],
    ]);
    expect(screen.getByRole("button", { name: "About Compared to Average" })).toBeVisible();
  });

  it("adds the comparison's column", () => {
    render(
      <BudgetProvider budget={budget}>
        <TooltipProvider>
          <TrendMonthsTable
            data={{
              ...data,
              comparison: {
                kind: "period",
                label: "Same period last year",
                totals: new Map([["2026-10", 120000n]]),
              },
            }}
          />
        </TooltipProvider>
      </BudgetProvider>,
    );
    expect(screen.getByRole("columnheader", { name: "Same period last year" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "$1,200.00" })).toBeVisible();
  });
});
