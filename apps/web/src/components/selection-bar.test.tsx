import type { components } from "@strictbudget/api-client";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { groupOptions, SelectionBar } from "./selection-bar";

type Summary = components["schemas"]["SelectionSummary"];

const summary = (patch: Partial<Summary>): Summary => ({
  count: 2,
  total: "-200",
  currency: "USD",
  uncleared: 0,
  cleared: 0,
  reconciled: 0,
  reconciledTransfers: 0,
  categorizable: 2,
  unapproved: 0,
  splits: 0,
  splitsWithTransfers: 0,
  deletable: 2,
  ...patch,
});

const categories = [
  { id: "rta", name: "Ready to Assign", group: "Inflow" },
  { id: "rent", name: "Rent", group: "Bills" },
  { id: "power", name: "Power", group: "Bills" },
  { id: "food", name: "Groceries", group: "Needs" },
];

function bar(s: Summary, props: Partial<Parameters<typeof SelectionBar>[0]> = {}) {
  const onAction = vi.fn();
  return {
    onAction,
    ...render(
      <SelectionBar
        summary={s}
        total="-$2.00"
        allMatching={false}
        canSelectAll={false}
        onSelectAll={vi.fn()}
        onClear={vi.fn()}
        flags={[]}
        categories={categories}
        moveTargets={[]}
        pending={false}
        onAction={onAction}
        {...props}
      />,
    ),
  };
}

async function categorizeAs(group: string, category: string) {
  screen.getByRole("button", { name: "Categorize" }).focus();
  await userEvent.keyboard("{Enter}");
  const trigger = await screen.findByRole("menuitem", { name: group });
  trigger.focus();
  await userEvent.keyboard("{ArrowRight}");
  await userEvent.click(await screen.findByRole("menuitem", { name: category }));
}

describe("SelectionBar", () => {
  it("offers Export # Transactions in More", async () => {
    const onExport = vi.fn();
    bar(summary({ count: 2 }), { onExport });
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Export 2 Transactions" }));
    expect(onExport).toHaveBeenCalledOnce();
  });

  it("offers Approve and Reject with unapproved rows, Flag and Clear moving into More", async () => {
    const { onAction } = bar(summary({ unapproved: 1, uncleared: 2 }));
    expect(screen.queryByRole("button", { name: /Flag/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Clear$/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onAction).toHaveBeenLastCalledWith({ type: "approve" });
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onAction).toHaveBeenLastCalledWith({ type: "reject" });
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    expect(await screen.findByRole("menuitem", { name: "Mark as Cleared" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Flag" })).toBeVisible();
  });

  it("offers neither when every row is approved", () => {
    bar(summary({}));
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });

  it("offers Clear only when every selected row is uncleared", () => {
    const { unmount } = bar(summary({ uncleared: 2 }));
    expect(screen.getByRole("button", { name: /Clear$/ })).toBeVisible();
    unmount();
    bar(summary({ cleared: 2 }));
    expect(screen.queryByRole("button", { name: /^Clear$/ })).toBeNull();
  });

  it("categorizes from a menu of groups with their categories as submenus", async () => {
    const { onAction } = bar(summary({}));
    screen.getByRole("button", { name: "Categorize" }).focus();
    await userEvent.keyboard("{Enter}");
    const menu = await screen.findByRole("menu", { name: "Categorize" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((m) => m.textContent),
    ).toEqual(["Inflow", "Bills", "Needs"]);
    await userEvent.keyboard("{Escape}");
    await categorizeAs("Bills", "Power");
    expect(onAction).toHaveBeenCalledWith({ type: "categorize", categoryId: "power" });
  });

  it("asks before un-splitting a selected split", async () => {
    const { onAction } = bar(summary({ splits: 1 }));
    await categorizeAs("Inflow", "Ready to Assign");
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Un-split and Categorize Split Transaction?");
    expect(dialog).toHaveTextContent(
      'If you categorize the split transaction as "Inflow: Ready to Assign" we will un-split it.',
    );
    expect(onAction).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Categorize" }));
    expect(onAction).toHaveBeenCalledWith({ type: "categorize", categoryId: "rta" });
  });
});

// Scheduled splits count, and the transfer wording shows only when a selected split has a
// transfer line.
describe("un-split warning", () => {
  async function warning(
    s: Summary,
    scheduledSplits?: { splits: number; splitsWithTransfers: number },
  ) {
    bar(s, { scheduledCount: scheduledSplits?.splits ?? 0, scheduledSplits });
    await categorizeAs("Bills", "Rent");
    return screen.findByRole("alertdialog");
  }

  it("counts a scheduled split selected alone", async () => {
    const dialog = await warning(summary({ count: 0, categorizable: 0 }), {
      splits: 1,
      splitsWithTransfers: 0,
    });
    expect(dialog).toHaveTextContent("Un-split and Categorize Split Transaction?");
    expect(dialog).toHaveTextContent("You have a split transaction selected.");
  });

  it("counts scheduled splits with the transactions", async () => {
    const dialog = await warning(summary({ splits: 1 }), { splits: 1, splitsWithTransfers: 0 });
    expect(dialog).toHaveTextContent("Un-split and Categorize Split Transactions?");
    expect(dialog).toHaveTextContent("You have 2 split transactions selected.");
    expect(dialog).toHaveTextContent(
      'If you categorize these split transactions as "Rent" we will un-split them.',
    );
  });

  it("mentions transfers only when a selected split has a transfer line", async () => {
    const dialog = await warning(summary({ splits: 2, splitsWithTransfers: 1 }), {
      splits: 1,
      splitsWithTransfers: 0,
    });
    expect(dialog).toHaveTextContent("You have 3 split transactions selected.");
    expect(dialog).toHaveTextContent(
      "we will un-split the transactions, as long as they don't contain transfers.",
    );
  });

  it("doesn't ask when every selected split has a transfer line", async () => {
    const { onAction } = bar(summary({ splits: 1, splitsWithTransfers: 1 }), {
      scheduledCount: 1,
      scheduledSplits: { splits: 1, splitsWithTransfers: 1 },
    });
    await categorizeAs("Bills", "Rent");
    expect(onAction).toHaveBeenCalledWith({ type: "categorize", categoryId: "rent" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("groupOptions", () => {
  it("keeps each group's run of options, in order", () => {
    expect(groupOptions(categories).map((g) => [g.name, g.categories.map((c) => c.id)])).toEqual([
      ["Inflow", ["rta"]],
      ["Bills", ["rent", "power"]],
      ["Needs", ["food"]],
    ]);
  });
});

describe("Match and Unmatch", () => {
  it("offers Match only when the register says the pair can match", async () => {
    const onMatch = vi.fn();
    const { unmount } = bar(summary({ unapproved: 1 }), { onMatch });
    await userEvent.click(screen.getByRole("button", { name: "Match" }));
    expect(onMatch).toHaveBeenCalled();
    unmount();
    bar(summary({ unapproved: 1 }));
    expect(screen.queryByRole("button", { name: "Match" })).not.toBeInTheDocument();
  });

  it("offers Unmatch for matched transactions", async () => {
    const onUnmatch = vi.fn();
    bar(summary({ count: 1, cleared: 1 }), { onUnmatch });
    await userEvent.click(screen.getByRole("button", { name: "Unmatch" }));
    expect(onUnmatch).toHaveBeenCalled();
  });
});

describe("SelectionBar keys", () => {
  const flags = [
    { color: "red", name: "" },
    { color: "orange", name: "" },
  ] as Parameters<typeof SelectionBar>[0]["flags"];

  it("approves with A and rejects with Shift+R while unapproved rows are selected", async () => {
    const { onAction } = bar(summary({ unapproved: 1 }));
    await userEvent.keyboard("a");
    expect(onAction).toHaveBeenLastCalledWith({ type: "approve" });
    await userEvent.keyboard("{Shift>}R{/Shift}");
    expect(onAction).toHaveBeenLastCalledWith({ type: "reject" });
  });

  it("toggles cleared with C: mixed become cleared, all cleared become uncleared", async () => {
    const mixed = bar(summary({ uncleared: 1, cleared: 1 }));
    await userEvent.keyboard("c");
    expect(mixed.onAction).toHaveBeenLastCalledWith({ type: "cleared", cleared: "cleared" });
    mixed.unmount();
    const cleared = bar(summary({ uncleared: 0, cleared: 2 }));
    await userEvent.keyboard("c");
    expect(cleared.onAction).toHaveBeenLastCalledWith({ type: "cleared", cleared: "uncleared" });
  });

  it("opens the Categorize menu with K, or hands K to the register for one row", async () => {
    bar(summary({}));
    await userEvent.keyboard("k");
    expect(await screen.findByRole("menuitem", { name: "Bills" })).toBeInTheDocument();
  });

  it("hands K to the register when one transaction is selected", async () => {
    const onCategorizeKey = vi.fn();
    bar(summary({ count: 1 }), { onCategorizeKey });
    await userEvent.keyboard("k");
    expect(onCategorizeKey).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menuitem", { name: "Bills" })).toBeNull();
  });

  it("opens Flag with Shift+F and takes a digit: 1–6 a colour, 0 none", async () => {
    const { onAction } = bar(summary({}), { flags });
    await userEvent.keyboard("{Shift>}F{/Shift}");
    expect(await screen.findByRole("menu", { name: "Flag selected" })).toBeInTheDocument();
    await userEvent.keyboard("2");
    expect(onAction).toHaveBeenLastCalledWith({ type: "flag", flag: "orange" });
    await userEvent.keyboard("{Shift>}F{/Shift}");
    await screen.findByRole("menu", { name: "Flag selected" });
    await userEvent.keyboard("0");
    expect(onAction).toHaveBeenLastCalledWith({ type: "flag", flag: null });
  });

  it("opens Flag with Shift+F even while Flag sits in More", async () => {
    bar(summary({ unapproved: 1 }), { flags });
    await userEvent.keyboard("{Shift>}F{/Shift}");
    expect(await screen.findByRole("menu", { name: "Flag selected" })).toBeInTheDocument();
  });

  it("duplicates with Shift+D and deletes with Delete", async () => {
    const { onAction } = bar(summary({}));
    await userEvent.keyboard("{Shift>}D{/Shift}");
    expect(onAction).toHaveBeenLastCalledWith({ type: "duplicate" });
    await userEvent.keyboard("{Delete}");
    expect(onAction).toHaveBeenLastCalledWith({ type: "delete" });
  });

  it("enters scheduled rows now with E, makes one repeating with Shift+T", async () => {
    const onMakeRepeating = vi.fn();
    const scheduled = bar(summary({ count: 0, categorizable: 0, deletable: 0 }), {
      scheduledCount: 1,
    });
    await userEvent.keyboard("e");
    expect(scheduled.onAction).toHaveBeenLastCalledWith({ type: "enterNow" });
    scheduled.unmount();
    bar(summary({ count: 1 }), { onMakeRepeating });
    await userEvent.keyboard("{Shift>}T{/Shift}");
    expect(onMakeRepeating).toHaveBeenCalledOnce();
  });
});
