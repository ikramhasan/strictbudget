import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Budget } from "@/lib/budgets";
import { AddAccountDialog } from "./add-account-dialog";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
let nextId = 0;
const created: string[] = [];
vi.mock("@/lib/use-create-account", () => ({
  useCreateAccount: () => async (values: { name: string }) => {
    created.push(values.name);
    nextId += 1;
    return { id: `acc${nextId}` };
  },
}));
vi.mock("@/lib/categories", () => ({
  categoriesQueryOptions: () => ({ queryKey: ["categories"], queryFn: () => ({ groups: [] }) }),
}));

const budget = {
  id: "b1",
  currency: "USD",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
} as Budget;

async function addAccount(name: string) {
  await userEvent.type(screen.getByLabelText("Nickname"), name);
  await userEvent.type(screen.getByLabelText("What's the balance today?"), "10");
  await userEvent.click(screen.getByRole("button", { name: "Add account" }));
}

describe("AddAccountDialog", () => {
  it("offers Add Another and Done after adding an account", async () => {
    const onOpenChange = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AddAccountDialog budget={budget} open onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    );
    await addAccount("Checking");
    expect(await screen.findByText("Success!")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Add Another" }));
    expect(screen.getByLabelText("Nickname")).toHaveValue("");
    await addAccount("Savings");
    expect(created).toEqual(["Checking", "Savings"]);
    expect(navigate).not.toHaveBeenCalled();

    await userEvent.click(await screen.findByRole("button", { name: "Done" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(navigate).toHaveBeenCalledWith({
      to: "/budgets/$budgetId/accounts/$accountId",
      params: { budgetId: "b1", accountId: "acc2" },
    });
  });
});
