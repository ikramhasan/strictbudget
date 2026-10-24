import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MoneySettings } from "@/lib/money-input";
import type { CellColumn, Payee, Transaction } from "@/lib/transactions";
import { CellEditor } from "./cell-editor";

const usd: MoneySettings = {
  currency: "USD",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
};

const txn: Transaction = {
  id: "t1",
  accountId: "a1",
  accountName: "Checking",
  date: "2026-10-01",
  amount: "-2500",
  currency: "USD",
  baseAmount: "0",
  fxRate: null,
  fxRateManual: false,
  payeeId: null,
  payeeName: "Market",
  categoryId: null,
  categoryName: null,
  memo: "",
  cleared: "uncleared",
  transferAccountId: null,
  transferTransactionId: null,
  flag: null,
  approved: true,
  needsCategory: false,
  imported: false,
  importedPayee: null,
  matched: null,
  transferFromSplit: false,
  transferReconciled: false,
  transferSide: null,
  subtransactions: [],
  runningBalance: "0",
  matchingLineIds: null,
  enteredBy: null,
  attachment: null,
  changedBy: null,
  version: 1,
};

function renderCell(column: CellColumn, transaction = txn, payees: Payee[] = []) {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(
    <CellEditor
      transaction={transaction}
      column={column}
      settings={usd}
      dateFormat="MM/DD/YYYY"
      accounts={[]}
      payees={payees}
      transfers={[{ id: "savings", name: "Savings" }]}
      categories={[{ id: "rent", name: "Rent", group: "Bills" }]}
      onCommit={onCommit}
      onCancel={onCancel}
    />,
  );
  return { onCommit, onCancel };
}

describe("CellEditor", () => {
  it("starts with the cell's value selected and saves on Enter", async () => {
    const { onCommit } = renderCell("outflow");
    const user = userEvent.setup();
    expect(screen.getByLabelText("Outflow")).toHaveValue("25.00");
    await user.keyboard("230+30{Enter}");
    expect(onCommit).toHaveBeenCalledWith("230+30", "stay", null);
  });

  it("saves and moves on with Tab, backwards with Shift+Tab", async () => {
    const { onCommit } = renderCell("memo");
    const user = userEvent.setup();
    await user.keyboard("weekly{Tab}");
    expect(onCommit).toHaveBeenCalledWith("weekly", "next", null);
  });

  it("cancels on Esc without saving", async () => {
    const { onCommit, onCancel } = renderCell("memo");
    await userEvent.setup().keyboard("x{Escape}");
    expect(onCancel).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("saves a category as soon as one is picked", async () => {
    const { onCommit } = renderCell("category");
    const user = userEvent.setup();
    await user.keyboard("ren");
    await user.click(await screen.findByRole("option", { name: "Rent" }));
    expect(onCommit).toHaveBeenCalledWith("rent", "stay", null);
  });

  it("lists an existing row's category under Selected", async () => {
    renderCell("category", { ...txn, categoryId: "rent", categoryName: "Rent" }, [
      {
        id: "p1",
        name: "Market",
        hidden: false,
        useCount: 1,
        categorization: "auto",
        defaultCategoryId: null,
        autoCategoryId: "rent",
        prefillCategoryId: "rent",
        recentCategoryIds: ["rent"],
      },
    ]);
    const groups = within(await screen.findByRole("listbox")).getAllByRole("group");
    // The row itself counts, but Rent is the one selected.
    expect(groups[0]).toHaveTextContent(/^Selected\s*Rent \(Bills\)$/);
    expect(groups[1]).toHaveTextContent(/^Bills/);
  });

  it("moves on with Tab from a payee while its list is open", async () => {
    const payee = renderCell("payee");
    const user = userEvent.setup();
    expect(screen.getByLabelText("Payee")).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Tab}");
    expect(payee.onCommit).toHaveBeenCalledWith("Market", "next", null);
  });

  it("moves on with Tab from a category while its list is open", async () => {
    const category = renderCell("category", { ...txn, categoryId: "rent", categoryName: "Rent" });
    const user = userEvent.setup();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(category.onCommit).toHaveBeenCalledWith("rent", "previous", null);
  });

  it("picks a transfer from the payee list", async () => {
    const { onCommit } = renderCell("payee");
    const user = userEvent.setup();
    await user.keyboard("{Control>}a{/Control}sav");
    expect(screen.getByText("Payments and Transfers")).toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: "Savings" }));
    expect(onCommit).toHaveBeenCalledWith("Transfer : Savings", "stay", "savings");
  });

  it("keeps a transfer a transfer when its payee is left as is", async () => {
    const transfer = { ...txn, payeeName: "Transfer : Savings", transferAccountId: "savings" };
    const { onCommit } = renderCell("payee", transfer);
    await userEvent.setup().keyboard("{Enter}");
    expect(onCommit).toHaveBeenCalledWith("Transfer : Savings", "stay", "savings");
  });

  it("opens the whole payee list and narrows it once you type", async () => {
    const payees = [
      {
        id: "p1",
        name: "Market",
        hidden: false,
        useCount: 1,
        categorization: "auto" as const,
        defaultCategoryId: null,
        autoCategoryId: null,
        prefillCategoryId: null,
        recentCategoryIds: [],
      },
      {
        id: "p2",
        name: "Bakery",
        hidden: false,
        useCount: 1,
        categorization: "auto" as const,
        defaultCategoryId: null,
        autoCategoryId: null,
        prefillCategoryId: null,
        recentCategoryIds: [],
      },
    ];
    const { onCommit } = renderCell("payee", txn, payees);
    const user = userEvent.setup();
    const options = () => screen.getAllByRole("option").map((o) => o.textContent);
    // The current payee under Selected, then transfers while nothing is typed.
    const groups = within(screen.getByRole("listbox")).getAllByRole("group");
    expect(groups[0]).toHaveTextContent(/^SelectedMarket$/);
    expect(options()).toEqual(["Market", "Savings", "Market", "Bakery"]);
    // The current payee is selected, so typing replaces it. Create is on top, but the first
    // match stays the highlighted one.
    await user.keyboard("bak");
    expect(options()).toEqual(["Bakery"]);
    expect(screen.getByRole("button", { name: "Create “bak” Payee" })).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(onCommit).toHaveBeenCalledWith("Bakery", "stay", null);
  });

  it("leaves hidden payees out of the list, but typing one's name uses it", async () => {
    const payees = [
      {
        id: "p1",
        name: "Market",
        hidden: false,
        useCount: 1,
        categorization: "auto" as const,
        defaultCategoryId: null,
        autoCategoryId: null,
        prefillCategoryId: null,
        recentCategoryIds: [],
      },
      {
        id: "p2",
        name: "Trip Cafe",
        hidden: true,
        useCount: 1,
        categorization: "auto" as const,
        defaultCategoryId: null,
        autoCategoryId: null,
        prefillCategoryId: null,
        recentCategoryIds: [],
      },
    ];
    const { onCommit } = renderCell("payee", txn, payees);
    const user = userEvent.setup();
    const options = () => screen.getAllByRole("option").map((o) => o.textContent);
    expect(options()).toEqual(["Market", "Savings", "Market"]);
    await user.keyboard("trip cafe");
    // No "Create payee": the name is a hidden payee's.
    expect(screen.queryAllByRole("option")).toEqual([]);
    expect(screen.queryByRole("button", { name: /Create/ })).not.toBeInTheDocument();
    expect(screen.getByText("1 matching payee is hidden")).toBeTruthy();
    await user.keyboard("{Enter}");
    expect(onCommit).toHaveBeenCalledWith("trip cafe", "stay", null);
  });

  it("keeps the payee when Enter is pressed without picking", async () => {
    const payees = [
      {
        id: "p2",
        name: "Bakery",
        hidden: false,
        useCount: 1,
        categorization: "auto" as const,
        defaultCategoryId: null,
        autoCategoryId: null,
        prefillCategoryId: null,
        recentCategoryIds: [],
      },
    ];
    const { onCommit } = renderCell("payee", txn, payees);
    await userEvent.setup().keyboard("{Enter}");
    expect(onCommit).toHaveBeenCalledWith("Market", "stay", null);
  });
});
