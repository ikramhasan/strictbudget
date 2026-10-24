import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type CategoryTemplate, ImportTemplateDialog, TemplateGallery } from "./category-templates";

const moving: CategoryTemplate = {
  id: "moving",
  name: "Moving",
  description: "Deposits, movers, supplies and the costs around moving day.",
  categoryCount: 4,
  groups: [
    {
      name: "Before You Move",
      categories: [
        { id: "0.0", name: "💰 Security Deposit", amount: "100000" },
        { id: "0.1", name: "🗓️ First Month's Rent", amount: "120000" },
      ],
    },
    {
      name: "Unexpected",
      categories: [
        { id: "1.0", name: "🌀 Buffer", amount: "25000" },
        { id: "1.1", name: "📋 About This Template", amount: "0" },
      ],
    },
  ],
};
const kid: CategoryTemplate = { ...moving, id: "kid", name: "Kid", description: "Spend, save." };
const format = (amount: string) => `$${(Number(amount) / 100).toFixed(2)}`;

function renderImport() {
  const onImport = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();
  const onChooseAnother = vi.fn();
  render(
    <ImportTemplateDialog
      template={moving}
      budgetName="Household"
      onCancel={onCancel}
      onChooseAnother={onChooseAnother}
      onImport={onImport}
    />,
  );
  const box = (name: string) => screen.getByRole("checkbox", { name });
  return { onImport, onCancel, onChooseAnother, box };
}

describe("ImportTemplateDialog", () => {
  it("asks about the budget with every category ticked", async () => {
    const { onImport } = renderImport();
    expect(screen.getByRole("heading", { name: "Import Category Template" })).toBeVisible();
    expect(screen.getByText("Household")).toBeVisible();
    expect(
      screen.getAllByRole("checkbox").every((b) => b.getAttribute("aria-checked") === "true"),
    ).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Import Categories" }));
    expect(onImport).toHaveBeenCalledWith(["0.0", "0.1", "1.0", "1.1"]);
  });

  it("unticks a group's box with one of its categories, and ticks them all from it", async () => {
    const { onImport, box } = renderImport();
    await userEvent.click(box("💰 Security Deposit"));
    expect(box("Before You Move")).not.toBeChecked();
    expect(box("🗓️ First Month's Rent")).toBeChecked();
    await userEvent.click(box("Unexpected"));
    expect(box("🌀 Buffer")).not.toBeChecked();
    expect(box("📋 About This Template")).not.toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Import Categories" }));
    expect(onImport).toHaveBeenLastCalledWith(["0.1"]);
    // A partly ticked group ticks all of its categories.
    await userEvent.click(box("Before You Move"));
    expect(box("💰 Security Deposit")).toBeChecked();
  });

  it("still imports with nothing ticked, as the button stays enabled", async () => {
    const { onImport, box } = renderImport();
    await userEvent.click(box("Before You Move"));
    await userEvent.click(box("Unexpected"));
    const button = screen.getByRole("button", { name: "Import Categories" });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onImport).toHaveBeenCalledWith([]);
  });

  it("offers Cancel and Choose Another Budget", async () => {
    const { onCancel, onChooseAnother } = renderImport();
    await userEvent.click(screen.getByRole("button", { name: "Choose Another Budget" }));
    expect(onChooseAnother).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("TemplateGallery", () => {
  it("lists templates, previews one with its amounts and total, and picks it", async () => {
    const onPick = vi.fn();
    render(
      <TemplateGallery
        open
        onOpenChange={() => {}}
        templates={[kid, moving]}
        format={format}
        onPick={onPick}
      />,
    );
    expect(screen.getAllByText("4 categories · 2 groups")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: /^Moving/ }));
    const deposit = screen.getByText("💰 Security Deposit").closest("li");
    expect(within(deposit as HTMLElement).getByText("$1000.00")).toBeVisible();
    const about = screen.getByText("📋 About This Template").closest("li");
    expect(about?.textContent).toBe("📋 About This Template");
    expect(screen.getByText("$2450.00")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Get Template" }));
    expect(onPick).toHaveBeenCalledWith(moving);
  });
});
