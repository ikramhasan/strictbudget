import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LoanBanners } from "./loan-progress";

const post = vi.fn(async (..._args: unknown[]) => ({ data: {}, error: undefined }));
vi.mock("@/lib/api", () => ({ apiClient: { POST: (...args: unknown[]) => post(...args) } }));
vi.mock("@/lib/budget-context", () => ({ useBudget: () => ({ budget: { id: "b1" } }) }));

function renderBanners(banners: { simulatorDismissed: boolean; paidOffDismissed: boolean }) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <LoanBanners budgetId="b1" accountId="loan" banners={banners} paidOff onSimulate={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("LoanBanners", () => {
  it("hides what the plan has dismissed", () => {
    renderBanners({ simulatorDismissed: true, paidOffDismissed: false });
    expect(screen.queryByText(/loan payoff simulator/)).not.toBeInTheDocument();
    expect(screen.getByText("Another debt bites the dust.")).toBeInTheDocument();
  });

  it("dismisses on the server and hides at once", async () => {
    renderBanners({ simulatorDismissed: false, paidOffDismissed: false });
    const [simulator] = screen.getAllByRole("button", { name: "Dismiss" });
    if (!simulator) throw new Error("no dismiss button");
    await userEvent.click(simulator);
    expect(screen.queryByText(/loan payoff simulator/)).not.toBeInTheDocument();
    expect(post).toHaveBeenCalledWith(
      "/v1/budgets/{budgetId}/accounts/{accountId}/loan/banners/dismiss",
      { params: { path: { budgetId: "b1", accountId: "loan" } }, body: { banner: "simulator" } },
    );
  });
});
