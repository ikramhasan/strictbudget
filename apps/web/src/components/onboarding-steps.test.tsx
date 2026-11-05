import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OnboardingSteps } from "./onboarding-steps";

describe("OnboardingSteps", () => {
  it("marks the current step and lets finished steps be revisited", async () => {
    const onSelect = vi.fn();
    render(<OnboardingSteps current={3} onSelect={onSelect} />);
    expect(screen.getByText("Account").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.queryByRole("button", { name: /Assign/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /How it works/ }));
    expect(onSelect).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getByRole("button", { name: /Budget/ }));
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it("labels a skipped step as skipped, not done", () => {
    render(<OnboardingSteps current={4} skipped={[3]} onSelect={() => {}} />);
    expect(screen.getByText(/skipped/).closest("button")).toHaveTextContent("Account · skipped");
    expect(screen.getByText("Categories").closest("button")).toHaveTextContent("Categories (done)");
  });
});
