import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The API client keeps the fetch it was created with, so swap it in before anything imports it.
const api = vi.hoisted(() => {
  const state = { calls: [] as string[] };
  globalThis.fetch = (async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? "" : await input.text();
    state.calls.push(`${input.method} ${url.pathname.replace(/^\/v1\/budgets\/b1/, "")} ${body}`);
    return Response.json(input.method === "POST" ? { accounts: [] } : {});
  }) as typeof fetch;
  return state;
});

import type { Account } from "@/lib/accounts";
import { UndoProvider, useUndo } from "@/lib/undo";
import { StarButton } from "./star-button";

const account = (id: string, type: Account["type"], starredOrder: number | null): Account => ({
  id,
  name: id,
  logo: null,
  type,
  note: "",
  closed: false,
  starredOrder,
  currency: "USD",
  interestRate: null,
  minimumPayment: null,
  escrowAmount: null,
  paymentCategoryId: null,
  hasHistory: false,
  balances: { cleared: "0", uncleared: "0", working: "0" },
  lastReconciledAt: null,
  pairedCategoryId: null,
  lastPaymentDate: null,
  lastPaymentFromAccountId: null,
  migratedToAccountId: null,
  migratedFromAccountId: null,
  toReview: 0,
  unrealizedGain: null,
  rate: null,
  rateDate: null,
});

function UndoButton() {
  const history = useUndo();
  return (
    <button type="button" onClick={() => void history.undo()}>
      Undo
    </button>
  );
}

function renderStar(subject: Account, accounts: Account[]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UndoProvider>
        <StarButton budgetId="b1" account={subject} accounts={accounts} />
        <UndoButton />
      </UndoProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.calls = [];
});

describe("StarButton", () => {
  it("isn't offered on tracking, loan or closed accounts", () => {
    renderStar(account("t", "asset", null), []);
    renderStar(account("l", "mortgage", null), []);
    renderStar({ ...account("c", "checking", 0), closed: true }, []);
    expect(screen.queryByRole("button", { name: "Toggle Starred" })).not.toBeInTheDocument();
  });

  it("stars an account", async () => {
    const chk = account("chk", "checking", null);
    renderStar(chk, [chk]);
    const star = screen.getByRole("button", { name: "Toggle Starred" });
    expect(star).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(star);
    await waitFor(() => expect(api.calls).toContain('PATCH /accounts/chk {"starred":true}'));
  });

  it("unstars, and Undo puts it back in its place", async () => {
    const a = account("a", "checking", 0);
    const b = account("b", "credit_card", 1);
    const c = account("c", "savings", 2);
    renderStar(b, [a, b, c]);
    const star = screen.getByRole("button", { name: "Toggle Starred" });
    expect(star).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(star);
    await waitFor(() => expect(api.calls).toContain('PATCH /accounts/b {"starred":false}'));
    api.calls = [];
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(api.calls.filter((call) => !call.startsWith("GET"))).toEqual([
        'PATCH /accounts/b {"starred":true}',
        'POST /accounts/b/move {"beforeAccountId":"c","starred":true}',
      ]),
    );
  });
});
