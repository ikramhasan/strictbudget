import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog";

describe("KeyboardShortcutsDialog", () => {
  it("lists the four sections with their keys, closed with OK", async () => {
    const onOpenChange = vi.fn();
    render(<KeyboardShortcutsDialog open onOpenChange={onOpenChange} />);
    const dialog = screen.getByRole("dialog", { name: "Keyboard Shortcuts" });
    const headings = within(dialog)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["Universal", "Plan Actions", "Account Actions", "Date Picker"]);
    const flag = within(dialog).getByText("Flag").closest("div");
    expect(flag).toHaveTextContent("shiftFthen0‑6");
    await userEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
