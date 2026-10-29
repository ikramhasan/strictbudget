import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SavingsSuggestion } from "./savings-suggestion";

const categories = [
  { id: "ef", name: "😌 Emergency fund" },
  { id: "car", name: "Car repairs" },
];

describe("SavingsSuggestion", () => {
  it("marks the ticked categories as savings", async () => {
    const onMark = vi.fn().mockResolvedValue(undefined);
    render(<SavingsSuggestion categories={categories} onMark={onMark} onDismiss={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "These look like savings" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "😌 Emergency fund" })).toBeChecked();
    await userEvent.click(screen.getByRole("checkbox", { name: "Car repairs" }));
    await userEvent.click(screen.getByRole("button", { name: "Mark as Savings" }));
    expect(onMark).toHaveBeenCalledWith(["ef"]);
  });

  it("puts the suggestion away without changing anything", async () => {
    const onMark = vi.fn();
    const onDismiss = vi.fn().mockResolvedValue(undefined);
    render(<SavingsSuggestion categories={categories} onMark={onMark} onDismiss={onDismiss} />);
    for (const c of categories) {
      await userEvent.click(screen.getByRole("checkbox", { name: c.name }));
    }
    expect(screen.getByRole("button", { name: "Mark as Savings" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onDismiss).toHaveBeenCalled();
    expect(onMark).not.toHaveBeenCalled();
  });
});
