import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The API client keeps the fetch it was created with, so swap it in before anything imports it.
const api = vi.hoisted(() => {
  const state = {
    flags: [] as { color: string; name: string }[],
    puts: [] as { color: string; name: string }[],
  };
  globalThis.fetch = (async (input: Request) => {
    const url = new URL(input.url);
    if (input.method === "PUT") {
      const color = url.pathname.split("/").pop() ?? "";
      const { name } = (await input.json()) as { name: string };
      state.puts.push({ color, name });
      const flag = state.flags.find((f) => f.color === color);
      if (flag) flag.name = name;
      return Response.json({ color, name });
    }
    return Response.json({ flags: state.flags.map((f) => ({ ...f })) });
  }) as typeof fetch;
  return state;
});

import { EditFlagsDialog } from "./edit-flags-dialog";

const COLORS = ["red", "orange", "yellow", "green", "blue", "purple"];

function renderDialog() {
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EditFlagsDialog budgetId="b1" open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

beforeEach(() => {
  api.flags = COLORS.map((color) => ({ color, name: color === "blue" ? "Reimbursable" : "" }));
  api.puts = [];
});

describe("Edit Flags", () => {
  it("lists the six flags in order, an unnamed one showing its color's name", async () => {
    renderDialog();
    expect(await screen.findByRole("textbox", { name: "Red" })).toHaveValue("Red");
    expect(screen.getAllByRole("textbox").map((i) => i.getAttribute("aria-label"))).toEqual([
      "Red",
      "Orange",
      "Yellow",
      "Green",
      "Blue",
      "Purple",
    ]);
    expect(screen.getByRole("textbox", { name: "Blue" })).toHaveValue("Reimbursable");
    expect(screen.getByRole("textbox", { name: "Red" })).toHaveAttribute("maxlength", "50");
  });

  it("saves trimmed names on Done; an empty name goes back to the color", async () => {
    const { onOpenChange } = renderDialog();
    const red = await screen.findByRole("textbox", { name: "Red" });
    await userEvent.clear(red);
    await userEvent.type(red, "  Work  ");
    await userEvent.clear(screen.getByRole("textbox", { name: "Blue" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.puts).toEqual([
      { color: "red", name: "Work" },
      { color: "blue", name: "" },
    ]);
  });

  it("saves nothing when a field still shows its color's name", async () => {
    const { onOpenChange } = renderDialog();
    const green = await screen.findByRole("textbox", { name: "Green" });
    await userEvent.type(green, "{Enter}");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.puts).toEqual([]);
  });

  it("discards edits on Cancel", async () => {
    const { onOpenChange } = renderDialog();
    await userEvent.type(await screen.findByRole("textbox", { name: "Red" }), "x");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(api.puts).toEqual([]);
  });
});
