import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Account } from "@/lib/accounts";
import type { MoneySettings } from "@/lib/money-input";
import { type Draft, emptyDraft, emptyLine } from "@/lib/transactions";
import { registerColumns } from "./register-columns";
import { type EditorFocus, TransactionEditor } from "./transaction-editor";

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

/** The register's columns with Outflow and Inflow folded into one Amount (a narrow register). */
const folded = registerColumns(false).flatMap((c) =>
  c === "outflow" ? (["amount"] as const) : c === "inflow" ? [] : [c],
);

function renderEditor(
  accountId = "checking",
  {
    another = false,
    columns = registerColumns(false),
    initial,
    focusCell,
  }: {
    another?: boolean;
    columns?: ReturnType<typeof registerColumns>;
    initial?: Draft;
    focusCell?: EditorFocus;
  } = {},
) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const onSaveAndAddAnother = vi.fn();
  const onRenameFlags = vi.fn(async () => {});
  render(
    <table>
      <tbody>
        <TransactionEditor
          initial={initial ?? emptyDraft(accountId, "2026-10-01")}
          focusCell={focusCell}
          columns={columns}
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
    // Enter's action is the primary button; Save, which closes the row, is the quieter one.
    expect(screen.getByRole("button", { name: "Save and add another" })).toHaveAttribute(
      "data-variant",
      "default",
    );
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("data-variant", "outline");
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
    // Said once, by the button.
    expect(screen.getAllByText(/Bakery/)).toHaveLength(1);
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
    // Typed on, the name completes; Backspace takes the completion off.
    expect(screen.getByLabelText("Payee")).toHaveValue("Market");
    await user.keyboard("{Backspace}");
    await user.click(screen.getByRole("button", { name: "Create “Mar” Payee" }));
    expect(screen.getByLabelText("Payee")).toHaveValue("Mar");
    expect(screen.getByLabelText("Category")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ payeeName: "Mar" }), null);
  });

  it("completes a typed payee in the field, keeping it as you type on and on Tab", async () => {
    renderEditor();
    const user = userEvent.setup();
    const payee = screen.getByLabelText("Payee") as HTMLInputElement;
    await user.type(payee, "ma");
    expect(payee).toHaveValue("Market");
    expect([payee.selectionStart, payee.selectionEnd]).toEqual([2, 6]);
    // Typing the next letter of the completion replaces the selection and completes again.
    await user.keyboard("r");
    expect(payee).toHaveValue("Market");
    expect([payee.selectionStart, payee.selectionEnd]).toEqual([3, 6]);
    await user.keyboard("{Tab}");
    expect(payee).toHaveValue("Market");
  });

  describe("opened by a click on a cell", () => {
    const split: Draft = {
      ...emptyDraft("checking", "2026-10-01"),
      payeeName: "Market",
      memo: "Weekly shop",
      outflow: "30.00",
      lines: [
        emptyLine({ categoryId: "groceries", outflow: "20.00" }),
        emptyLine({ categoryId: "rent", outflow: "10.00", payeeName: "Landlord" }),
      ],
    };

    it("starts in the clicked field instead of the date", async () => {
      renderEditor("checking", { initial: split, focusCell: { column: "memo" } });
      await waitFor(() => expect(screen.getByLabelText("Memo")).toHaveFocus());
      expect(screen.getByLabelText("Date")).not.toHaveFocus();
    });

    it("selects a clicked amount, so typing replaces it", async () => {
      renderEditor("checking", { initial: split, focusCell: { column: "outflow" } });
      const outflow = screen.getByLabelText("Outflow") as HTMLInputElement;
      await waitFor(() => expect(outflow).toHaveFocus());
      expect([outflow.selectionStart, outflow.selectionEnd]).toEqual([0, outflow.value.length]);
    });

    it("starts in a split line's field, and in the first line's category for the split's", async () => {
      renderEditor("checking", { initial: split, focusCell: { column: "payee", line: 1 } });
      await waitFor(() => expect(screen.getByLabelText("Payee, line 2")).toHaveFocus());
    });

    it("starts in the first line's category for the split's own category", async () => {
      renderEditor("checking", { initial: split, focusCell: { column: "category" } });
      await waitFor(() => expect(screen.getByLabelText("Category, line 1")).toHaveFocus());
    });
  });

  it("opens an empty category's closed list on Enter instead of saving", async () => {
    const { onSave } = renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Category"));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("option", { name: "Rent" })).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("option", { name: "Rent" })).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
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
    expect(screen.getByText("Split into 2 lines")).toBeInTheDocument();
    // The amount reads as the budget writes amounts once it's left.
    expect(screen.getByLabelText("Outflow")).toHaveValue("120.00");
    // The first line starts with the whole amount, selected so typing replaces it.
    const first = screen.getByLabelText("Outflow, line 1") as HTMLInputElement;
    await waitFor(() => expect(first).toHaveFocus());
    expect(first).toHaveValue("120.00");
    expect([first.selectionStart, first.selectionEnd]).toEqual([0, 6]);
    expect(screen.getByLabelText("Outflow, line 2")).toHaveValue("");
    expect(screen.getByText("Fully split")).toBeInTheDocument();

    // The last empty line takes the rest once the other's amount changes.
    await user.keyboard("80");
    // What's left is only a count while the lines are being typed, not an error.
    expect(screen.getByText("$40.00 left to split")).not.toHaveClass("text-destructive");
    await user.tab();
    expect(screen.getByLabelText("Outflow, line 1")).toHaveValue("80.00");
    expect(screen.getByLabelText("Outflow, line 2")).toHaveValue("40.00");
    expect(screen.getByText("Fully split")).toHaveClass("text-success");
    await user.click(screen.getByRole("button", { name: "Add line" }));
    await user.click(screen.getByRole("button", { name: "Remove line 3" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        outflow: "120.00",
        lines: [
          expect.objectContaining({ outflow: "80.00" }),
          expect.objectContaining({ outflow: "40.00" }),
        ],
      }),
      null,
    );
  });

  it("moves to the first line's amount once split from the category list", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Inflow"), "50");
    await user.click(screen.getByLabelText("Category"));
    await user.click(screen.getByRole("option", { name: "Split" }));
    // On the transaction's side: an inflow's lines start in Inflow.
    await waitFor(() => expect(screen.getByLabelText("Inflow, line 1")).toHaveFocus());
  });

  it("edits a folded Amount, its sign switched by its button or a typed + or -", async () => {
    const { onSave } = renderEditor("checking", { columns: folded });
    const user = userEvent.setup();
    expect(screen.queryByLabelText("Inflow")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Outflow"), "+25");
    expect(screen.getByLabelText("Inflow")).toHaveValue("25");
    await user.click(screen.getByRole("button", { name: "Make it an outflow" }));
    expect(screen.getByLabelText("Outflow")).toHaveValue("25.00");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ outflow: "25.00", inflow: "" }),
      null,
    );

    await user.clear(screen.getByLabelText("Outflow"));
    await user.type(screen.getByLabelText("Outflow"), "+12");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ outflow: "", inflow: "12.00" }),
      null,
    );
  });

  it("splits within a folded Amount, each line on the transaction's side", async () => {
    const { onSave } = renderEditor("checking", { columns: folded });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Outflow"), "120");
    await user.click(screen.getByLabelText("Category"));
    await user.click(screen.getByRole("option", { name: "Split" }));
    await waitFor(() => expect(screen.getByLabelText("Outflow, line 1")).toHaveFocus());
    expect(screen.getByLabelText("Outflow, line 1")).toHaveValue("120.00");
    await user.keyboard("80");
    await user.tab();
    expect(screen.getByLabelText("Outflow, line 2")).toHaveValue("40.00");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [
          expect.objectContaining({ outflow: "80.00" }),
          expect.objectContaining({ outflow: "40.00" }),
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
    await user.clear(screen.getByLabelText("Outflow, line 1"));
    await user.type(screen.getByLabelText("Outflow, line 1"), "3");
    await user.clear(screen.getByLabelText("Outflow, line 2"));
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
    await user.clear(screen.getByLabelText("Outflow, line 1"));
    await user.type(screen.getByLabelText("Outflow, line 1"), "3");
    await user.clear(screen.getByLabelText("Outflow, line 2"));
    await user.type(screen.getByLabelText("Outflow, line 2"), "4");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(await screen.findByRole("button", { name: "Adjust Manually" }));
    expect(screen.getByLabelText("Outflow")).toHaveValue("10.00");
    // Saving found the lines short, so what's left now reads as a problem.
    expect(screen.getByText("$3.00 left to split")).toHaveClass("text-destructive");
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
  function renderStacked(
    props: { focusAmount?: boolean; recentPayees?: string[]; allAccounts?: boolean } = {},
  ) {
    const onSave = vi.fn();
    const { allAccounts = false, ...rest } = props;
    render(
      <TransactionEditor
        layout="stacked"
        initial={emptyDraft("checking", "2026-10-01")}
        columns={registerColumns(allAccounts)}
        accounts={[account("checking", "checking"), account("savings", "savings")]}
        payees={[
          {
            id: "p1",
            name: "Market",
            hidden: false,
            useCount: 3,
            categorization: "auto",
            defaultCategoryId: null,
            autoCategoryId: "rent",
            prefillCategoryId: "rent",
            recentCategoryIds: ["rent"],
          },
        ]}
        categories={[{ id: "rent", name: "Rent", group: "Bills" }]}
        dateFormat="MM/DD/YYYY"
        settings={usd}
        flags={[]}
        onRenameFlags={async () => {}}
        pending={false}
        error={null}
        onSave={onSave}
        onCancel={vi.fn()}
        {...rest}
      />,
    );
    return { onSave, form: screen.getByRole("form", { name: "New transaction" }) };
  }

  it("names each field, opens without focusing one, and saves", async () => {
    const { onSave, form } = renderStacked();
    for (const name of ["Date", "Payee", "Category", "Memo", "Outflow", "Inflow"]) {
      expect(within(form).getByText(name)).toBeInTheDocument();
    }
    // The memo is named above it, not again inside it.
    expect(within(form).getByLabelText("Memo")).not.toHaveAttribute("placeholder");
    expect(document.activeElement).toBe(document.body);
    const user = userEvent.setup();
    await user.type(within(form).getByLabelText("Outflow"), "12.5");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ outflow: "12.50" }), null);
  });

  it("starts in the amount, switched between outflow and inflow, with recent payees a tap away", async () => {
    const { onSave, form } = renderStacked({ focusAmount: true, recentPayees: ["Market"] });
    const amount = within(form).getByLabelText("Outflow");
    expect(amount).toHaveFocus();
    expect(amount).toHaveAttribute("inputmode", "decimal");
    const user = userEvent.setup();
    await user.keyboard("40");
    await user.click(within(form).getByRole("radio", { name: "Inflow" }));
    expect(within(form).getByLabelText("Inflow")).toHaveValue("40.00");
    await user.click(within(form).getByRole("button", { name: "Market" }));
    expect(within(form).getByLabelText("Payee")).toHaveValue("Market");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    // The payee's category comes with it.
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        inflow: "40.00",
        outflow: "",
        payeeName: "Market",
        categoryId: "rent",
      }),
      null,
    );
  });
});

describe("TransactionEditor, stacked in All Accounts", () => {
  it("starts in the amount, not the account list", () => {
    render(
      <TransactionEditor
        layout="stacked"
        focusAmount
        initial={emptyDraft("checking", "2026-10-01")}
        columns={registerColumns(true)}
        accounts={[account("checking", "checking"), account("savings", "savings")]}
        payees={[]}
        categories={[]}
        dateFormat="MM/DD/YYYY"
        settings={usd}
        flags={[]}
        onRenameFlags={async () => {}}
        pending={false}
        error={null}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Account")).not.toHaveFocus();
    expect(screen.getByLabelText("Outflow")).toHaveFocus();
  });
});

describe("TransactionEditor in a register without room for Memo", () => {
  it("edits the memo in its footer, and each split line's before its payee", async () => {
    renderEditor("checking", {
      columns: registerColumns(false).filter((c) => c !== "memo"),
    });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Memo"), "Lunch");
    await user.type(screen.getByLabelText("Outflow"), "20");
    await user.click(screen.getByLabelText("Category"));
    await user.click(screen.getByRole("option", { name: "Split" }));
    // Splitting moves to the first line's amount; then on to its memo.
    await waitFor(() => expect(screen.getByLabelText("Outflow, line 1")).toHaveFocus());
    await user.type(screen.getByLabelText("Memo, line 1"), "Mine");
    expect(screen.getByLabelText("Memo")).toHaveValue("Lunch");
    expect(screen.getByLabelText("Memo, line 1")).toHaveValue("Mine");
    // The line's memo spans the cells its row leaves empty, before the payee.
    expect(screen.getByLabelText("Memo, line 1").closest("td")).toHaveAttribute("colspan");
  });
});
