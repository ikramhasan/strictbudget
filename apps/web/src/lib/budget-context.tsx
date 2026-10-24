import { formatAmount, formatDate, type Money } from "@strictbudget/engine";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { Budget } from "./budgets";

interface BudgetContextValue {
  budget: Budget;
  formatAmount: (m: Money) => string;
  formatDate: (isoDate: string) => string;
  /**
   * The user is a viewer: the budget shows without anything that changes it. The API refuses their
   * writes anyway (READ_ONLY).
   */
  readOnly: boolean;
}

const BudgetContext = createContext<BudgetContextValue | null>(null);

export function BudgetProvider({ budget, children }: { budget: Budget; children: ReactNode }) {
  const value = useMemo<BudgetContextValue>(
    () => ({
      budget,
      formatAmount: (m) => formatAmount(m, budget),
      formatDate: (isoDate) => formatDate(isoDate, budget.dateFormat),
      readOnly: budget.role === "viewer",
    }),
    [budget],
  );
  return <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>;
}

export function useBudget(): BudgetContextValue {
  const value = useContext(BudgetContext);
  if (!value) throw new Error("useBudget must be used inside a budget route");
  return value;
}

export function useOptionalBudget(): BudgetContextValue | null {
  return useContext(BudgetContext);
}
