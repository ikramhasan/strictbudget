import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LoanMonthData, LoanUpcoming } from "@/lib/loans";
import { MonthCard } from "./loan-page";

const format = (m: bigint) => `${m < 0n ? "-" : ""}$${(Number(m < 0n ? -m : m) / 100).toFixed(2)}`;
const charge = { total: "0", applied: "0", status: "estimated" as const, editedAt: null };

const month = (patch: Partial<LoanMonthData> = {}): LoanMonthData => ({
  month: "2026-10",
  startBalance: "-100000",
  endBalance: "-99000",
  payments: "0",
  interest: charge,
  escrow: charge,
  transactions: [],
  ...patch,
});

const upcoming = (date: string, amount: string, memo: string): LoanUpcoming => ({
  scheduleId: `s-${memo}`,
  date,
  accountId: "loan",
  accountName: "x Loan",
  payeeName: "Transfer : x Chk",
  memo,
  amount,
  payingAccountId: "chk",
  payingRowId: `s-${memo}~chk`,
});

function renderCard(m: LoanMonthData, items: LoanUpcoming[]) {
  const onOpenUpcoming = vi.fn();
  render(
    <MonthCard
      month={m}
      first={false}
      defaultOpen
      upcoming={items}
      formatDate={(d) => d}
      onOpenUpcoming={onOpenUpcoming}
      accounts={[]}
      budgetId="b"
      format={format}
    />,
  );
  return { onOpenUpcoming };
}

describe("loan month card: upcoming payments", () => {
  it("replaces No payments this month with the upcoming line", () => {
    renderCard(month(), [upcoming("2026-10-25", "100", "d")]);
    expect(screen.queryByText("No payments this month")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 Upcoming Transaction" })).toBeInTheDocument();
    expect(screen.getByText(/for \$1\.00/)).toBeInTheDocument();
  });

  it("lists them under the entered payments, and opens the Activity popover", async () => {
    const { onOpenUpcoming } = renderCard(
      month({
        payments: "1000",
        transactions: [
          {
            id: "t1",
            date: "2026-10-17",
            amount: "1000",
            memo: "x-future",
            kind: "payment",
            payeeKind: null,
            fromAccountId: null,
            otherSideId: null,
          },
        ],
      }),
      [upcoming("2026-10-28", "3000", "b"), upcoming("2026-10-20", "2000", "a")],
    );
    // The entered payment keeps its total; the upcoming ones aren't in it.
    expect(screen.getByText("$10.00")).toBeInTheDocument();
    expect(screen.getByText(/for \$50\.00/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "2 Upcoming Transactions" }));
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows.map((r) => r.textContent)).toEqual([
      "AccountDatePayeeMemoAmount",
      "x Loan2026-10-28Transfer : x Chkb+$30.00",
      "x Loan2026-10-20Transfer : x Chka+$20.00",
    ]);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    // A row opens the schedule in the paying account's register.
    await user.click(screen.getByRole("button", { name: "2 Upcoming Transactions" }));
    await user.click(within(screen.getByRole("table")).getAllByRole("row")[2] as HTMLElement);
    expect(onOpenUpcoming).toHaveBeenCalledWith(expect.objectContaining({ memo: "a" }));
  });

  it("says No payments this month without any", () => {
    renderCard(month(), []);
    expect(screen.getByText("No payments this month")).toBeInTheDocument();
  });
});
