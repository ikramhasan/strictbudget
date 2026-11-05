import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type AssignActions, AssignedCell, withCurrent } from "./assigned-cell";

function setup(amount = "1000") {
  const actions: AssignActions & { assign: ReturnType<typeof vi.fn> } = {
    // Test parsing: whole numbers, "+" sums; anything else is an error.
    parse: (text) =>
      /^[\d+]+$/.test(text)
        ? text.split("+").reduce((sum, n) => sum + BigInt(n) * 100n, 0n)
        : "Enter an amount",
    toInput: (a) => String(Number(a) / 100),
    assign: vi.fn().mockResolvedValue(undefined),
  };
  render(
    <AssignedCell
      categoryId="c1"
      categoryName="Rent"
      amount={amount}
      format={(a) => `$${Number(a) / 100}`}
      actions={actions}
    />,
  );
  return actions;
}

describe("AssignedCell", () => {
  it("saves a typed amount, math included, on Enter", async () => {
    const actions = setup();
    await userEvent.click(screen.getByRole("button", { name: "Assigned to Rent: $10" }));
    const input = screen.getByRole("textbox", { name: "Assigned to Rent" });
    expect(input).toHaveValue("10");
    await userEvent.clear(input);
    await userEvent.type(input, "200+50{Enter}");
    expect(actions.assign).toHaveBeenCalledWith("c1", 25000n);
    expect(actions.assign).toHaveBeenCalledTimes(1);
  });

  it("adds to what's assigned when the typing starts with an operator", async () => {
    const actions = setup();
    await userEvent.click(screen.getByRole("button", { name: /Assigned to Rent/ }));
    await userEvent.type(screen.getByRole("textbox"), "+80{Enter}");
    expect(actions.assign).toHaveBeenCalledWith("c1", 9000n);
  });

  it("leaves a negative amount alone when nothing was typed", async () => {
    const actions = setup("-400");
    await userEvent.click(screen.getByRole("button", { name: /Assigned to Rent/ }));
    await userEvent.keyboard("{Enter}");
    await userEvent.click(screen.getByRole("button", { name: /Assigned to Rent/ }));
    await userEvent.tab();
    expect(actions.assign).not.toHaveBeenCalled();
  });

  it("cancels on Escape and skips saving an unchanged amount", async () => {
    const actions = setup();
    await userEvent.click(screen.getByRole("button", { name: /Assigned to Rent/ }));
    await userEvent.type(screen.getByRole("textbox"), "5{Escape}");
    expect(actions.assign).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Assigned to Rent/ }));
    await userEvent.tab();
    expect(actions.assign).not.toHaveBeenCalled();
  });

  it("doesn't save what isn't an amount", async () => {
    const actions = setup();
    await userEvent.click(screen.getByRole("button", { name: /Assigned to Rent/ }));
    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "abc{Enter}");
    expect(actions.assign).not.toHaveBeenCalled();
    // Enter keeps the input open with the reason, and fixing it saves.
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount");
    await userEvent.clear(input);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.type(input, "30{Enter}");
    expect(actions.assign).toHaveBeenCalledWith("c1", 3000n);
  });

  it("adds an operator from the calculator without saving, then keeps typing", async () => {
    const actions = setup();
    await userEvent.click(screen.getByRole("button", { name: "Assigned to Rent: $10" }));
    await userEvent.click(screen.getByRole("button", { name: "Open calculator" }));
    await userEvent.click(await screen.findByRole("button", { name: "Plus" }));
    const input = screen.getByRole("textbox", { name: "Assigned to Rent" });
    expect(input).toHaveValue("10+");
    expect(actions.assign).not.toHaveBeenCalled();
    await new Promise((r) => requestAnimationFrame(r));
    expect(input).toHaveFocus();
    await userEvent.type(input, "5{Enter}");
    expect(actions.assign).toHaveBeenCalledWith("c1", 1500n);
  });
});

describe("withCurrent", () => {
  it("applies a typed operator to the amount, and nothing else", () => {
    expect(withCurrent("+80", "120.00", 12000n)).toBe("120.00+80");
    expect(withCurrent("*2", "-4.00", -400n)).toBe("-4.00*2");
    expect(withCurrent("-20", "120.00", 12000n)).toBe("120.00-20");
    // A minus over a negative amount is a new negative amount.
    expect(withCurrent("-5", "-4.00", -400n)).toBe("-5");
    expect(withCurrent("-4.00-1", "-4.00", -400n)).toBe("-4.00-1");
    expect(withCurrent("120.00+30", "120.00", 12000n)).toBe("120.00+30");
    expect(withCurrent("75", "120.00", 12000n)).toBe("75");
  });
});

describe("AssignedCell opened from outside", () => {
  it("keeps what's being typed when asked to open again (a refetch mid-entry)", async () => {
    const actions: AssignActions = {
      parse: (text) => (/^\d+$/.test(text) ? BigInt(text) * 100n : "Enter an amount"),
      toInput: (a) => String(Number(a) / 100),
      assign: vi.fn().mockResolvedValue(undefined),
    };
    const cell = (amount: string) => (
      <AssignedCell
        categoryId="c1"
        categoryName="Rent"
        amount={amount}
        format={(a) => `$${Number(a) / 100}`}
        actions={actions}
        startEditing
      />
    );
    const { rerender } = render(cell("1000"));
    const input = screen.getByRole("textbox", { name: "Assigned to Rent" });
    await userEvent.clear(input);
    await userEvent.type(input, "50");
    rerender(cell("1000"));
    rerender(cell("2000"));
    expect(screen.getByRole("textbox", { name: "Assigned to Rent" })).toHaveValue("50");
  });
});
