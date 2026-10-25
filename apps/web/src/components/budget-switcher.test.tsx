import { SidebarProvider } from "@strictbudget/ui/components/sidebar";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Budget } from "@/lib/budgets";
import { BudgetSwitcher } from "./budget-switcher";

const budgets = [
  { id: "b1", name: "Household", currency: "USD" },
  { id: "b2", name: "Holiday fund", currency: "EUR" },
] as Budget[];

beforeAll(() => {
  // The sidebar's mobile check needs matchMedia, which jsdom lacks.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

async function renderSwitcher(currentBudgetId: string | undefined) {
  const rootRoute = createRootRoute({
    component: () => (
      <SidebarProvider>
        <BudgetSwitcher budgets={budgets} currentBudgetId={currentBudgetId} />
      </SidebarProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  return screen.findByRole("button", { name: /Switch budget$/ });
}

describe("BudgetSwitcher", () => {
  it("shows the current budget", async () => {
    const trigger = await renderSwitcher("b2");
    expect(trigger).toHaveTextContent("Holiday fund");
    expect(trigger).toHaveTextContent("EUR");
  });

  it("asks to select a budget outside a budget route", async () => {
    const trigger = await renderSwitcher(undefined);
    expect(trigger).toHaveTextContent("Select a budget");
  });

  it("lists every budget plus new and all-budgets links", async () => {
    const trigger = await renderSwitcher("b1");
    trigger.focus();
    await userEvent.keyboard("{Enter}");

    expect(await screen.findByRole("menuitem", { name: "Household" })).toHaveAttribute(
      "href",
      "/budgets/b1",
    );
    expect(screen.getByRole("menuitem", { name: "Holiday fund" })).toHaveAttribute(
      "href",
      "/budgets/b2",
    );
    expect(screen.getByRole("menuitem", { name: "New budget" })).toHaveAttribute(
      "href",
      "/budgets/new",
    );
    expect(screen.getByRole("menuitem", { name: "View all budgets" })).toHaveAttribute(
      "href",
      "/budgets",
    );
    // The current budget's own items.
    expect(screen.getByRole("menuitem", { name: "Edit Flags" })).toBeInTheDocument();
  });

  it("has no current-budget items outside a budget", async () => {
    const trigger = await renderSwitcher(undefined);
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await screen.findByRole("menuitem", { name: "New budget" });
    expect(screen.queryByRole("menuitem", { name: "Edit Flags" })).not.toBeInTheDocument();
  });
});
