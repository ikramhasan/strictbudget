import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type AssignActions, AssignedCell } from "./assigned-cell";

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
