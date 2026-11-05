import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OnboardingSteps } from "./onboarding-steps";

describe("OnboardingSteps", () => {
  it("marks the current step and lets finished setup steps be revisited", async () => {
    const onSelect = vi.fn();
    render(<OnboardingSteps current={3} onSelect={onSelect} />);
    expect(screen.getByText("Account").closest("li")).toHaveAttribute("aria-current", "step");
    // The budget already exists: its step isn't a way back.
    expect(screen.queryByRole("button", { name: /Budget/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Assign/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /How it works/ }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});
