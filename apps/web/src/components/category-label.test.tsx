import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CategoryLabel } from "./category-label";

describe("CategoryLabel", () => {
  it("sets the emoji apart and leaves it out of the accessible name", () => {
    render(
      <button type="button">
        <CategoryLabel name="🏠 Rent/Mortgage" />
      </button>,
    );
    const button = screen.getByRole("button", { name: "Rent/Mortgage" });
    const emoji = button.querySelector("[aria-hidden]");
    expect(emoji).toHaveTextContent("🏠");
  });

  it("shows a name without a leading emoji as it is", () => {
    render(<CategoryLabel name="Groceries" />);
    expect(screen.getByText("Groceries")).toBeInTheDocument();
    expect(document.querySelector("[aria-hidden]")).toBeNull();
  });
});
