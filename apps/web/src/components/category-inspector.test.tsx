import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BudgetProvider } from "@/lib/budget-context";
import type { Breakdown } from "@/lib/budget-view";
import type { Budget } from "@/lib/budgets";
import { CategoryInspector, MonthSummary, PaymentInspector } from "./category-inspector";

const format = (a: string) => `A${a}`;

describe("CategoryInspector", () => {
  it("breaks down a category's Available and saves its note on blur", async () => {
    const user = userEvent.setup();
    const onNoteChange = vi.fn().mockResolvedValue(undefined);
    render(
      <CategoryInspector
        name="Power"
        totals={{
          carried: 500n,
          assigned: 1000n,
          activity: -4000n,
          cashActivity: -1000n,
          creditActivity: -3000n,
          available: -2500n,
          cashOverspent: -1000n,
          creditOverspent: -1500n,
        }}
        format={format}
        available={<span>pill</span>}
        note=""
        onNoteChange={onNoteChange}
      />,
    );
    expect(screen.getByRole("heading", { name: "Power" })).toBeInTheDocument();
    for (const [label, amount] of [
      ["Cash left over from last month", "A500"],
      ["Assigned this month", "A1000"],
      ["Cash spending", "A-1000"],
      ["Credit spending", "A-3000"],
    ]) {
      expect(screen.getByText(label as string).nextSibling).toHaveTextContent(amount as string);
    }
    expect(
      screen.getByText("Overspent by A2500. Cover it from another category."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("A1000 of it is cash spending; the rest went on credit."),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Notes"), "Quarterly");
    expect(onNoteChange).not.toHaveBeenCalled();
    await user.tab();
    expect(onNoteChange).toHaveBeenCalledWith("Quarterly");
  });

  it("shows dashes and no note for Uncategorized", () => {
    render(
      <CategoryInspector
        name="Uncategorized Transactions"
        uncategorized
        totals={{
          carried: 0n,
          assigned: 0n,
          activity: -300n,
          cashActivity: -200n,
          creditActivity: -100n,
          available: -300n,
          cashOverspent: -200n,
          creditOverspent: -100n,
        }}
        format={format}
        available={null}
        note=""
        onNoteChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Assigned this month").nextSibling).toHaveTextContent("–");
    expect(screen.getByText("Credit spending").nextSibling).toHaveTextContent("A-100");
    // Only the cash part comes out of next month's Ready to Assign.
    expect(screen.getByText(/A200 comes out of next month/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Notes")).not.toBeInTheDocument();
  });
});

describe("CategoryInspector overspending", () => {
  const breakdown = (available: bigint, cash: bigint, credit: bigint) => ({
    carried: 0n,
    assigned: 0n,
    activity: available,
    cashActivity: 0n,
    creditActivity: available,
    available,
    cashOverspent: cash,
    creditOverspent: credit,
  });
  const show = (totals: ReturnType<typeof breakdown>) =>
    render(
      <CategoryInspector
        name="Rent"
        totals={totals}
        format={format}
        available={null}
        note=""
        onNoteChange={vi.fn()}
      />,
    );

  it("says credit overspending creates debt", () => {
    show(breakdown(-400n, 0n, -400n));
    expect(
      screen.getByText(
        "Overspent by A400 on credit. Cover it so the card balance doesn't grow into new debt.",
      ),
    ).toBeInTheDocument();
  });

  it("gives one shortfall to cover, and its cash part as a detail", () => {
    show(breakdown(-300n, -100n, -200n));
    expect(
      screen.getByText("Overspent by A300. Cover it from another category."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("A100 of it is cash spending; the rest went on credit."),
    ).toBeInTheDocument();
  });
});

describe("PaymentInspector", () => {
  const totals = {
    carried: 0n,
    assigned: 1000n,
    activity: 200n,
    cashActivity: 0n,
    creditActivity: 0n,
    available: 1200n,
    cashOverspent: 0n,
    creditOverspent: 0n,
  };
  type Payment = Parameters<typeof PaymentInspector>[0]["payment"];
  const base = {
    priorBalance: 0n,
    spendingAndOutflows: 0n,
    paymentsAndInflows: 0n,
    fundedSpending: 0n,
    paymentsMade: 0n,
  };
  const show = (
    payment: Pick<Payment, "balance" | "underfunded" | "overspentCategories"> & Partial<Payment>,
    warn = true,
    available = totals.available,
  ) =>
    render(
      <PaymentInspector
        name="Card A"
        totals={{ ...totals, available }}
        payment={{ ...base, ...payment }}
        format={format}
        available={<span>pill</span>}
        note=""
        onNoteChange={vi.fn()}
        warn={warn}
      />,
    );

  it("splits what's underfunded", () => {
    show({
      balance: -10400n,
      underfunded: 9200n,
      overspentCategories: 200n,
      priorBalance: -10000n,
      spendingAndOutflows: -400n,
      fundedSpending: 200n,
    });
    expect(screen.getByText(/Cover A200 in overspent categories/)).toBeInTheDocument();
    for (const [label, amount] of [
      ["Total underfunded", "A9200"],
      ["Overspent categories", "A200"],
      ["Underfunded", "A9000"],
      ["Current balance", "A-10400"],
      ["Prior balance", "A-10000"],
      ["Spending and outflows", "A-400"],
      ["Assigned", "A1000"],
      ["Funded spending", "A200"],
    ]) {
      expect(screen.getByText(label as string).nextSibling).toHaveTextContent(amount as string);
    }
  });

  it("offers Record Payment once Available covers the balance", async () => {
    const record = (available: bigint, balance: bigint, warn = true) => {
      cleanup();
      const onRecordPayment = vi.fn();
      render(
        <PaymentInspector
          name="Card C"
          totals={{ ...totals, available }}
          payment={{ ...base, balance, underfunded: 0n, overspentCategories: 0n }}
          format={format}
          available={<span>pill</span>}
          note=""
          onNoteChange={vi.fn()}
          warn={warn}
          onRecordPayment={onRecordPayment}
        />,
      );
      return onRecordPayment;
    };
    const message = /The balance is covered./;
    // Covered ($10 for $6 owed) and exactly covered.
    const onRecordPayment = record(1000n, -600n);
    expect(screen.getByText(message)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Record payment" }));
    expect(onRecordPayment).toHaveBeenCalled();
    record(600n, -600n);
    expect(screen.getByRole("button", { name: "Record payment" })).toBeInTheDocument();
    // Partly covered, paid off, or a past month: no Record Payment.
    record(300n, -600n);
    expect(screen.queryByRole("button", { name: "Record payment" })).not.toBeInTheDocument();
    record(500n, 200n);
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    expect(screen.getByText(/is paid off\./)).toBeInTheDocument();
    record(1000n, -600n, false);
    expect(screen.queryByRole("button", { name: "Record payment" })).not.toBeInTheDocument();
  });

  it("folds Current Balance and Available for Payment, and remembers it", async () => {
    const user = userEvent.setup();
    localStorage.clear();
    show({ balance: -2900n, underfunded: 2900n, overspentCategories: 0n, priorBalance: -100n });
    expect(screen.getByText("Prior balance")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Current balance" }));
    expect(screen.queryByText("Prior balance")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Current balance" }).nextSibling).toHaveTextContent(
      "A-2900",
    );
    cleanup();
    show({ balance: -2900n, underfunded: 2900n, overspentCategories: 0n });
    expect(screen.queryByText("Prior balance")).not.toBeInTheDocument();
    expect(screen.getByText("Funded spending")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Current balance" }));
    expect(screen.getByText("Prior balance")).toBeVisible();
  });

  it("asks for the rest of the balance without overspending", () => {
    show({ balance: -2900n, underfunded: 2900n, overspentCategories: 0n });
    expect(screen.getByText(/You need to assign A2900 more/)).toBeInTheDocument();
  });

  it("warns when more was paid than set aside", () => {
    show(
      { balance: -600n, underfunded: 0n, overspentCategories: 0n, paymentsMade: -1600n },
      true,
      -200n,
    );
    expect(
      screen.getByText("You sent more to Card A than you had set aside for the payment."),
    ).toBeInTheDocument();
    expect(screen.getByText("Payments made").nextSibling).toHaveTextContent("A-1600");
  });

  it("celebrates a paid-off card and stays quiet in past months", () => {
    show({ balance: 200n, underfunded: 0n, overspentCategories: 0n });
    expect(screen.getByText(/Card A is paid off\./)).toBeInTheDocument();
    cleanup();
    show({ balance: -2900n, underfunded: 2900n, overspentCategories: 0n }, false);
    expect(screen.queryByText("Total underfunded")).not.toBeInTheDocument();
  });
});

describe("MonthSummary", () => {
  it("lists what's selected", () => {
    render(
      <MonthSummary
        month="2026-10"
        totals={{
          carried: 0n,
          assigned: 0n,
          activity: -3000n,
          cashActivity: -3000n,
          creditActivity: 0n,
          available: -3000n,
          cashOverspent: -3000n,
          creditOverspent: 0n,
        }}
        format={format}
        selectedNames={["Power", "Food"]}
      />,
    );
    expect(screen.getByRole("heading", { name: "2 categories selected" })).toBeInTheDocument();
    expect(screen.getByText("Power, Food")).toBeInTheDocument();
    expect(screen.getByText("Assigned in October").nextSibling).toHaveTextContent("A0");
    expect(screen.getByText("Activity").nextSibling).toHaveTextContent("A-3000");
  });
});

describe("MonthSummary's report link", () => {
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
  const totals = {
    carried: 0n,
    assigned: 1000n,
    activity: -500n,
    available: 500n,
  } as Breakdown;

  async function renderSummary(reportCategories?: string[]) {
    const rootRoute = createRootRoute({
      component: () => (
        <BudgetProvider budget={budget}>
          <MonthSummary
            month="2026-10"
            totals={totals}
            format={(m) => m}
            reportCategories={reportCategories}
          />
        </BudgetProvider>
      ),
    });
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(<RouterProvider router={router} />);
    return screen.findByRole("link", { name: "Spending Breakdown for October" });
  }

  it("opens Spending Breakdown for the month over the whole plan", async () => {
    const link = await renderSummary();
    expect(link.getAttribute("href")).toBe(
      "/budgets/b/reports/spending-breakdown?from=2026-10&to=2026-10",
    );
  });

  it("keeps the summary's categories", async () => {
    const link = await renderSummary(["c1", "c2"]);
    expect(decodeURIComponent(link.getAttribute("href") ?? "")).toContain("categories=c1,c2");
  });
});
