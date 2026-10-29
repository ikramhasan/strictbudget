import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ViewActions } from "@/lib/budget-views";
import type { CategoryList } from "@/lib/categories";
import { BudgetFilterBar } from "./budget-filter-bar";
import { ManageViewsDialog, ViewEditorDialog, ViewsMenu } from "./budget-views";

const category = (id: string, groupId: string, name: string, hidden = false) => ({
  id,
  groupId,
  name,
  note: "",
  hidden,
  linkedAccountId: null,
  hasTransactions: false,
  transactionCount: 0,
  hasAssignedMoney: false,
  savings: false,
  target: null,
});

const categories: CategoryList = {
  readyToAssignCategoryId: "rta",
  uncategorizedCategoryId: "uncat",
  savingsSuggestionDismissed: false,
  groups: [
    {
      id: "g1",
      name: "Bills",
      hidden: false,
      kind: null,
      categories: [
        category("rent", "g1", "Rent"),
        category("power", "g1", "Electric"),
        category("cable", "g1", "Cable", true),
      ],
    },
    {
      id: "g2",
      name: "Old",
      hidden: true,
      kind: null,
      categories: [category("gym", "g2", "Gym")],
    },
  ],
};

function actions(): ViewActions {
  return {
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(async () => {}),
    reorder: vi.fn(async () => {}),
  } as unknown as ViewActions;
}

describe("ViewEditorDialog", () => {
  it("asks for a name and saves the checked visible categories", async () => {
    const onSave = vi.fn(async () => {});
    render(
      <ViewEditorDialog
        open
        view={null}
        preselected={["power"]}
        categories={categories}
        onClose={() => {}}
        onSave={onSave}
      />,
    );
    expect(screen.getByRole("heading", { name: "New Custom View" })).toBeInTheDocument();
    expect(
      screen.getByText("Choose a set of categories to include in this custom view."),
    ).toBeInTheDocument();
    // Hidden categories and hidden groups aren't offered.
    expect(screen.queryByLabelText("Cable")).toBeNull();
    expect(screen.queryByText("Old")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Electric" })).toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The view name is required.");
    expect(onSave).not.toHaveBeenCalled();

    await userEvent.type(screen.getByPlaceholderText("Keep 'em short & sweet!"), " Bills ");
    await userEvent.click(screen.getByRole("checkbox", { name: "Rent" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ name: "Bills", categoryIds: ["power", "rent"] });
  });

  it("edits a view, dropping hidden categories it had, and shows the server's error", async () => {
    const onSave = vi.fn(async () => {
      throw { error: { code: "VIEW_NAME_TAKEN", message: "This view name already exists." } };
    });
    render(
      <ViewEditorDialog
        open
        view={{ id: "v1", name: "Bills", categoryIds: ["rent", "cable"] }}
        categories={categories}
        onClose={() => {}}
        onSave={onSave}
      />,
    );
    expect(screen.getByRole("heading", { name: "Edit Custom View" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Rent" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ name: "Bills", categoryIds: ["rent"] });
    expect(await screen.findByRole("alert")).toHaveTextContent("This view name already exists.");
  });
});

describe("ManageViewsDialog", () => {
  it("lists presets and custom views; only custom views can be edited or deleted", async () => {
    const a = actions();
    const onEdit = vi.fn();
    const onDeleted = vi.fn();
    render(
      <ManageViewsDialog
        open
        onClose={() => {}}
        order={["snoozed", "v1", "underfunded", "overfunded", "available"]}
        views={[{ id: "v1", name: "Bills", categoryIds: [] }]}
        actions={a}
        onEdit={onEdit}
        onNew={() => {}}
        onDeleted={onDeleted}
      />,
    );
    const list = screen.getByRole("list", { name: "Views" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Snoozed", "Bills", "Underfunded", "Overfunded", "Money Available"]);
    expect(screen.queryByRole("button", { name: "Delete Snoozed" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Edit Bills" }));
    expect(onEdit).toHaveBeenCalledWith({ id: "v1", name: "Bills", categoryIds: [] });

    await userEvent.click(screen.getByRole("button", { name: "Delete Bills" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(a.remove).toHaveBeenCalledWith("v1");
    expect(onDeleted).toHaveBeenCalledWith("v1");
  });

  it("disables New View at 12 views", () => {
    const views = Array.from({ length: 12 }, (_, i) => ({
      id: `v${i}`,
      name: `V${i}`,
      categoryIds: [],
    }));
    render(
      <ManageViewsDialog
        open
        onClose={() => {}}
        order={views.map((v) => v.id)}
        views={views}
        actions={actions()}
        onEdit={() => {}}
        onNew={() => {}}
        onDeleted={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "New View" })).toBeDisabled();
    expect(
      screen.getByText("You have reached the maximum number of custom views available."),
    ).toBeInTheDocument();
  });
});

describe("BudgetFilterBar with custom views", () => {
  it("puts All and Overspent first, then the plan's order, four on the bar", async () => {
    const onChange = vi.fn();
    render(
      <BudgetFilterBar
        filter="all"
        overspent={2}
        onChange={onChange}
        order={["v1", "underfunded", "overfunded", "available", "snoozed", "gone"]}
        custom={[{ id: "v1", name: "Bills" }]}
        menu={() => <ViewsMenu full={false} onManage={() => {}} onNew={() => {}} />}
      />,
    );
    const group = screen.getByRole("radiogroup", { name: "Budget view" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((b) => b.textContent),
    ).toEqual(["All", "2 Overspent", "Bills", "Underfunded"]);
    await userEvent.click(screen.getByRole("radio", { name: "Bills" }));
    expect(onChange).toHaveBeenCalledWith("v1");
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
  });
});

// Views past the window's breakpoints move into the Views Menu, except the selected one. The bar
// also stops at four views; the rest are under "More".
describe("BudgetFilterBar overflow", () => {
  it("moves the views past the first four into More, keeping the selected one", async () => {
    const onChange = vi.fn();
    const custom = Array.from({ length: 6 }, (_, i) => ({ id: `v${i + 1}`, name: `V${i + 1}` }));
    render(
      <BudgetFilterBar
        filter="v6"
        overspent={0}
        onChange={onChange}
        order={["underfunded", "overfunded", "available", "snoozed", ...custom.map((v) => v.id)]}
        custom={custom}
        viewportWidth={1000}
        menu={(overflow) => (
          <ViewsMenu
            full={false}
            overflow={overflow}
            onPick={onChange}
            onManage={() => {}}
            onNew={() => {}}
          />
        )}
      />,
    );
    // The first four, and the selected V6.
    expect(screen.getAllByRole("radio").map((b) => b.textContent)).toEqual([
      "All",
      "Underfunded",
      "Overfunded",
      "Money Available",
      "V6",
    ]);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent?.trim())).toEqual([
      "Snoozed",
      "V1",
      "V2",
      "V3",
      "V4",
      "V5",
      "Manage Views",
      "New View",
    ]);
    await userEvent.click(screen.getByRole("menuitem", { name: "V4" }));
    expect(onChange).toHaveBeenCalledWith("v4");
  });
});
