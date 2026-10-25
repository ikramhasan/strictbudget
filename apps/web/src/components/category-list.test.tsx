import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { BudgetProvider } from "@/lib/budget-context";
import type { Budget } from "@/lib/budgets";
import type { CategoryList as CategoryListData } from "@/lib/categories";
import type { BudgetMonthData } from "@/lib/months";
import { NO_AUTO_ASSIGN } from "@/test/fixtures";
import { CategoryList, type CategoryListActions } from "./category-list";

const data: CategoryListData = {
  readyToAssignCategoryId: "rta",
  uncategorizedCategoryId: "uncat",
  groups: [
    {
      id: "g1",
      name: "Bills",
      hidden: false,
      kind: null,
      categories: [
        {
          id: "c1",
          groupId: "g1",
          name: "Rent",
          note: "",
          hidden: false,
          linkedAccountId: null,
          hasTransactions: false,
          transactionCount: 0,
          hasAssignedMoney: false,
          target: null,
        },
        {
          id: "c2",
          groupId: "g1",
          name: "Electric",
          note: "Pays quarterly",
          hidden: false,
          linkedAccountId: null,
          hasTransactions: false,
          transactionCount: 0,
          hasAssignedMoney: false,
          target: null,
        },
        {
          id: "c3",
          groupId: "g1",
          name: "Cable",
          note: "",
          hidden: true,
          linkedAccountId: null,
          hasTransactions: false,
          transactionCount: 0,
          hasAssignedMoney: false,
          target: null,
        },
      ],
    },
    { id: "g2", name: "Old", hidden: true, kind: null, categories: [] },
  ],
};

const withCards: CategoryListData = {
  readyToAssignCategoryId: "rta",
  uncategorizedCategoryId: "uncat",
  groups: [
    {
      id: "cc",
      name: "Credit Card Payments",
      hidden: false,
      kind: "credit_card_payments",
      categories: [
        {
          id: "pay",
          groupId: "cc",
          name: "Visa",
          note: "",
          hidden: false,
          linkedAccountId: "acct",
          hasTransactions: false,
          transactionCount: 0,
          hasAssignedMoney: false,
          target: null,
        },
      ],
    },
    {
      id: "g1",
      name: "Bills",
      hidden: false,
      kind: null,
      categories: [
        {
          id: "c1",
          groupId: "g1",
          name: "Rent",
          note: "",
          hidden: false,
          linkedAccountId: null,
          hasTransactions: true,
          transactionCount: 0,
          hasAssignedMoney: false,
          target: null,
        },
        {
          id: "c2",
          groupId: "g1",
          name: "Water",
          note: "",
          hidden: false,
          linkedAccountId: null,
          hasTransactions: false,
          transactionCount: 0,
          hasAssignedMoney: false,
          target: null,
        },
      ],
    },
  ],
};

function makeActions() {
  return Object.fromEntries(
    [
      "createGroup",
      "createCategory",
      "updateGroup",
      "updateCategory",
      "deleteGroup",
      "deleteCategory",
      "moveGroup",
      "moveCategory",
    ].map((name) => [name, vi.fn().mockResolvedValue(undefined)]),
  ) as unknown as CategoryListActions & {
    [K in keyof CategoryListActions]: ReturnType<typeof vi.fn>;
  };
}

function renderList(list: CategoryListData = data) {
  const actions = makeActions();
  render(<CategoryList data={list} actions={actions} />);
  return actions;
}

const totals = (assigned: string, activity: string, available: string) => ({
  assigned,
  activity,
  cashActivity: activity,
  creditActivity: "0",
  available,
  cashOverspent: available.startsWith("-") ? available : "0",
  creditOverspent: "0",
  payment: null,
  target: null,
  autoAssign: NO_AUTO_ASSIGN,
  bar: null,
  underfundedParts: [],
  targetConversion: null,
  targetRateMissing: false,
  upcoming: null,
});

const month: BudgetMonthData = {
  month: "2026-10",
  currency: "USD",
  firstMonth: "2026-09",
  lastMonth: "2026-11",
  readyToAssign: "0",
  overdraft: false,
  assignedInFuture: "0",
  readyToAssignBreakdown: {
    leftOver: "0",
    inflows: "0",
    debtInflows: "0",
    cashOverspending: "0",
    assigned: "0",
    assignedInFuture: "0",
    total: "0",
  },
  futureMonths: [],
  nextMonthTargets: null,
  futureShortfall: null,
  note: "",
  targets: { month: "0", nextMonth: "0", expectedIncome: null },
  categories: [
    {
      categoryId: "c1",
      ...totals("100", "-30", "70"),
      autoAssign: NO_AUTO_ASSIGN,
      bar: null,
      underfundedParts: [],
      targetConversion: null,
      targetRateMissing: false,
      upcoming: null,
    },
    {
      categoryId: "c2",
      ...totals("0", "-5", "-5"),
      autoAssign: NO_AUTO_ASSIGN,
      bar: null,
      underfundedParts: [],
      targetConversion: null,
      targetRateMissing: false,
      upcoming: null,
    },
    {
      categoryId: "c3",
      ...totals("0", "-2", "-2"),
      autoAssign: NO_AUTO_ASSIGN,
      bar: null,
      underfundedParts: [],
      targetConversion: null,
      targetRateMissing: false,
      upcoming: null,
    },
  ],
  groups: [{ groupId: "g1", ...totals("100", "-35", "65") }],
  hidden: totals("0", "-2", "-2"),
  uncategorized: {
    activity: "-9",
    cashActivity: "-9",
    creditActivity: "0",
    available: "-9",
    cashOverspent: "-9",
    creditOverspent: "0",
  },
};

function renderWithFigures() {
  render(
    <CategoryList
      data={data}
      actions={makeActions()}
      figures={{ month, currentMonth: "2026-10", format: (a) => `A${a}` }}
    />,
  );
}

describe("CategoryList", () => {
  it("shows visible groups and categories in order", () => {
    renderList();
    const bills = screen.getByRole("region", { name: "Bills" });
    const names = within(bills)
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((t) => t && !t.startsWith("Reorder"));
    expect(names).toEqual(["Bills", "Rent", "Electric"]);
    expect(screen.queryByText("Cable")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Has a note")).toBeInTheDocument();
  });

  it("offers a viewer nothing to change", async () => {
    const actions = makeActions();
    const viewing = {
      id: "b",
      name: "Household",
      currency: "USD",
      numberFormat: "comma_dot",
      currencySymbolPosition: "before",
      dateFormat: "MM/DD/YYYY",
      role: "viewer",
      archivedAt: null,
      lastUsedAt: null,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    } as Budget;
    render(
      <BudgetProvider budget={viewing}>
        <CategoryList data={data} actions={actions} />
      </BudgetProvider>,
    );
    expect(screen.queryByRole("button", { name: /Category Group/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add a category to Bills" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reorder/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Electric" }));
    expect(screen.queryByLabelText("Category name")).not.toBeInTheDocument();
    expect(actions.updateCategory).not.toHaveBeenCalled();
  });

  it("renames a category and edits its note", async () => {
    const actions = renderList();
    await userEvent.click(screen.getByRole("button", { name: "Electric" }));
    const name = screen.getByLabelText("Category name");
    await userEvent.clear(name);
    await userEvent.type(name, "Power");
    await userEvent.clear(screen.getByLabelText("Note"));
    await userEvent.type(screen.getByLabelText("Note"), "Monthly now");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(actions.updateCategory).toHaveBeenCalledWith("c2", {
      name: "Power",
      note: "Monthly now",
    });
  });

  it("adds a category to a group", async () => {
    const actions = renderList();
    await userEvent.click(screen.getByRole("button", { name: "Add a category to Bills" }));
    await userEvent.type(screen.getByLabelText("New category in Bills"), "Water");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(actions.createCategory).toHaveBeenCalledWith("g1", "Water");
  });

  it("adds a category group", async () => {
    const actions = renderList();
    await userEvent.click(screen.getByRole("button", { name: "Add a category group" }));
    await userEvent.type(screen.getByLabelText("New category group"), "Kids");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(actions.createGroup).toHaveBeenCalledWith("Kids");
  });

  it("hides a category from its editor", async () => {
    const actions = renderList();
    await userEvent.click(screen.getByRole("button", { name: "Rent" }));
    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(actions.updateCategory).toHaveBeenCalledWith("c1", { hidden: true });
  });

  it("asks before deleting a group", async () => {
    const actions = renderList();
    await userEvent.click(screen.getByRole("button", { name: "Bills" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Delete “Bills”?");
    expect(actions.deleteGroup).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(actions.deleteGroup).toHaveBeenCalledWith("g1", undefined);
  });

  it("unhides a category or group from the Hidden Categories row", async () => {
    const actions = renderList();
    await userEvent.click(screen.getByRole("button", { name: "Hidden Categories" }));
    expect(screen.getByText("Click to unhide a category")).toBeInTheDocument();
    expect(screen.getByText("Bills:")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cable" }));
    expect(actions.updateCategory).toHaveBeenCalledWith("c3", { hidden: false });
    await userEvent.click(screen.getByRole("button", { name: "Hidden Categories" }));
    await userEvent.click(screen.getByRole("button", { name: "Old" }));
    expect(actions.updateGroup).toHaveBeenCalledWith("g2", { hidden: false });
  });

  it("shows all hidden categories at once", async () => {
    const actions = renderList();
    await userEvent.click(screen.getByRole("button", { name: "Hidden Categories" }));
    await userEvent.click(screen.getByRole("button", { name: "Show all hidden categories" }));
    expect(actions.updateCategory).toHaveBeenCalledWith("c3", { hidden: false });
    expect(actions.updateGroup).toHaveBeenCalledWith("g2", { hidden: false });
  });

  it("shows the month's numbers for categories, groups and hidden categories", () => {
    renderWithFigures();
    const bills = screen.getByRole("region", { name: "Bills" });
    for (const amount of ["A-30", "A70", "A-35", "A65"]) {
      expect(within(bills).getByText(amount)).toBeInTheDocument();
    }
    expect(within(bills).getAllByText("A-5")).toHaveLength(2);
    // Hidden categories' totals sit on the Hidden Categories row, not in their group.
    expect(within(bills).queryByText("A-2")).not.toBeInTheDocument();
    expect(screen.getAllByText("A-2")).toHaveLength(2);
    expect(screen.getByText("Uncategorized Transactions")).toBeInTheDocument();
    expect(screen.getAllByText("A-9")).toHaveLength(2);
  });

  it("collapses a group and all groups", async () => {
    const onCollapsedChange = vi.fn();
    const { rerender } = render(
      <CategoryList
        data={data}
        actions={makeActions()}
        collapsed={new Set()}
        onCollapsedChange={onCollapsedChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Collapse Bills" }));
    expect(onCollapsedChange).toHaveBeenLastCalledWith(new Set(["g1"]));
    rerender(
      <CategoryList
        data={data}
        actions={makeActions()}
        collapsed={new Set(["g1"])}
        onCollapsedChange={onCollapsedChange}
      />,
    );
    expect(screen.queryByRole("button", { name: "Rent" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Expand all groups" }));
    expect(onCollapsedChange).toHaveBeenLastCalledWith(new Set());
  });

  it("locks the Credit Card Payments group and payment category names", async () => {
    renderList(withCards);
    expect(screen.queryByRole("button", { name: "Credit Card Payments" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add a category to Credit Card Payments" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Reorder Credit Card Payments" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Visa" }));
    expect(screen.getByLabelText("Category name")).toHaveAttribute("readonly");
    expect(screen.getByText(/Rename the account instead/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();
  });

  const withUsage = (
    id: string,
    usage: { transactionCount?: number; hasAssignedMoney?: boolean },
  ) => ({
    ...withCards,
    groups: withCards.groups.map((g) => ({
      ...g,
      categories: g.categories.map((c) => (c.id === id ? { ...c, ...usage } : c)),
    })),
  });

  it("asks where to reassign a category's past activity before deleting it", async () => {
    const actions = renderList(withUsage("c1", { transactionCount: 2 }));
    await userEvent.click(screen.getByRole("button", { name: "Rent" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      "Before you can delete the category Rent, you'll need to reassign your past activity",
    );
    expect(dialog).toHaveTextContent("All transactions [2]");
    const confirm = within(dialog).getByRole("button", { name: "Delete" });
    expect(confirm).toBeDisabled();

    const select = within(dialog).getByLabelText("Select category");
    const options = within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);
    // Not itself, and never a payment category.
    expect(options).toEqual(["Select a category…", "Water"]);
    await userEvent.selectOptions(select, "c2");
    await userEvent.click(confirm);
    expect(actions.deleteCategory).toHaveBeenCalledWith("c1", "c2");
  });

  it("says assigned money goes back to Ready to Assign", async () => {
    const actions = renderList(withUsage("c2", { hasAssignedMoney: true }));
    await userEvent.click(screen.getByRole("button", { name: "Water" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("There is money currently assigned to Water.");
    expect(dialog).toHaveTextContent(
      "When you delete this category, all assigned amounts will be moved to Ready to Assign.",
    );
    expect(within(dialog).queryByLabelText("Select category")).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(actions.deleteCategory).toHaveBeenCalledWith("c2", undefined);
  });

  it("deletes an unused category straight away", async () => {
    const actions = renderList(withCards);
    await userEvent.click(screen.getByRole("button", { name: "Water" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(actions.deleteCategory).toHaveBeenCalledWith("c2");
  });

  describe("selecting and views", () => {
    function renderSelectable(shown?: ReadonlySet<string>) {
      const selection = {
        selected: new Set<string>(),
        toggle: vi.fn(),
        selectOnly: vi.fn(),
        setAll: vi.fn(),
      };
      const onViewAll = vi.fn();
      const actions = makeActions();
      const { rerender } = render(
        <CategoryList
          data={data}
          actions={actions}
          figures={{
            month,
            currentMonth: "2026-10",
            format: (a) => `A${a}`,
            selection,
            shown,
            emptyView: { message: "Nothing here.", onViewAll },
          }}
        />,
      );
      return { selection, onViewAll, rerender, actions };
    }

    it("selects a category from its name or checkbox, and all of them", async () => {
      const user = userEvent.setup();
      const { selection } = renderSelectable();
      await user.click(screen.getByRole("button", { name: "Rent" }));
      expect(selection.selectOnly).toHaveBeenCalledWith("c1");
      // Selecting comes first: the name editor stays closed.
      expect(screen.queryByLabelText("Category name")).not.toBeInTheDocument();
      await user.click(screen.getByRole("checkbox", { name: "Select Electric" }));
      expect(selection.toggle).toHaveBeenCalledWith("c2");
      await user.click(screen.getByRole("checkbox", { name: "Check all" }));
      expect(selection.setAll).toHaveBeenCalledWith(["uncategorized", "c1", "c2"]);
      await user.click(screen.getByRole("checkbox", { name: "Select Bills" }));
      expect(selection.setAll).toHaveBeenLastCalledWith(["c1", "c2"]);
    });

    it("offers Edit View on an empty custom view and greys out Category Group", async () => {
      const onEdit = vi.fn();
      const onViewAll = vi.fn();
      render(
        <CategoryList
          data={data}
          actions={makeActions()}
          addGroupDisabled
          figures={{
            month,
            currentMonth: "2026-10",
            format: (a) => `A${a}`,
            shown: new Set(),
            emptyView: {
              message: "There are no categories selected for Bills.",
              onViewAll,
              onEdit,
            },
          }}
        />,
      );
      expect(screen.getByText("There are no categories selected for Bills.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add a category group" })).toBeDisabled();
      await userEvent.click(screen.getByRole("button", { name: "Edit View" }));
      expect(onEdit).toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "View All" }));
      expect(onViewAll).toHaveBeenCalled();
    });

    it("shows only the categories a view keeps, without the hidden row", () => {
      renderSelectable(new Set(["c2"]));
      expect(screen.queryByRole("button", { name: "Rent" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Electric" })).toBeInTheDocument();
      expect(screen.queryByText("Uncategorized Transactions")).not.toBeInTheDocument();
      expect(screen.queryByText("Hidden Categories")).not.toBeInTheDocument();
      expect(
        screen.getByText("Some categories are hidden by your current view."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reorder Electric" })).not.toBeInTheDocument();
    });

    it("totals a group over its categories in view", () => {
      renderSelectable(new Set(["c2"]));
      const bills = screen.getByRole("region", { name: "Bills" });
      // The whole group is A100 / A-35 / A65; Electric alone is A0 / A-5 / A-5.
      expect(within(bills).queryByText("A65")).not.toBeInTheDocument();
      expect(within(bills).getAllByText("A-5").length).toBeGreaterThanOrEqual(2);
    });

    it("says so when a view keeps nothing", async () => {
      const user = userEvent.setup();
      const { onViewAll } = renderSelectable(new Set());
      expect(screen.getByText("Nothing here.")).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Bills" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "View All" }));
      expect(onViewAll).toHaveBeenCalled();
    });
  });

  describe("clicking a row", () => {
    function SelectableList({ initial = ["c1"] }: { initial?: string[] }) {
      const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(initial));
      return (
        <CategoryList
          data={data}
          actions={makeActions()}
          figures={{
            month,
            currentMonth: "2026-10",
            format: (a) => `A${a}`,
            assign: { parse: () => 0n, toInput: (a) => a, assign: vi.fn() },
            selection: {
              selected,
              toggle: (id) =>
                setSelected((s) => {
                  const next = new Set(s);
                  if (!next.delete(id)) next.add(id);
                  return next;
                }),
              selectOnly: (id) => setSelected(new Set([id])),
              setAll: (ids) => setSelected(new Set(ids)),
            },
          }}
        />
      );
    }
    const row = (id: string) =>
      document.querySelector(`[data-category-row="${id}"]`) as HTMLElement;

    it("selects it alone and starts editing its Assigned amount", async () => {
      render(<SelectableList />);
      await userEvent.click(row("c2"));
      expect(screen.getByRole("checkbox", { name: "Select Electric" })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "Select Rent" })).not.toBeChecked();
      expect(screen.getByLabelText("Assigned to Electric")).toHaveFocus();
    });

    it("does the same from the category's name", async () => {
      render(<SelectableList />);
      await userEvent.click(screen.getByRole("button", { name: "Electric" }));
      expect(screen.getByRole("checkbox", { name: "Select Electric" })).toBeChecked();
      expect(screen.getByLabelText("Assigned to Electric")).toHaveFocus();
    });

    it("starts editing when its checkbox begins a selection", async () => {
      render(<SelectableList initial={[]} />);
      await userEvent.click(screen.getByRole("checkbox", { name: "Select Electric" }));
      expect(screen.getByRole("checkbox", { name: "Select Electric" })).toBeChecked();
      expect(screen.getByLabelText("Assigned to Electric")).toHaveFocus();
    });

    it("leaves the checkbox adding to the selection", async () => {
      render(<SelectableList />);
      await userEvent.click(screen.getByRole("checkbox", { name: "Select Electric" }));
      expect(screen.getByRole("checkbox", { name: "Select Rent" })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "Select Electric" })).toBeChecked();
      expect(screen.queryByRole("textbox", { name: "Assigned to Electric" })).toBeNull();
    });
  });
});

describe("CategoryList keys", () => {
  function Harness({ onAssign }: { onAssign: (id: string, amount: bigint) => void }) {
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
    return (
      <>
        <output aria-label="Selected">{[...selected].join(",")}</output>
        <CategoryList
          data={withCards}
          actions={makeActions()}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          figures={{
            month: {
              ...month,
              categories: [
                ...month.categories,
                { ...month.categories[0], categoryId: "pay" } as BudgetMonthData["categories"][0],
              ],
            },
            currentMonth: "2026-10",
            format: (a) => `A${a}`,
            selection: {
              selected,
              toggle: () => {},
              selectOnly: (id) => setSelected(new Set([id])),
              setAll: (ids) => setSelected(new Set(ids)),
            },
            assign: {
              parse: (text) => BigInt(text),
              toInput: (a) => a,
              assign: async (id, amount) => onAssign(id, amount),
            },
          }}
        />
      </>
    );
  }
  const selectedNow = () => screen.getByRole("status", { name: "Selected" }).textContent;

  function setup() {
    const onAssign = vi.fn();
    render(<Harness onAssign={onAssign} />);
    return { onAssign, user: userEvent.setup() };
  }

  it("walks the categories with Up/Down, wrapping, with each one's Assigned open", async () => {
    const { user } = setup();
    await user.keyboard("{ArrowDown}");
    expect(selectedNow()).toBe("uncategorized");
    await user.keyboard("{ArrowDown}");
    expect(selectedNow()).toBe("pay");
    expect(screen.getByRole("textbox", { name: "Assigned to Visa" })).toHaveFocus();
    // From the open Assigned input too.
    await user.keyboard("{ArrowDown}");
    expect(selectedNow()).toBe("c1");
    expect(screen.getByRole("textbox", { name: "Assigned to Rent" })).toHaveFocus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(selectedNow()).toBe("uncategorized");
    await user.keyboard("{ArrowUp}");
    expect(selectedNow()).toBe("c2");
  });

  it("saves the Assigned amount it leaves", async () => {
    const { user, onAssign } = setup();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await user.keyboard("{Control>}a{/Control}42");
    await user.keyboard("{ArrowDown}");
    expect(onAssign).toHaveBeenCalledWith("pay", 42n);
  });

  it("extends with Shift+Up/Down from the anchor and stops at the end", async () => {
    const { user } = setup();
    await user.keyboard("{ArrowUp}{Escape}");
    expect(selectedNow()).toBe("c2");
    await user.keyboard("{Shift>}{ArrowUp}{ArrowUp}{/Shift}");
    expect(selectedNow()).toBe("pay,c1,c2");
    // Plain Down does nothing with several selected.
    await user.keyboard("{ArrowDown}");
    expect(selectedNow()).toBe("pay,c1,c2");
    await user.keyboard("{Escape}");
    expect(selectedNow()).toBe("");
  });

  it("collapses and expands every group with Cmd/Ctrl+Up/Down, or a selection's group", async () => {
    const { user } = setup();
    await user.keyboard("{Control>}{ArrowUp}{/Control}");
    expect(screen.queryByRole("button", { name: "Rent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Visa" })).not.toBeInTheDocument();
    await user.keyboard("{Control>}{ArrowDown}{/Control}");
    expect(screen.getByRole("button", { name: "Rent" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rent" }));
    await user.keyboard("{Control>}{ArrowUp}{/Control}");
    expect(screen.queryByRole("button", { name: "Rent" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Visa" })).toBeInTheDocument();
    expect(selectedNow()).toBe("");
  });

  it("clears the selection on Cmd/Ctrl+Down, leaving the groups as they are", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Rent" }));
    await user.keyboard("{Escape}{Control>}{ArrowDown}{/Control}");
    expect(selectedNow()).toBe("");
    expect(screen.getByRole("button", { name: "Rent" })).toBeInTheDocument();
  });

  it("selects every category with Cmd/Ctrl+A", async () => {
    const { user } = setup();
    await user.keyboard("{Control>}a{/Control}");
    expect(selectedNow()).toBe("uncategorized,pay,c1,c2");
  });
});

describe("CategoryList with axe", () => {
  it("finds nothing on the plan's list", async () => {
    const { expectAccessible } = await import("@/test/axe");
    renderWithFigures();
    await expectAccessible(document.body);
  });
});
