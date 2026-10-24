import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FreshStartDialog } from "./fresh-start-dialog";

describe("FreshStartDialog", () => {
  it("asks for the new budget's name before continuing", async () => {
    const onContinue = vi.fn().mockResolvedValue(undefined);
    render(<FreshStartDialog onContinue={onContinue} />);
    await userEvent.click(screen.getByRole("button", { name: "Make a fresh start" }));
    const name = screen.getByLabelText("New budget name");
    const next = screen.getByRole("button", { name: "Continue" });
    expect(name).toHaveValue("");
    expect(next).toBeDisabled();
    await userEvent.type(name, "   ");
    expect(next).toBeDisabled();
    await userEvent.type(name, " Household 2027 ");
    await userEvent.click(next);
    expect(onContinue).toHaveBeenCalledWith("Household 2027");
  });
});
