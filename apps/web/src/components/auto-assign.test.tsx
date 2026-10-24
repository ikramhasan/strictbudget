import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NO_AUTO_ASSIGN } from "@/test/fixtures";
import { AutoAssignPanel } from "./auto-assign";

const categories = [
  {
    categoryId: "rent",
    assigned: "1000",
    activity: "0",
    cashActivity: "0",
    creditActivity: "0",
    cashOverspent: "0",
    creditOverspent: "0",
    payment: null,
    target: null,
    available: "1000",
    autoAssign: {
      ...NO_AUTO_ASSIGN,
      underfunded: "1000",
      reduceOverfunding: "1000",
      assignedLastMonth: "3000",
      resetAvailable: "0",
    },
    bar: null,
    underfundedParts: [],
    targetConversion: null,
    targetRateMissing: false,
    upcoming: null,
  },
  {
    categoryId: "food",
    assigned: "0",
    activity: "0",
    cashActivity: "0",
    creditActivity: "0",
    cashOverspent: "0",
    creditOverspent: "0",
    payment: null,
    target: null,
    available: "0",
    autoAssign: { ...NO_AUTO_ASSIGN, assignedLastMonth: "0" },
    bar: null,
    underfundedParts: [],
    targetConversion: null,
    targetRateMissing: false,
    upcoming: null,
  },
];
const names = new Map([
  ["rent", { name: "Rent", group: "Bills" }],
  ["food", { name: "Food", group: "Needs" }],
]);
const format = (a: string) => `A${a}`;

describe("AutoAssignPanel", () => {
  it("previews the whole plan before assigning", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(
      <AutoAssignPanel
        categories={categories}
        names={names}
        selection={false}
        readyToAssign={0n}
        format={format}
        onApply={onApply}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Assigned Last Month A3000" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/for 1 category/)).toBeInTheDocument();
    expect(within(dialog).getByText("Rent")).toBeInTheDocument();
    expect(within(dialog).getByText("+A2000")).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Update Assigned Amounts" }));
    expect(onApply).toHaveBeenCalledWith("assignedLastMonth");
  });

  it("applies straight away to selected categories, with singular labels for one", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(
      <AutoAssignPanel
        categories={categories.slice(0, 1)}
        names={names}
        selection
        readyToAssign={0n}
        format={format}
        onApply={onApply}
      />,
    );
    expect(screen.getByRole("button", { name: "Reset Available Amount A0" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Reset Assigned Amount/ }));
    expect(onApply).toHaveBeenCalledWith("resetAssigned");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("says so when the view has no categories", async () => {
    const user = userEvent.setup();
    const onViewAll = vi.fn();
    render(
      <AutoAssignPanel
        categories={[]}
        names={names}
        selection={false}
        readyToAssign={0n}
        format={format}
        onApply={vi.fn()}
        onViewAll={onViewAll}
      />,
    );
    expect(screen.getByText("This view has no categories.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Average Spent/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View All Categories" }));
    expect(onViewAll).toHaveBeenCalled();
  });

  it("uses singular labels when one category is in view", () => {
    render(
      <AutoAssignPanel
        categories={categories.slice(0, 1)}
        names={names}
        selection={false}
        readyToAssign={0n}
        format={format}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /^Reset Assigned Amount A/ })).toBeInTheDocument();
  });

  describe("Underfunded and Reduce Overfunding", () => {
    const base = categories[1];
    if (!base) throw new Error("fixture missing");
    const short = (categoryId: string, amount: string, step: number, extra = {}) => ({
      ...base,
      categoryId,
      autoAssign: { ...NO_AUTO_ASSIGN, underfunded: amount },
      underfundedParts: [{ amount, step, date: "" }],
      targetConversion: null,
      targetRateMissing: false,
      ...extra,
    });
    const visa = short("visa", "100", 5, {
      payment: {
        balance: "-6500",
        priorBalance: "0",
        spendingAndOutflows: "-6500",
        paymentsAndInflows: "0",
        underfunded: "3400",
        overspentCategories: "3300",
        fundedSpending: "0",
        paymentsMade: "0",
      },
    });
    const plan = [short("rent", "6000", 3), short("food", "500", 1), visa];
    const named = new Map([...names, ["visa", { name: "Visa", group: "Credit Card Payments" }]]);

    it("previews funding in order up to Ready to Assign, cards needing attention apart", async () => {
      const user = userEvent.setup();
      const onApply = vi.fn().mockResolvedValue(undefined);
      render(
        <AutoAssignPanel
          categories={plan}
          names={named}
          selection={false}
          readyToAssign={2000n}
          format={format}
          onApply={onApply}
        />,
      );
      // The button shows everything that's short, Ready to Assign or not.
      await user.click(screen.getByRole("button", { name: "Underfunded A6600" }));
      const dialog = screen.getByRole("alertdialog");
      // Food (overspent) first, then $15.00 of Rent; Visa gets nothing and is listed apart.
      expect(within(dialog).getByText("1 category will be fully funded.")).toBeInTheDocument();
      expect(within(dialog).getByText("+A500")).toBeInTheDocument();
      expect(within(dialog).getByText("+A1500")).toBeInTheDocument();
      expect(within(dialog).getByText(/may need more attention/)).toBeInTheDocument();
      expect(within(dialog).getByText("Visa")).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Assign Money" }));
      expect(onApply).toHaveBeenCalledWith("underfunded");
    });

    it("lists Reduce Overfunding only when something is over", () => {
      const over = { ...base, autoAssign: { ...NO_AUTO_ASSIGN, reduceOverfunding: "-300" } };
      const { rerender } = render(
        <AutoAssignPanel
          categories={[base]}
          names={names}
          selection
          readyToAssign={0n}
          format={format}
          onApply={vi.fn()}
        />,
      );
      expect(screen.queryByRole("button", { name: /Reduce Overfunding/ })).not.toBeInTheDocument();
      // A single category with nothing short has no Underfunded either.
      expect(screen.queryByRole("button", { name: /Underfunded/ })).not.toBeInTheDocument();
      rerender(
        <AutoAssignPanel
          categories={[over]}
          names={names}
          selection
          readyToAssign={0n}
          format={format}
          onApply={vi.fn()}
        />,
      );
      expect(screen.getByRole("button", { name: "Reduce Overfunding A300" })).toBeInTheDocument();
    });
  });
});
