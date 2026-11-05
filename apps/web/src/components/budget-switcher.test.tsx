import { SidebarProvider } from "@strictbudget/ui/components/sidebar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { $api } from "@/lib/api";
import type { Budget } from "@/lib/budgets";
import { BudgetSwitcher } from "./budget-switcher";

const budgets = [
  {
    id: "b1",
    name: "Household",
    currency: "USD",
    dateFormat: "MM/DD/YYYY",
    createdAt: "2026-10-01T09:00:00.000Z",
    lastUsedAt: null,
  },
  {
    id: "b2",
    name: "Holiday fund",
    currency: "EUR",
    dateFormat: "MM/DD/YYYY",
    createdAt: "2026-10-02T09:00:00.000Z",
    lastUsedAt: null,
  },
] as Budget[];

const membersKey = (budgetId: string) =>
  $api.queryOptions("get", "/v1/budgets/{budgetId}/members", {
    params: { path: { budgetId } },
  }).queryKey;

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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  // The household is shared with a partner; the holiday fund isn't shared.
  queryClient.setQueryData(membersKey("b1"), {
    members: [{ userId: "u1" }, { userId: "u2" }],
    invitations: [],
  } as never);
  queryClient.setQueryData(membersKey("b2"), {
    members: [{ userId: "u1" }],
    invitations: [],
  } as never);
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <SidebarProvider>
          <BudgetSwitcher budgets={budgets} currentBudgetId={currentBudgetId} />
        </SidebarProvider>
      </QueryClientProvider>
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

    // Each budget says when it was made (or last opened) and, when shared, by how many.
    expect(
      await screen.findByRole("menuitem", { name: "Household Created 10/01/2026 · 2 members" }),
    ).toHaveAttribute("href", "/budgets/b1");
    expect(
      screen.getByRole("menuitem", { name: "Holiday fund Created 10/02/2026" }),
    ).toHaveAttribute("href", "/budgets/b2");
    expect(screen.getByRole("menuitem", { name: "New budget" })).toHaveAttribute(
      "href",
      "/budgets/new",
    );
    expect(screen.getByRole("menuitem", { name: "View all budgets" })).toHaveAttribute(
      "href",
      "/budgets",
    );
    // The current budget's own items.
    expect(screen.getByRole("menuitem", { name: "Edit flags" })).toBeInTheDocument();
  });

  it("has no current-budget items outside a budget", async () => {
    const trigger = await renderSwitcher(undefined);
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await screen.findByRole("menuitem", { name: "New budget" });
    expect(screen.queryByRole("menuitem", { name: "Edit flags" })).not.toBeInTheDocument();
  });
});
