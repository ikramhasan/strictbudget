import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type CategoryList, categoriesQueryOptions } from "@/lib/categories";
import type { Payee } from "@/lib/transactions";
import { PayeeCategorizationSection } from "./payee-categorization";

vi.mock("@/lib/budget-context", () => ({ useBudget: () => ({ budget: { id: "b1" } }) }));

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
  target: null,
});

const list = {
  readyToAssignCategoryId: "rta",
  uncategorizedCategoryId: "uncat",
  groups: [
    {
      id: "g1",
      name: "Bills",
      hidden: false,
      kind: null,
      categories: [category("rent", "g1", "Rent"), category("old", "g1", "Old", true)],
    },
    {
      id: "g2",
      name: "Everyday",
      hidden: false,
      kind: null,
      categories: [category("food", "g2", "Food")],
    },
  ],
} as unknown as CategoryList;

const market: Payee = {
  id: "p1",
  name: "Market",
  hidden: false,
  useCount: 2,
  categorization: "auto",
  defaultCategoryId: null,
  autoCategoryId: "rent",
  prefillCategoryId: "rent",
  recentCategoryIds: ["rent"],
};

function renderSection(payee: Payee) {
  const client = new QueryClient();
  client.setQueryData(categoriesQueryOptions("b1").queryKey, list);
  const onChange = vi.fn(async () => {});
  render(
    <QueryClientProvider client={client}>
      <PayeeCategorizationSection payee={payee} busy={false} onChange={onChange} />
    </QueryClientProvider>,
  );
  return { onChange };
}

describe("PayeeCategorizationSection (Manage Payees)", () => {
  it("shows the current default category while auto-categorizing", () => {
    renderSection(market);
    expect(screen.getByLabelText("Auto-categorize based on payee history")).toBeChecked();
    expect(screen.getByText("Current default category:")).toBeInTheDocument();
    expect(screen.getByText("Bills: Rent")).toBeInTheDocument();
  });

  it("says Not yet set without a default", () => {
    renderSection({ ...market, autoCategoryId: null, prefillCategoryId: null });
    expect(screen.getByText("Not yet set")).toBeInTheDocument();
  });

  it("saves Always use my choice only once a category is picked", async () => {
    const { onChange } = renderSection(market);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Always use my choice"));
    expect(onChange).not.toHaveBeenCalled();
    const select = screen.getByLabelText("Category to always use");
    // Ready to Assign and the visible categories, by group.
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "",
      "Ready to Assign",
      "Rent",
      "Food",
    ]);
    await user.selectOptions(select, "food");
    expect(onChange).toHaveBeenCalledWith({ categorization: "always", defaultCategoryId: "food" });
  });

  it("turns auto-categorizing off", async () => {
    const { onChange } = renderSection(market);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Do not auto-categorize Market"));
    expect(onChange).toHaveBeenCalledWith({ categorization: "never", defaultCategoryId: null });
  });

  it("shows the chosen category", () => {
    renderSection({ ...market, categorization: "always", defaultCategoryId: "food" });
    expect(screen.getByLabelText("Category to always use")).toHaveValue("food");
  });
});
