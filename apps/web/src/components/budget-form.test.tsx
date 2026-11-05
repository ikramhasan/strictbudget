import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetForm, type BudgetFormValues } from "./budget-form";

const NBSP = " ";

const defaults: BudgetFormValues = {
  name: "",
  currency: "USD",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
};

function renderForm(overrides: Partial<Parameters<typeof BudgetForm>[0]> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(null);
  render(
    <BudgetForm
      defaultValues={defaults}
      submitLabel="Create budget"
      pendingLabel="Creating…"
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  return onSubmit;
}

describe("BudgetForm", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 1, 12));
  });
  afterEach(() => vi.useRealTimers());

  it("keeps Save off until a saved setting changes", async () => {
    renderForm({
      defaultValues: { ...defaults, name: "Home" },
      requireChange: true,
      submitLabel: "Save changes",
    });
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Budget name"), " ");
    // Only spaces added: nothing to save.
    expect(save).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Date format"), "DD/MM/YYYY");
    expect(save).toBeEnabled();
  });

  it("previews the default settings", () => {
    renderForm();
    expect(screen.getByLabelText("Preview")).toHaveTextContent("-$1,234,567.89 · 10/01/2026");
  });

  it("updates the preview as settings change", async () => {
    renderForm();
    await userEvent.selectOptions(screen.getByLabelText("Number format"), "dot_comma");
    await userEvent.selectOptions(screen.getByLabelText("Currency symbol"), "after");
    await userEvent.selectOptions(screen.getByLabelText("Date format"), "DD.MM.YYYY");
    expect(screen.getByLabelText("Preview").textContent).toBe(`-1.234.567,89${NBSP}$ · 01.10.2026`);
  });

  it("submits the trimmed name with the chosen settings", async () => {
    const onSubmit = renderForm();
    await userEvent.type(screen.getByLabelText("Budget name"), "  Household ");
    await userEvent.selectOptions(screen.getByLabelText("Date format"), "YYYY-MM-DD");
    await userEvent.click(screen.getByRole("button", { name: "Create budget" }));
    expect(onSubmit).toHaveBeenCalledWith({
      ...defaults,
      name: "Household",
      dateFormat: "YYYY-MM-DD",
    });
  });

  it("asks for a name under the field instead of submitting a blank one", async () => {
    const onSubmit = renderForm();
    await userEvent.type(screen.getByLabelText("Budget name"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Create budget" }));
    expect(onSubmit).not.toHaveBeenCalled();
    const name = screen.getByLabelText("Budget name");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription(/give the budget a name/i);
  });

  it("shows the error returned by onSubmit", async () => {
    renderForm({ onSubmit: async () => "Something went wrong" });
    await userEvent.type(screen.getByLabelText("Budget name"), "Household");
    await userEvent.click(screen.getByRole("button", { name: "Create budget" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("locks the currency when editing", () => {
    renderForm({ currencyLocked: true, defaultValues: { ...defaults, name: "Home" } });
    expect(screen.getByLabelText("Currency")).toBeDisabled();
    expect(screen.getByText("Currency can't be changed after creation.")).toBeInTheDocument();
  });
});
