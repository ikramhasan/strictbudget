import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
  useRouterState,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { accountsQueryOptions } from "@/lib/accounts";
import type { Budget } from "@/lib/budgets";
import { categoriesQueryOptions } from "@/lib/categories";
import { CommandRegistryProvider, moveTarget, useOpenRequest } from "@/lib/commands";
import { currentMonth, monthQueryOptions } from "@/lib/months";
import { useShortcut } from "@/lib/shortcuts";
import { CommandPalette, filterGroups, type PaletteGroup } from "./command-palette";

beforeAll(() => {
  // cmdk scrolls the selected row into view, which jsdom doesn't implement.
  Element.prototype.scrollIntoView = () => {};
});

const budget = {
  id: "b1",
  name: "Household",
  role: "owner",
  currency: "USD",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
} as Budget;
const other = { ...budget, id: "b2", name: "Holiday fund" } as Budget;

const account = (id: string, name: string, working: string, closed = false) => ({
  id,
  name,
  note: "",
  closed,
  currency: "USD",
  balances: { cleared: working, uncleared: "0", working },
});

function seed() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
  });
  queryClient.setQueryData(accountsQueryOptions("b1").queryKey, {
    accounts: [account("a1", "Checking", "125000"), account("a2", "Old Savings", "0", true)],
  } as never);
  queryClient.setQueryData(categoriesQueryOptions("b1").queryKey, {
    groups: [
      {
        id: "g1",
        name: "Bills",
        hidden: false,
        kind: null,
        categories: [
          { id: "c1", groupId: "g1", name: "Rent", hidden: false },
          { id: "c2", groupId: "g1", name: "Old gym", hidden: true },
        ],
      },
    ],
  } as never);
  // A budget going back years, as an imported one can.
  queryClient.setQueryData(monthQueryOptions("b1", currentMonth()).queryKey, {
    firstMonth: "2016-01",
    lastMonth: currentMonth(),
  } as never);
  return queryClient;
}

/** A screen offering Shift+N, as a register does. */
function Screen({ onAdd }: { onAdd: () => void }) {
  useShortcut("addTransaction", onAdd);
  return <input aria-label="Page field" />;
}

/** The plan's Rent row, whose Move popover the palette opens. */
function RentRow({ onMove }: { onMove: () => void }) {
  useOpenRequest(moveTarget("c1"), onMove);
  return null;
}

/**
 * The palette over a screen: one offering Add transaction everywhere, or (`register`) only once a
 * register shows, as the app's do.
 */
async function renderPalette({
  aiOn = false,
  onAdd = vi.fn(),
  onMove = vi.fn(),
  register = false,
} = {}) {
  function Harness() {
    const [open, setOpen] = useState(true);
    const path = useRouterState({ select: (state) => state.location.pathname });
    const inRegister = path.includes("/accounts/");
    return (
      <CommandRegistryProvider>
        {(!register || inRegister) && <Screen onAdd={onAdd} />}
        {path === "/budgets/b1" && <RentRow onMove={onMove} />}
        <CommandPalette
          open={open}
          onOpenChange={setOpen}
          budget={budget}
          budgets={[budget, other]}
          aiOn={aiOn}
          onSignOut={() => {}}
        />
      </CommandRegistryProvider>
    );
  }
  const rootRoute = createRootRoute({ component: Harness });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider client={seed()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const dialog = await screen.findByRole("dialog", { name: "Command palette" });
  return { router, dialog, input: within(dialog).getByRole("combobox") };
}

const selectedRow = (dialog: HTMLElement) =>
  dialog.querySelector("[cmdk-item][data-selected=true]")?.textContent;

describe("CommandPalette", () => {
  it("lists the screen's actions with their keys, and runs one once it has closed", async () => {
    const onAdd = vi.fn();
    const { dialog } = await renderPalette({ onAdd });
    const row = within(dialog).getByRole("option", { name: /Add transaction/ });
    expect(row).toHaveTextContent("shiftN");
    // Searched-only sources stay out of the opening list.
    expect(within(dialog).queryByRole("option", { name: /Rent/ })).toBeNull();
    expect(within(dialog).queryByRole("option", { name: /Old Savings/ })).toBeNull();
    await userEvent.click(row);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(onAdd).toHaveBeenCalledOnce());
  });

  it("shows Ask AI first, and Enter on a search runs the best match", async () => {
    const { router, dialog, input } = await renderPalette({ aiOn: true });
    const ask = () => within(dialog).getByRole("option", { name: /^Ask AI/ });
    // Last in the list (cmdk selects from the top) and shown first.
    expect(ask().closest("[cmdk-group]")).toHaveClass("order-first");
    await userEvent.type(input, "rent");
    expect(ask()).toHaveTextContent("Ask AI: rent");
    expect(selectedRow(dialog)).toContain("Rent");
    // Hidden categories aren't offered.
    await userEvent.clear(input);
    await userEvent.type(input, "old gym");
    expect(within(dialog).queryByRole("option", { name: /^Old gym/ })).toBeNull();
    await userEvent.clear(input);
    await userEvent.type(input, "rent{Enter}");
    await waitFor(() => expect(router.state.location.search).toMatchObject({ category: "c1" }));
    expect(router.state.location.pathname).toBe("/budgets/b1");
  });

  it("asks the AI with Cmd/Ctrl+Enter", async () => {
    const { router, input } = await renderPalette({ aiOn: true });
    await userEvent.type(input, "how much on rent?{Control>}{Enter}{/Control}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/budgets/b1/ai"));
    expect(router.state.location.search).toEqual({ ask: "how much on rent?" });
  });

  it("asks the AI with Enter when nothing else matches", async () => {
    const { router, dialog, input } = await renderPalette({ aiOn: true });
    await userEvent.type(input, "what did I spend in total last week");
    expect(selectedRow(dialog)).toContain("Ask AI: what did I spend");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/budgets/b1/ai"));
  });

  it("searches transactions for what's typed, and finds closed accounts", async () => {
    const { router, dialog, input } = await renderPalette();
    expect(within(dialog).queryByText(/Ask AI/)).toBeNull();
    await userEvent.type(input, "savings");
    expect(within(dialog).getByRole("option", { name: /Old Savings/ })).toHaveTextContent("Closed");
    await userEvent.click(
      within(dialog).getByRole("option", { name: "Search transactions for “savings”" }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/budgets/b1/accounts"));
    expect(router.state.location.search).toEqual({ q: "savings" });
  });

  it("finds the months named nearest to now first", async () => {
    const { dialog, input } = await renderPalette();
    await userEvent.type(input, "march");
    const [year, month] = currentMonth().split("-").map(Number) as [number, number];
    const latest = month >= 3 ? year : year - 1;
    const months = within(dialog)
      .getAllByRole("option", { name: /^March \d{4}$/ })
      .map((o) => o.textContent);
    expect(months).toEqual([0, 1, 2, 3].map((back) => `March ${latest - back}`));
  });

  it("switches budgets and finds a setting by a word for it", async () => {
    const { router, dialog, input } = await renderPalette();
    await userEvent.type(input, "invite");
    const members = within(dialog).getByRole("option", { name: /Members/ });
    expect(members).toHaveTextContent("Budget settings › Sharing");
    await userEvent.click(members);
    await waitFor(() => expect(router.state.location.pathname).toBe("/budgets/b1/settings"));
    expect(router.state.location.search).toEqual({ tab: "sharing" });
    expect(router.state.location.hash).toBe("settings-sharing");
  });
});

describe("CommandPalette's second steps", () => {
  it("adds a transaction in an account picked from a list, on its register", async () => {
    const onAdd = vi.fn();
    const { router, dialog, input } = await renderPalette({ onAdd, register: true });
    await userEvent.type(input, "add tr{Enter}");
    // The list of open accounts, under a chip naming the step.
    expect(within(dialog).getByText("Add transaction", { selector: "span" })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: /Checking/ })).toHaveTextContent("$1,250.00");
    expect(within(dialog).queryByRole("option", { name: /Old Savings/ })).toBeNull();
    await userEvent.type(within(dialog).getByRole("combobox"), "chk{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/budgets/b1/accounts/a1"));
    await waitFor(() => expect(onAdd).toHaveBeenCalledOnce());
  });

  it("offers the screen's own Add transaction instead of the list on a register", async () => {
    const { dialog, input } = await renderPalette();
    await userEvent.type(input, "add tr");
    expect(within(dialog).getAllByRole("option", { name: /^Add transaction/ })).toHaveLength(1);
    expect(within(dialog).queryByRole("option", { name: /Add transaction…/ })).toBeNull();
  });

  it("moves money from a picked category: the plan with it selected, then its popover", async () => {
    const onMove = vi.fn();
    const { router, dialog, input } = await renderPalette({ onMove });
    await userEvent.type(input, "move{Enter}");
    await userEvent.type(within(dialog).getByRole("combobox"), "rent{Enter}");
    await waitFor(() => expect(router.state.location.search).toMatchObject({ category: "c1" }));
    expect(router.state.location.pathname).toBe("/budgets/b1");
    await waitFor(() => expect(onMove).toHaveBeenCalledOnce());
  });

  it("goes back a step with Backspace in an empty search, or Escape", async () => {
    const { dialog, input } = await renderPalette();
    await userEvent.type(input, "go to month{Enter}");
    expect(within(dialog).getByRole("option", { name: "January 2016" })).toBeInTheDocument();
    await userEvent.keyboard("{Backspace}");
    expect(within(dialog).getByRole("option", { name: /Move money…/ })).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("combobox"), "move{Enter}");
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: /Move money…/ })).toBeInTheDocument();
  });

  it("lists every month to go to, the one showing selected", async () => {
    const { router, dialog, input } = await renderPalette();
    await userEvent.type(input, "go to month{Enter}");
    expect(selectedRow(dialog)).toContain("This month");
    expect(within(dialog).getAllByRole("option").length).toBeGreaterThan(100);
    await userEvent.type(within(dialog).getByRole("combobox"), "2016-02{Enter}");
    await waitFor(() => expect(router.state.location.search).toEqual({ month: "2016-02" }));
  });
});

describe("filterGroups", () => {
  const item = (id: string, label: string, extra: object = {}) => ({
    id,
    label,
    run: () => {},
    ...extra,
  });
  const groups: PaletteGroup[] = [
    { heading: "Go to", items: [item("reports", "Reports"), item("budget", "Budget")] },
    {
      heading: "Categories",
      limit: 1,
      items: [
        item("c1", "Budget buffer", { searchOnly: true }),
        item("c2", "Budgeting fees", { searchOnly: true }),
      ],
    },
  ];

  it("leaves search-only rows out until something is typed", () => {
    expect(filterGroups(groups, " ").map((g) => g.heading)).toEqual(["Go to"]);
  });

  it("ranks groups by their best row and cuts each to its limit", () => {
    const result = filterGroups(groups, "budget");
    expect(result.map((g) => g.items.map((i) => i.id))).toEqual([["budget"], ["c1"]]);
    expect(filterGroups(groups, "fees").map((g) => g.items.map((i) => i.id))).toEqual([["c2"]]);
  });

  it("ranks a name's start first and finds commands and settings only by how words start", () => {
    const search: PaletteGroup[] = [
      {
        heading: "Settings",
        items: [
          item("members", "Members", { keywords: ["sharing", "invite", "partner", "roles"] }),
          item("rates", "Exchange rates", { keywords: ["currency"] }),
        ],
      },
      {
        heading: "Categories",
        loose: true,
        items: [
          item("groc", "🛒 Groceries", { searchOnly: true }),
          item("ingro", "Big grocery run", { searchOnly: true }),
          item("gas", "Gas & Repairs Overall", { searchOnly: true }),
        ],
      },
    ];
    const ids = (q: string) => filterGroups(search, q).map((g) => g.items.map((i) => i.id));
    // "gro" is the start of Groceries, after its emoji, then of a word; Members isn't found by
    // letters scattered across its keywords, while a category still is.
    expect(ids("gro")).toEqual([["groc", "ingro", "gas"]]);
    expect(ids("rates")).toEqual([["rates"]]);
    // A keyword's start finds a setting.
    expect(ids("invi")).toEqual([["members"]]);
    expect(ids("mbrs")).toEqual([]);
  });
});
