import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CategoryList } from "@/lib/categories";
import { CategoryPicker, picksFrom } from "./category-picker";

const cat = (id: string, groupId: string, name: string) => ({
  id,
  groupId,
  name,
  note: "",
  hidden: false,
  linkedAccountId: null,
  hasTransactions: false,
  transactionCount: 0,
  hasAssignedMoney: false,
  savings: false,
  target: null,
});

const data: CategoryList = {
  readyToAssignCategoryId: "rta",
  uncategorizedCategoryId: "uncat",
  groups: [
    {
      id: "bills",
      name: "Bills",
      hidden: false,
      kind: null,
      categories: [cat("rent", "bills", "Rent"), cat("water", "bills", "Water")],
    },
    {
      id: "goals",
      name: "Goals",
      hidden: false,
      kind: null,
      categories: [cat("vacation", "goals", "Vacation")],
    },
  ],
};

describe("picksFrom", () => {
  it("keeps everything when nothing changes", () => {
    expect(picksFrom(data, new Set(), {})).toEqual({
      removeCategoryIds: [],
      removeGroupIds: [],
      add: [],
    });
  });

  it("drops a group that ends up empty, but not one that gets new categories", () => {
    expect(picksFrom(data, new Set(["water", "vacation"]), {})).toEqual({
      removeCategoryIds: ["water", "vacation"],
      removeGroupIds: ["goals"],
      add: [],
    });
    expect(picksFrom(data, new Set(["vacation"]), { goals: ["Emergency fund"] })).toEqual({
      removeCategoryIds: ["vacation"],
      removeGroupIds: [],
      add: [{ groupId: "goals", name: "Emergency fund" }],
    });
  });
});

describe("CategoryPicker", () => {
  it("unticks and adds categories, then reports the changes", async () => {
    const onContinue = vi.fn();
    render(<CategoryPicker data={data} pending={false} onContinue={onContinue} />);
    await userEvent.click(screen.getByLabelText("Water"));
    await userEvent.type(screen.getByLabelText("New category in Goals"), "Emergency fund");
    await userEvent.click(screen.getByRole("button", { name: "Add to Goals" }));
    expect(screen.getByText("Emergency fund")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledWith({
      removeCategoryIds: ["water"],
      removeGroupIds: [],
      add: [{ groupId: "goals", name: "Emergency fund" }],
    });
  });
});
