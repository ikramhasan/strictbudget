import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type Account, accountsQueryOptions } from "@/lib/accounts";
import { BudgetProvider } from "@/lib/budget-context";
import type { Budget } from "@/lib/budgets";
import { PhoneAccountList } from "./phone-account-list";

const budget = {
  id: "b1",
  name: "Household",
  currency: "USD",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
  role: "owner",
} as Budget;

const account = (
  id: string,
  type: Account["type"],
  working: string,
  extra: Partial<Account> = {},
): Account & { converted: { currency: string; working: string } } => ({
  id,
  name: id,
  logo: null,
  type,
  note: "",
  closed: false,
  starredOrder: null,
  currency: "USD",
  interestRate: null,
  minimumPayment: null,
  escrowAmount: null,
  paymentCategoryId: null,
  hasHistory: false,
  lastReconciledAt: null,
  pairedCategoryId: null,
  lastPaymentDate: null,
  lastPaymentFromAccountId: null,
  migratedToAccountId: null,
  migratedFromAccountId: null,
  toReview: 0,
  unrealizedGain: null,
  rate: null,
  rateDate: null,
  balances: { cleared: working, uncleared: "0", working },
  converted: { currency: "USD", working },
  ...extra,
});

const total = (amount: string) => ({ currency: "USD", amount, converted: false, missing: [] });

async function renderList() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(accountsQueryOptions("b1").queryKey, {
    accounts: [
      account("Checking", "checking", "375420", { toReview: 2, starredOrder: 1 }),
      account("Savings", "savings", "830000"),
      account("Visa Card", "credit_card", "-60688"),
      account("House", "asset", "30000000"),
      account("Old card", "credit_card", "0", { closed: true }),
    ],
    totals: {
      starred: total("375420"),
      budget: total("1144732"),
      loans: total("0"),
      tracking: total("30000000"),
      closed: total("0"),
      netWorth: total("31144732"),
    },
    missingRates: 0,
  } as never);
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <BudgetProvider budget={budget}>
          <PhoneAccountList />
        </BudgetProvider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  return screen.findByRole("link", { name: /All accounts/ });
}

describe("PhoneAccountList", () => {
  it("leads with All Accounts, then each group with its total and its accounts' balances", async () => {
    const all = await renderList();
    expect(all).toHaveAttribute("href", "/budgets/b1/accounts?all=true");
    expect(all).toHaveTextContent("4 open accounts · 2 to review");
    expect(screen.getByText("Net worth").nextSibling).toHaveTextContent("$311,447.32");

    const cash = screen.getByRole("region", { name: "Cash" });
    expect(cash).toHaveTextContent("$12,054.20");
    const checking = within(cash).getByRole("link", { name: /Checking/ });
    expect(checking).toHaveAttribute("href", "/budgets/b1/accounts/Checking");
    expect(checking).toHaveTextContent("2 to review");
    expect(checking).toHaveTextContent("$3,754.20");

    const credit = screen.getByRole("region", { name: "Credit" });
    // Money owed reads red, on the card and on its group's total.
    for (const figure of within(credit).getAllByText("−$606.88")) {
      expect(figure).toHaveClass("text-destructive");
    }
    expect(screen.getByRole("region", { name: "Tracking" })).toHaveTextContent("House");
    // A starred account shows once, in its own group.
    expect(screen.queryByRole("region", { name: "Starred" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Checking/ })).toHaveLength(1);
    // Closed accounts are folded away.
    expect(screen.getByText("Closed").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "Add account" })).toBeInTheDocument();
  });
});
