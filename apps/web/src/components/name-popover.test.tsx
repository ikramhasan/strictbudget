import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NamePopover, splitEmoji } from "./name-popover";

// The picker loads Emojibase's data from the app's origin; serve it from the package.
const require = createRequire(import.meta.url);
vi.stubGlobal("fetch", async (url: string) => {
  const file = String(url).endsWith("messages.json") ? "messages.json" : "data.json";
  const body = readFileSync(require.resolve(`emojibase-data/en/${file}`), "utf8");
  return new Response(body, { headers: { "Content-Type": "application/json" } });
});

function renderPopover(onSubmit: (values: { name: string }) => void) {
  render(
    <NamePopover
      title="New category group"
      withEmoji
      submitLabel="Add"
      onSubmit={onSubmit}
      trigger={<button type="button">Open</button>}
    />,
  );
}

describe("NamePopover withEmoji", () => {
  it("puts a picked emoji in front of the name", async () => {
    const onSubmit = vi.fn();
    renderPopover(onSubmit);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.click(screen.getByRole("button", { name: "Add an emoji" }));
    await userEvent.type(screen.getByLabelText("Search emoji"), "money bag");
    // The footer names the first match once the search has run; Enter picks it.
    await screen.findAllByText("Money bag");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByLabelText("New category group")).toHaveFocus());
    // Emojibase gives the fully-qualified form, with the emoji presentation selector.
    const bag = "💰\uFE0F";
    expect(screen.getByRole("button", { name: `Emoji: ${bag}. Change emoji` })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("New category group"), "Savings");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onSubmit).toHaveBeenCalledWith({ name: `${bag} Savings`, note: "" });
  });

  it("leaves the name alone without one", async () => {
    const onSubmit = vi.fn();
    renderPopover(onSubmit);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.type(screen.getByLabelText("New category group"), "Savings");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onSubmit).toHaveBeenCalledWith({ name: "Savings", note: "" });
  });
});

describe("NamePopover withKind", () => {
  it("adds a spending category unless Savings is picked", async () => {
    const onSubmit = vi.fn();
    render(
      <NamePopover
        title="New category in Needs"
        withKind
        submitLabel="Add"
        onSubmit={onSubmit}
        trigger={<button type="button">Open</button>}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("radio", { name: "Spending" })).toBeChecked();
    expect(screen.getByText("Money for bills and everyday spending.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("New category in Needs"), "Groceries");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onSubmit).toHaveBeenLastCalledWith({ name: "Groceries", note: "", savings: false });

    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.click(screen.getByRole("radio", { name: "Savings" }));
    expect(screen.getByText(/Money you keep for a goal/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("New category in Needs"), "House deposit");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onSubmit).toHaveBeenLastCalledWith({ name: "House deposit", note: "", savings: true });
  });
});

describe("splitEmoji", () => {
  it.each([
    ["🏠 Rent/Mortgage", "🏠", "Rent/Mortgage"],
    ["👨‍👩‍👧 Family", "👨‍👩‍👧", "Family"],
    ["🇧🇩 Trip home", "🇧🇩", "Trip home"],
    ["❤️ Charity", "❤️", "Charity"],
    ["1️⃣ First", "1️⃣", "First"],
  ])("splits %s", (name, emoji, text) => {
    expect(splitEmoji(name)).toEqual({ emoji, text });
  });

  it.each(["Rent", "1 Rent", "# Notes", "🎯Goals", "🎯  Goals", "🎯", "🎯 "])(
    "leaves %s whole",
    (name) => {
      expect(splitEmoji(name)).toEqual({ emoji: "", text: name });
    },
  );
});

describe("NamePopover withEmoji, renaming", () => {
  function renderRename(name: string, onSubmit: (values: { name: string }) => void) {
    render(
      <NamePopover
        title="Category name"
        withEmoji
        initial={{ name, note: "" }}
        onSubmit={onSubmit}
        trigger={<button type="button">Open</button>}
      />,
    );
  }

  it("moves the leading emoji into the box and keeps it on OK", async () => {
    const onSubmit = vi.fn();
    renderRename("🏠 Rent", onSubmit);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByLabelText("Category name")).toHaveValue("Rent");
    expect(screen.getByRole("button", { name: "Emoji: 🏠. Change emoji" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onSubmit).toHaveBeenCalledWith({ name: "🏠 Rent", note: "" });
  });

  it("drops the emoji when it is removed", async () => {
    const onSubmit = vi.fn();
    renderRename("🏠 Rent", onSubmit);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.click(screen.getByRole("button", { name: "Emoji: 🏠. Change emoji" }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onSubmit).toHaveBeenCalledWith({ name: "Rent", note: "" });
  });

  it("has no box while the name is locked", async () => {
    render(
      <NamePopover
        title="Category name"
        withEmoji
        nameLockedReason="Named after its credit account."
        initial={{ name: "🏠 Visa", note: "" }}
        onSubmit={vi.fn()}
        trigger={<button type="button">Open</button>}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByLabelText("Category name")).toHaveValue("🏠 Visa");
    expect(screen.queryByRole("button", { name: /emoji/i })).not.toBeInTheDocument();
  });
});
