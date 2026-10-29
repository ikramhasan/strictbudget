import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AvailableButton, FixThisButton, type MoveActions } from "./move-money";

const format = (a: string) => `$${Number(a) / 100}`;

function makeActions(): MoveActions & { move: ReturnType<typeof vi.fn> } {
  return {
    options: [
      { id: "rta", name: "Ready to Assign", group: "Inflow", available: "100000" },
      { id: "rent", name: "Rent", group: "Bills", available: "5000" },
      { id: "phone", name: "Phone", group: "Bills", available: "-1500" },
      { id: "food", name: "Food", group: "Needs", available: "0" },
    ],
    readyToAssignId: "rta",
    parse: (text) => (/^\d+$/.test(text) ? BigInt(text) * 100n : "Enter an amount"),
    toInput: (a) => String(Number(a) / 100),
    move: vi.fn().mockResolvedValue(undefined),
    moveIn: vi.fn().mockResolvedValue(undefined),
  };
}

describe("AvailableButton", () => {
  it("covers overspending from a later month's assigned money", async () => {
    const actions = makeActions();
    const moveFrom = vi.fn().mockResolvedValue(undefined);
    render(
      <AvailableButton
        categoryId="phone"
        categoryName="Phone"
        amount="-200"
        format={format}
        actions={{
          ...actions,
          moveFrom,
          coverMonths: {
            months: [
              { month: "2026-10", disabled: false },
              { month: "2026-11", disabled: false },
            ],
            initial: "2026-10",
            optionsFor: () => [{ id: "food", name: "Food", group: "Needs", available: "500" }],
            unassign: vi.fn(),
          },
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Cover Phone: $-2, overspent" }));
    await userEvent.selectOptions(await screen.findByLabelText("Month"), "2026-11");
    await userEvent.click(screen.getByRole("combobox", { name: "Cover overspending from" }));
    await userEvent.click(await screen.findByRole("option", { name: /Food/ }));
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(moveFrom).toHaveBeenCalledWith("2026-11", "food", "phone", 200n);
    expect(actions.move).not.toHaveBeenCalled();
  });

  it("moves money to another category", async () => {
    const actions = makeActions();
    render(
      <AvailableButton
        categoryId="rent"
        categoryName="Rent"
        amount="5000"
        format={format}
        actions={actions}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Move Rent: $50" }));
    const amount = screen.getByLabelText("Move");
    expect(amount).toHaveValue("50");
    await userEvent.clear(amount);
    await userEvent.type(amount, "20");
    await userEvent.click(screen.getByRole("combobox", { name: "Move to" }));
    await userEvent.click(await screen.findByRole("option", { name: /Food/ }));
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(actions.move).toHaveBeenCalledWith("rent", "food", 2000n);
  });

  it("lists savings last and warns before covering from them", async () => {
    const actions = makeActions();
    actions.options = [
      ...actions.options,
      {
        id: "fund",
        name: "Emergency fund",
        group: "Needs",
        available: "1000000",
        savings: { goal: { kind: "safety_fund", needed: 1_000_000n, funded: 1_000_000n } },
      },
    ];
    render(
      <AvailableButton
        categoryId="phone"
        categoryName="Phone"
        amount="-1500"
        format={format}
        actions={actions}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Cover Phone: $-15, overspent" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Cover overspending from" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("Ready to Assign"),
      expect.stringContaining("Rent"),
      expect.stringContaining("Emergency fund"),
    ]);
    expect(screen.getByText("Savings")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: /Emergency fund/ }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Emergency fund will be $15 below its $10000, and its goal will ask for it back.",
    );
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(actions.move).toHaveBeenCalledWith("fund", "phone", 1500n);
  });

  it("warns when moving money out of savings", async () => {
    const actions = makeActions();
    actions.options = [
      ...actions.options,
      {
        id: "trip",
        name: "Vacation",
        group: "Wants",
        available: "40000",
        savings: { goal: { kind: "save_up", needed: 150_000n, funded: 140_000n } },
      },
    ];
    render(
      <AvailableButton
        categoryId="trip"
        categoryName="Vacation"
        amount="40000"
        format={format}
        actions={actions}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Move Vacation: $400" }));
    const amount = screen.getByLabelText("Move");
    await userEvent.clear(amount);
    await userEvent.type(amount, "100");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Vacation's progress drops to $1300 of $1500.",
    );
  });

  it("covers overspending with as much as the source has", async () => {
    const actions = makeActions();
    render(
      <AvailableButton
        categoryId="phone"
        categoryName="Phone"
        amount="-8000"
        format={format}
        actions={actions}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Cover Phone: $-80, overspent" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Cover overspending from" }));
    // Only places with money are offered.
    expect(screen.queryByRole("option", { name: /Food/ })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("option", { name: /Rent/ }));
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(actions.move).toHaveBeenCalledWith("rent", "phone", 5000n);
  });
});

describe("FixThisButton", () => {
  it("un-assigns the shortfall from a category", async () => {
    const actions = makeActions();
    render(<FixThisButton readyToAssign="-1200" format={format} actions={actions} />);
    await userEvent.click(screen.getByRole("button", { name: "Fix This" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Un-assign money from" }));
    expect(screen.queryByRole("option", { name: /Ready to Assign/ })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("option", { name: /Rent/ }));
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(actions.move).toHaveBeenCalledWith("rent", "rta", 1200n);
  });

  // From the current month to the last with money assigned; later months offer what's assigned
  // in them.
  it("un-assigns from another month Fix This offers", async () => {
    const actions = makeActions();
    const unassign = vi.fn().mockResolvedValue(undefined);
    render(
      <FixThisButton
        readyToAssign="-1200"
        format={format}
        actions={actions}
        months={{
          months: [
            { month: "2026-10", disabled: false },
            { month: "2026-11", disabled: false },
            { month: "2026-12", disabled: true },
          ],
          initial: "2026-11",
          optionsFor: (m) =>
            m === "2026-11"
              ? [{ id: "phone", name: "Phone", group: "Bills", available: "800" }]
              : actions.options,
          unassign,
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Fix This" }));
    const month = await screen.findByLabelText("Month");
    expect(month).toHaveValue("2026-11");
    expect(within(month).getByText("Dec 2026")).toBeDisabled();
    await userEvent.click(screen.getByRole("combobox", { name: "Un-assign money from" }));
    // As much as November holds: $8.00 of the $12.00 shortfall.
    await userEvent.click(await screen.findByRole("option", { name: /Phone/ }));
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(unassign).toHaveBeenCalledWith("2026-11", "phone", 800n);
    expect(actions.move).not.toHaveBeenCalled();
  });
});
