import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Account } from "@/lib/accounts";
import type { MoneySettings } from "@/lib/money-input";
import { emptyDraft } from "@/lib/transactions";
import { registerColumns } from "./register-columns";
import { TransactionEditor } from "./transaction-editor";

const usd: MoneySettings = {
  currency: "USD",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
};

const account = (id: string, type: Account["type"]): Account => ({
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
  balances: { cleared: "0", uncleared: "0", working: "0" },
});

function renderEditor(accountId = "checking", { another = false } = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const onSaveAndAddAnother = vi.fn();
  const onRenameFlags = vi.fn(async () => {});
  render(
    <table>
      <tbody>
        <TransactionEditor
          initial={emptyDraft(accountId, "2026-10-01")}
          columns={registerColumns(false)}
          accounts={[
            account("checking", "checking"),
            account("savings", "savings"),
            account("brokerage", "asset"),
            account("visa", "credit_card"),
          ]}
          payees={[
            {
              id: "p1",
              name: "Market",
              hidden: false,
              useCount: 3,
              categorization: "auto",
              defaultCategoryId: null,
              autoCategoryId: "groceries",
              prefillCategoryId: "groceries",
              recentCategoryIds: ["rent", "groceries", "gone"],
            },
          ]}
          categories={[
            { id: "rta", name: "Ready to Assign", group: "Inflow" },
            { id: "groceries", name: "Groceries", group: "Everyday" },
            { id: "rent", name: "Rent", group: "Bills" },
          ]}
          dateFormat="MM/DD/YYYY"
          settings={usd}
          flags={[
            { color: "red", name: "Reimbursable" },
            { color: "blue", name: "" },
          ]}
          onRenameFlags={onRenameFlags}
          pending={false}
          error={null}
          transferCategory={(from, to) =>
            [from, to].includes("visa") && [from, to].includes("checking")
              ? "Credit Card Payments: visa"
              : ""
          }
          onSave={onSave}
          onSaveAndAddAnother={another ? onSaveAndAddAnother : undefined}
          onCancel={onCancel}
        />
      </tbody>
    </table>,
  );
  return { onSave, onCancel, onRenameFlags, onSaveAndAddAnother };
}

describe("TransactionEditor", () => {
  it("fills in a known payee's last category and saves on Enter", async () => {
    const { onSave } = renderEditor();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Payee"), "mar");
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("Payee")).toHaveValue("Market");
    expect(screen.getByLabelText("Category")).toHaveValue("Groceries");
    expect(onSave).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Outflow"), "12.50{Enter}");
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        payeeName: "Market",
        categoryId: "groceries",
        outflow: "12.50",
        inflow: "",
      }),
      null,
    );
  });

  it("lists the selected category and the payee's other recent ones first", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Payee"), "Market");
    await user.keyboard("{Enter}");
    await user.click(screen.getByLabelText("Category"));
    const groups = within(screen.getByRole("listbox")).getAllByRole("group");
    expect(groups[0]).toHaveTextContent(/^Selected\s*Groceries \(Everyday\)$/);
    // Rent only: Groceries is selected, and categories no longer listed are skipped.
    expect(groups[1]).toHaveTextContent(/^Suggested\s*Rent \(Bills\)$/);
    expect(groups[2]).toHaveTextContent(/^Inflow/);

    await user.click(screen.getByRole("option", { name: "Rent (Bills)" }));
    expect(screen.getByLabelText("Category")).toHaveValue("Rent");

    await user.clear(screen.getByLabelText("Category"));
    await user.type(screen.getByLabelText("Category"), "Gro");
    expect(screen.queryByText("Suggested")).not.toBeInTheDocument();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Groceries"]);
  });

  it("lists the selected category without a payee too", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Category"));
    expect(within(screen.getByRole("listbox")).getAllByRole("group")[0]).toHaveTextContent(
      /^Inflow/,
    );
    await user.click(screen.getByRole("option", { name: "Rent" }));
    await user.click(screen.getByLabelText("Category"));
    const groups = within(screen.getByRole("listbox")).getAllByRole("group");
    expect(groups[0]).toHaveTextContent(/^Selected\s*Rent \(Bills\)$/);
    expect(groups[1]).toHaveTextContent(/^Inflow/);
    // Ticked in both places.
    expect(screen.getByRole("option", { name: "Rent (Bills)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("option", { name: "Rent" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "Groceries" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("suggests a split line's categories from its own payee only", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Payee"), "Market");
    await user.keyboard("{Enter}");
    await user.type(screen.getByLabelText("Outflow"), "20");
    await user.click(screen.getByLabelText("Category"));
    await user.click(screen.getByRole("option", { name: "Split" }));

    // Line 1 has no payee of its own: Selected only, nothing from the transaction's payee.
    await user.click(screen.getByLabelText("Category, line 1"));
    await user.click(screen.getByRole("option", { name: "Rent" }));
    await user.click(screen.getByLabelText("Category, line 1"));
    let groups = within(screen.getByRole("listbox")).getAllByRole("group");
    expect(groups[0]).toHaveTextContent(/^Selected\s*Rent \(Bills\)$/);
    expect(groups[1]).toHaveTextContent(/^Inflow/);
    await user.keyboard("{Escape}");

    // Line 2 with the payee Market: its recent categories.
    await user.type(screen.getByLabelText("Payee, line 2"), "Market");
    await user.keyboard("{Enter}");
    await user.click(screen.getByLabelText("Category, line 2"));
    groups = within(screen.getByRole("listbox")).getAllByRole("group");
    expect(groups[0]).toHaveTextContent(/^Selected\s*Groceries \(Everyday\)$/);
    expect(groups[1]).toHaveTextContent(/^Suggested\s*Rent \(Bills\)$/);
  });

  it("offers Save and add another on a new row, and Enter does it", async () => {
    const { onSave, onSaveAndAddAnother } = renderEditor("checking", { another: true });
    const user = userEvent.setup();
    expect(screen.getByRole("button", { name: "Save and add another" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Outflow"), "5{Enter}");
    expect(onSaveAndAddAnother).toHaveBeenCalledWith(
      expect.objectContaining({ outflow: "5" }),
      null,
    );
    await user.click(screen.getByRole("button", { name: "Save and add another" }));
    expect(onSaveAndAddAnother).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("starts cleared in a cash account, and re-applies it when a new row's account changes", async () => {
    const user = userEvent.setup();
    const onSaveAndAddAnother = vi.fn();
    render(
      <table>
        <tbody>
          <TransactionEditor
            initial={emptyDraft("wallet", "2026-10-01", "cash")}
            columns={registerColumns(true)}
            accounts={[account("wallet", "cash"), account("checking", "checking")]}
            payees={[]}
            categories={[]}
            dateFormat="MM/DD/YYYY"
            settings={usd}
            flags={[]}
            onRenameFlags={vi.fn(async () => {})}
            pending={false}
            error={null}
            onSave={vi.fn()}
            onSaveAndAddAnother={onSaveAndAddAnother}
            onCancel={vi.fn()}
          />
        </tbody>
      </table>,
    );
    expect(screen.getByRole("button", { name: "Cleared" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Account"), "checking");
    expect(screen.getByRole("button", { name: "Uncleared" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Uncleared" }));
    await user.selectOptions(screen.getByLabelText("Account"), "wallet");
    await user.selectOptions(screen.getByLabelText("Account"), "checking");
    expect(screen.getByRole("button", { name: "Uncleared" })).toBeInTheDocument();
  });

  it("has no Save and add another when editing", () => {
    renderEditor();
    expect(screen.queryByRole("button", { name: "Save and add another" })).not.toBeInTheDocument();
  });

  it("creates a new payee from typed text", async () => {
    const { onSave } = renderEditor();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Payee"), "Bakery");
    expect(screen.getByRole("button", { name: "Create “Bakery” Payee" })).toBeInTheDocument();
    expect(screen.getByText("“Bakery” will be created as a payee.")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ payeeName: "Bakery" }), null);
  });

  it("lists the chosen payee under Selected when the field is opened again", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Payee"), "Market");
    await user.keyboard("{Enter}");
    await user.click(screen.getByLabelText("Category"));
    await user.click(screen.getByLabelText("Payee"));
    const groups = within(screen.getByRole("listbox")).getAllByRole("group");
    expect(groups[0]).toHaveTextContent(/^SelectedMarket$/);
    expect(groups[1]).toHaveTextContent(/^Payments and Transfers/);
    expect(groups[2]).toHaveTextContent(/^Saved PayeesMarket$/);
  });

  it("creates the typed payee from the button even when a payee matches", async () => {
    const { onSave } = renderEditor();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Payee"), "Mar");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Market"]);
    await user.click(screen.getByRole("button", { name: "Create “Mar” Payee" }));
    expect(screen.getByLabelText("Payee")).toHaveValue("Mar");
    expect(screen.getByLabelText("Category")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ payeeName: "Mar" }), null);
  });

  it("closes an open list on Esc before cancelling the row", async () => {
    const { onCancel } = renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Category"));
    expect(screen.getByRole("option", { name: "Rent" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("option", { name: "Rent" })).not.toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
  });

  it("clears the other amount field when one is typed", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Outflow"), "5");
    await user.type(screen.getByLabelText("Inflow"), "7");
    expect(screen.getByLabelText("Outflow")).toHaveValue("");
    expect(screen.getByLabelText("Inflow")).toHaveValue("7");
  });

  it("doesn't ask tracking accounts for a category", () => {
    renderEditor("brokerage");
    expect(screen.queryByLabelText("Category")).not.toBeInTheDocument();
    expect(screen.getByText("Category not needed")).toBeInTheDocument();
  });

  it("drops the category for a transfer within the budget, keeps it for one leaving it", async () => {
    const { onSave } = renderEditor();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Payee"), "savings");
    await user.keyboard("{Enter}");
    // No amount yet, so the "To/From" wording.
    expect(screen.getByLabelText("Payee")).toHaveValue("To/From savings");
    expect(screen.getByText("Category not needed")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Payee"));
    await user.type(screen.getByLabelText("Payee"), "brokerage");
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("Category")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Outflow"), "10{Enter}");
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        transferAccountId: "brokerage",
        payeeName: "To/From brokerage",
      }),
      null,
    );
  });

  it("doesn't offer the account itself as a transfer", async () => {
    renderEditor();
    await userEvent.setup().click(screen.getByLabelText("Payee"));
    expect(screen.queryByRole("option", { name: "To/From checking" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "To/From savings" })).toBeInTheDocument();
  });

  it("shows a card payment's category and offers the card's Payment to", async () => {
    renderEditor("visa");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Inflow"), "5");
    await user.click(screen.getByLabelText("Payee"));
    expect(screen.getByRole("option", { name: "Payment from checking" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Payment from brokerage" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Payment from checking" }));
    expect(screen.getByText("Credit Card Payments: visa")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Payee"));
    await user.type(screen.getByLabelText("Payee"), "Market{Enter}");
    await user.click(screen.getByLabelText("Category"));
    await user.click(screen.getByRole("option", { name: "Payment to visa" }));
    expect(screen.getByLabelText("Payee")).toHaveValue("");
    expect(screen.getByLabelText("Payee")).toHaveFocus();
    expect(screen.getByLabelText("Category")).toHaveValue("");
  });

  it("words transfers by the amount's direction", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Outflow"), "5");
    await user.click(screen.getByLabelText("Payee"));
    expect(screen.getByText("Payments and Transfers")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Transfer to savings" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Transfer to savings" }));
    expect(screen.getByLabelText("Payee")).toHaveValue("Transfer to savings");
  });

  it("lists transfers first until something is typed", async () => {
    renderEditor();
    const user = userEvent.setup();
    const headings = () =>
      screen
        .getAllByText(/^(Saved Payees|Payments and Transfers)$/)
        .map((element) => element.textContent);
    await user.click(screen.getByLabelText("Payee"));
    expect(headings()).toEqual(["Payments and Transfers", "Saved Payees"]);
    await user.type(screen.getByLabelText("Payee"), "a");
    expect(headings()).toEqual(["Saved Payees", "Payments and Transfers"]);
  });

  it("offers Payment/Transfer in the category list, back to the payee list", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Payee"), "Market{Enter}");
    expect(screen.getByLabelText("Category")).toHaveValue("Groceries");
    await user.click(screen.getByLabelText("Category"));
    await user.click(screen.getByRole("option", { name: "Payment/Transfer" }));
    // The payee and category stay; the payee list opens to pick an account.
    expect(screen.getByLabelText("Payee")).toHaveFocus();
    expect(screen.getByLabelText("Payee")).toHaveValue("Market");
    expect(screen.getByLabelText("Category")).toHaveValue("Groceries");
    expect(screen.getByRole("option", { name: "To/From savings" })).toBeInTheDocument();
  });

  it("splits across categories, with a remaining counter", async () => {
    const { onSave } = renderEditor();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Outflow"), "120");
    await user.click(screen.getByLabelText("Category"));
    await user.click(screen.getByRole("option", { name: "Split" }));
    expect(screen.getByText("Split (2 lines)")).toBeInTheDocument();
    expect(screen.getByText("120.00 left to split")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Outflow, line 1"), "80");
    await user.type(screen.getByLabelText("Outflow, line 2"), "40");
    expect(screen.getByText("Fully split")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add line" }));
    await user.click(screen.getByRole("button", { name: "Remove line 3" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        outflow: "120",
        lines: [
          expect.objectContaining({ outflow: "80" }),
          expect.objectContaining({ outflow: "40" }),
        ],
      }),
      null,
    );
  });

  it("asks what to do with a split that doesn't add up", async () => {
    const { onSave, onCancel } = renderEditor();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Outflow"), "10");
    await user.click(screen.getByLabelText("Category"));
    await user.click(screen.getByRole("option", { name: "Split" }));
    await user.type(screen.getByLabelText("Outflow, line 1"), "3");
    await user.type(screen.getByLabelText("Outflow, line 2"), "4");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    const prompt = await screen.findByRole("alertdialog");
    expect(prompt).toHaveTextContent("Something Doesn't Add Up");
    expect(prompt).toHaveTextContent(
      "The total is -$10.00, but the splits add up to -$7.00. How would you like to handle " +
        "the unassigned -$3.00?",
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    // Auto-Distribute: 3 and 4 share the $3; the row stays open.
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(await screen.findByRole("button", { name: "Auto-Distribute" }));
    expect(screen.getByLabelText("Outflow, line 1")).toHaveValue("4.29");
    expect(screen.getByLabelText("Outflow, line 2")).toHaveValue("5.71");
    expect(onSave).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("updates the split's total to its lines' sum, or leaves it to be fixed by hand", async () => {
    const { onSave } = renderEditor();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Outflow"), "10");
    await user.click(screen.getByLabelText("Category"));
    await user.click(screen.getByRole("option", { name: "Split" }));
    await user.type(screen.getByLabelText("Outflow, line 1"), "3");
    await user.type(screen.getByLabelText("Outflow, line 2"), "4");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(await screen.findByRole("button", { name: "Adjust Manually" }));
    expect(screen.getByLabelText("Outflow")).toHaveValue("10");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(await screen.findByRole("button", { name: "Update Total" }));
    expect(screen.getByLabelText("Outflow")).toHaveValue("7.00");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("doesn't offer a split on a transfer", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Category"));
    expect(screen.getByRole("option", { name: "Split" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.type(screen.getByLabelText("Payee"), "brokerage");
    await user.keyboard("{Enter}");
    await user.click(screen.getByLabelText("Category"));
    expect(screen.queryByRole("option", { name: "Split" })).not.toBeInTheDocument();
  });

  it("flags a new transaction and renames flags", async () => {
    const { onSave, onRenameFlags } = renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add flag" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Reimbursable (Red)" }));
    expect(screen.getByRole("button", { name: "Flag: Reimbursable (Red)" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Flag: Reimbursable (Red)" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit names" }));
    await user.type(screen.getByLabelText("Name for Blue"), "Tax");
    await user.click(screen.getByRole("button", { name: "Save names" }));
    expect(onRenameFlags).toHaveBeenCalledWith([{ color: "blue", name: "Tax" }]);

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ flag: "red" }), null);
  });
});

describe("TransactionEditor, stacked for a phone's drawer", () => {
  it("names each field, opens without focusing one, and saves", async () => {
    const onSave = vi.fn();
    render(
      <TransactionEditor
        layout="stacked"
        initial={emptyDraft("checking", "2026-10-01")}
        columns={registerColumns(false)}
        accounts={[account("checking", "checking")]}
        payees={[]}
        categories={[{ id: "rent", name: "Rent", group: "Bills" }]}
        dateFormat="MM/DD/YYYY"
        settings={usd}
        flags={[]}
        onRenameFlags={async () => {}}
        pending={false}
        error={null}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    const form = screen.getByRole("form", { name: "New transaction" });
    for (const name of ["Date", "Payee", "Category", "Memo", "Outflow", "Inflow"]) {
      expect(within(form).getByText(name)).toBeInTheDocument();
    }
    expect(document.activeElement).toBe(document.body);
    const user = userEvent.setup();
    await user.type(within(form).getByLabelText("Outflow"), "12.50");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ outflow: "12.50" }), null);
  });
});
