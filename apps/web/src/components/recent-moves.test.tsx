import { TooltipProvider } from "@strictbudget/ui/components/tooltip";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CategoryList } from "@/lib/categories";
import type { MoneyMove } from "@/lib/moves";
import { CategoryMovesButton } from "./category-moves";
import { RecentMovesList } from "./recent-moves";

const format = (a: string) => {
  const n = Number(a) / 100;
  return n < 0 ? `-$${(-n).toFixed(2)}` : `$${n.toFixed(2)}`;
};
const categories = {
  groups: [
    {
      id: "g",
      name: "Cycle 4",
      categories: [
        { id: "a", name: "x-142 A" },
        { id: "b", name: "x-142 B" },
        { id: "c", name: "x-142 C" },
      ],
    },
  ],
} as unknown as CategoryList;

const AT = "2026-10-14T12:00:00.000Z";
let seq = 0;
function move(over: Partial<MoneyMove>): MoneyMove {
  seq += 1;
  return {
    id: `m${seq}`,
    kind: "assigned",
    fromCategoryId: null,
    toCategoryId: null,
    fromDeletedCategory: null,
    toDeletedCategory: null,
    deletion: false,
    picture: null,
    month: "2026-10",
    amount: "0",
    movedAt: AT,
    autoAssign: null,
    userId: "me",
    userName: "ihni7",
    memberRole: "owner",
    avatarColor: 1,
    removed: false,
    ...over,
  };
}

function renderList(
  moves: MoneyMove[],
  props: Partial<ComponentProps<typeof RecentMovesList>> = {},
) {
  const onOpenCategory = vi.fn();
  render(
    <TooltipProvider>
      <RecentMovesList
        moves={moves}
        filter="all"
        categories={categories}
        format={format}
        formatDate={(d) => d}
        currentUserId="me"
        onOpenCategory={onOpenCategory}
        {...props}
      />
    </TooltipProvider>,
  );
  return { onOpenCategory };
}

describe("Recent Moves", () => {
  it("names who made each move and opens a category in its month", async () => {
    const { onOpenCategory } = renderList([
      move({ kind: "moved", fromCategoryId: "c", toCategoryId: "a", amount: "500" }),
      move({ toCategoryId: "c", amount: "3000", month: "2026-09" }),
    ]);
    expect(screen.getByText("ihni7 moved")).toBeInTheDocument();
    expect(screen.getByText("ihni7 assigned")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "ihni7 (you)" })).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: /x-142 C\s*Sep 2026/ }));
    expect(onOpenCategory).toHaveBeenCalledWith("c", "2026-09");
  });

  it("groups an Auto-Assign as one entry with its net, method and details", async () => {
    const batch = { batchId: "b1", method: "averageAssigned" as const };
    renderList([
      move({ autoAssign: batch, toCategoryId: "c", amount: "500" }),
      move({ autoAssign: batch, toCategoryId: "b", amount: "500" }),
      move({ autoAssign: batch, kind: "removed", fromCategoryId: "a", amount: "500" }),
    ]);
    expect(screen.getByText("ihni7 auto-assigned")).toBeInTheDocument();
    expect(screen.getByText("$5.00")).toBeInTheDocument();
    expect(screen.getByText("Method: Average Assigned")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Details" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Details" }));
    const details = within(screen.getByRole("list", { name: "Details" }));
    const rows = details.getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toEqual(["x-142 COct 2026$5.00", "x-142 BOct 2026$5.00", "x-142 AOct 2026-$5.00"]);
  });

  it("words a removing batch, a one-category batch, and keeps batches out of Moved", () => {
    const reset = { batchId: "r", method: "resetAssigned" as const };
    const one = { batchId: "o", method: "assignedLastMonth" as const };
    renderList([
      move({ autoAssign: reset, kind: "removed", fromCategoryId: "c", amount: "3000" }),
      move({ autoAssign: reset, kind: "removed", fromCategoryId: "b", amount: "2000" }),
      move({ autoAssign: one, toCategoryId: "a", amount: "1000" }),
    ]);
    expect(screen.getByText("ihni7 removed")).toBeInTheDocument();
    expect(screen.getByText("$50.00")).toBeInTheDocument();
    expect(screen.getByText("Method: Reset Assigned Amounts")).toBeInTheDocument();
    // One category: named, no method or details.
    expect(screen.getByText("ihni7 auto-assigned")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /x-142 A\s*Oct 2026/ })).toBeInTheDocument();
    expect(screen.getAllByText(/^Method:/)).toHaveLength(1);
  });

  it("shows Auto-Assign under Assigned, not Moved", () => {
    const batch = { batchId: "b1", method: "underfunded" as const };
    renderList([move({ autoAssign: batch, toCategoryId: "a", amount: "100" })], {
      filter: "moved",
    });
    expect(screen.getByText("No moves yet.")).toBeInTheDocument();
  });

  it("keeps the colour of a member who left, marked removed, and a deleted user as inactive", () => {
    renderList([
      move({
        toCategoryId: "a",
        amount: "100",
        userName: "Pat",
        userId: "pat",
        memberRole: null,
        avatarColor: 3,
        removed: true,
      }),
      move({
        toCategoryId: "b",
        amount: "200",
        userName: null,
        userId: null,
        avatarColor: null,
        removed: true,
      }),
    ]);
    expect(screen.getByText("Pat assigned")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Pat (removed)" })).toHaveTextContent("P");
    // Their own colour (avatar-three), not the grey inactive one.
    expect(screen.getByRole("img", { name: "Pat (removed)" })).toHaveClass("bg-[#41D298]");
    expect(screen.getByRole("img", { name: "Inactive Member" })).toHaveTextContent("");
  });

  it("colours each member: the owner avatar-one, the next to join avatar-two", () => {
    renderList([
      move({ toCategoryId: "a", amount: "100" }),
      move({
        toCategoryId: "b",
        amount: "200",
        userId: "pat",
        userName: "Pat",
        memberRole: "editor",
        avatarColor: 2,
      }),
    ]);
    expect(screen.getByRole("img", { name: "ihni7 (you)" })).toHaveClass("bg-[#545BFE]");
    expect(screen.getByRole("img", { name: "Pat" })).toHaveClass("bg-[#AEE865]", "text-black");
  });
});

describe("Category moves history", () => {
  it("lists one category's moves signed from its side", async () => {
    const batch = { batchId: "b1", method: "assignedLastMonth" as const };
    const moves = [
      move({ kind: "removed", fromCategoryId: "b", amount: "500" }),
      move({ kind: "moved", fromCategoryId: "c", toCategoryId: "a", amount: "500" }),
      move({ autoAssign: batch, toCategoryId: "a", amount: "1000" }),
      move({ toCategoryId: "b", amount: "2000" }),
    ];
    const name = (id: string | null) =>
      categories.groups[0]?.categories.find((c) => c.id === id)?.name ?? "?";
    const context = {
      moves,
      withMoves: new Set(["a", "b", "c"]),
      name,
      formatDate: (d: string) => d,
      currentUserId: "me",
    };
    render(
      <TooltipProvider>
        <CategoryMovesButton
          categoryId="a"
          categoryName="x-142 A"
          context={context}
          format={format}
          visible
        />
        <CategoryMovesButton
          categoryId="c"
          categoryName="x-142 C"
          context={context}
          format={format}
          visible
        />
      </TooltipProvider>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Changes to x-142 A's assigned amount this month" }),
    );
    expect(screen.getByRole("heading", { name: "Moves" })).toBeInTheDocument();
    const rows = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => r.textContent);
    expect(rows).toEqual([
      "2026-10-14Moved from x-142 C$5.00i",
      "2026-10-14Auto-AssignedAssigned Last Month$10.00i",
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Changes to x-142 C's assigned amount this month" }),
    );
    expect(screen.getByText("Moved to x-142 A")).toBeInTheDocument();
    expect(screen.getByText("-$5.00")).toBeInTheDocument();
  });
});
