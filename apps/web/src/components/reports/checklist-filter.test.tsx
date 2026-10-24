import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChecklistFilter, type ChecklistSection } from "./checklist-filter";

const sections: ChecklistSection[] = [
  { id: "u", items: [{ id: "uncat", label: "Uncategorized Transactions" }] },
  {
    id: "bills",
    title: "Bills",
    items: [
      { id: "rent", label: "Rent" },
      { id: "old", label: "Old Gym", hidden: true },
    ],
  },
];

function setup(selected?: string[]) {
  const onChange = vi.fn();
  render(
    <ChecklistFilter
      allLabel="All Categories"
      noun={["Category", "Categories"]}
      searchPlaceholder="Search All Categories"
      sections={sections}
      selected={selected}
      onChange={onChange}
    />,
  );
  return { onChange, user: userEvent.setup() };
}

describe("ChecklistFilter", () => {
  it("names a partial selection and marks hidden items", async () => {
    const { user } = setup(["rent"]);
    await user.click(screen.getByRole("button", { name: /1 Category/ }));
    expect(screen.getByLabelText("Hidden")).toBeInTheDocument();
  });

  it("unchecks a whole group and reports the rest", async () => {
    const { user, onChange } = setup();
    await user.click(screen.getByRole("button", { name: /All Categories/ }));
    await user.click(screen.getByRole("checkbox", { name: "Bills" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onChange).toHaveBeenCalledWith(["uncat"]);
  });

  it("reports everything selected as no filter, and Cancel changes nothing", async () => {
    const { user, onChange } = setup(["rent"]);
    await user.click(screen.getByRole("button", { name: /1 Category/ }));
    await user.click(screen.getByRole("button", { name: "Select All" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    await user.click(screen.getByRole("button", { name: /1 Category/ }));
    await user.click(screen.getByRole("button", { name: "Select None" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("names an empty selection", () => {
    setup([]);
    expect(screen.getByRole("button", { name: /No Categories Selected/ })).toBeInTheDocument();
  });

  it("searches items and group names", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /All Categories/ }));
    await user.type(screen.getByLabelText("Search All Categories"), "gym");
    expect(screen.getByText("Old Gym")).toBeInTheDocument();
    expect(screen.queryByText("Rent")).not.toBeInTheDocument();
  });
});
