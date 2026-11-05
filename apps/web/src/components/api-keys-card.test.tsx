import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The API client keeps the fetch it was created with, so swap it in before anything imports it.
const api = vi.hoisted(() => {
  const state = {
    keys: [] as Record<string, unknown>[],
    created: [] as Record<string, unknown>[],
    deleted: [] as string[],
  };
  globalThis.fetch = (async (input: Request) => {
    const url = new URL(input.url);
    if (url.pathname === "/v1/budgets") {
      return Response.json({
        budgets: [
          { id: "b1", name: "Household" },
          { id: "b2", name: "Side Business" },
        ],
        lastUsedBudgetId: null,
      });
    }
    if (input.method === "POST") {
      const body = (await input.json()) as Record<string, unknown>;
      state.created.push(body);
      const apiKey = {
        id: "k-new",
        name: body.name,
        start: "ec_newkey1",
        access: body.access,
        budgetIds: body.budgetIds,
        createdAt: new Date().toISOString(),
        expiresAt: null,
        lastUsedAt: null,
      };
      state.keys.unshift(apiKey);
      return Response.json({ apiKey, key: "ec_newkey1-the-whole-secret" }, { status: 201 });
    }
    if (input.method === "DELETE") {
      const id = url.pathname.split("/").pop() ?? "";
      state.deleted.push(id);
      state.keys = state.keys.filter((k) => k.id !== id);
      return new Response(null, { status: 204 });
    }
    return Response.json({ apiKeys: state.keys });
  }) as typeof fetch;
  return state;
});

import { ApiKeysCard } from "./api-keys-card";

function renderCard() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApiKeysCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.keys = [
    {
      id: "k1",
      name: "Home server",
      start: "ec_abc1234",
      access: "write",
      budgetIds: ["b1"],
      createdAt: "2026-10-01T00:00:00.000Z",
      expiresAt: null,
      lastUsedAt: null,
    },
  ];
  api.created = [];
  api.deleted = [];
});

describe("API keys", () => {
  it("lists keys by name, start and scope, and links to the API reference", async () => {
    renderCard();
    expect(await screen.findByText("Home server")).toBeInTheDocument();
    expect(screen.getByText("ec_abc1234…")).toBeInTheDocument();
    expect(await screen.findByText(/Read & write · Household/)).toBeInTheDocument();
    expect(screen.getByText("Never expires")).toBeInTheDocument();
    expect(screen.getByText("Never used")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /API reference/ })).toHaveAttribute(
      "href",
      expect.stringMatching(/\/docs$/),
    );
  });

  it("creates a scoped key and shows it once", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Create API Key" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Sheets sync");
    await user.click(within(dialog).getByRole("radio", { name: /Only the budgets I choose/ }));
    await user.click(await within(dialog).findByRole("checkbox", { name: "Side Business" }));
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Expiration" }), "30");
    await user.click(within(dialog).getByRole("button", { name: "Create key" }));

    expect(await screen.findByRole("heading", { name: "Copy Your API Key" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "API key" })).toHaveValue(
      "ec_newkey1-the-whole-secret",
    );
    expect(api.created).toEqual([
      { name: "Sheets sync", access: "read", budgetIds: ["b2"], expiresInDays: 30 },
    ]);

    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Sheets sync")).toBeInTheDocument();
    expect(screen.queryByText(/the-whole-secret/)).not.toBeInTheDocument();
  });

  it("asks for a budget when limiting the key to some", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Create API Key" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "x");
    await user.click(within(dialog).getByRole("radio", { name: /Only the budgets I choose/ }));
    await user.click(within(dialog).getByRole("button", { name: "Create key" }));
    expect(await within(dialog).findByText("Choose at least one budget.")).toBeInTheDocument();
    expect(api.created).toEqual([]);
  });

  it("revokes a key after confirming", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Revoke" }));
    await user.click(await screen.findByRole("button", { name: "Revoke key" }));
    await waitFor(() => expect(api.deleted).toEqual(["k1"]));
    expect(await screen.findByText("You don't have any API keys.")).toBeInTheDocument();
  });
});
