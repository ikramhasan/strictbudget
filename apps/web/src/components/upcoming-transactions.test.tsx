import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UpcomingTransactions } from "./upcoming-transactions";

const format = (a: string) => `$${(Number(a) / 100).toFixed(2)}`;
const upcoming = {
  amount: "-5000",
  transactions: [
    {
      scheduleId: "s2",
      accountId: "wallet",
      accountName: "Wallet",
      date: "2026-10-25",
      payeeName: "U10 Payee",
      memo: "x-u10-C",
      amount: "-2000",
    },
    {
      scheduleId: "s1",
      accountId: "wallet",
      accountName: "Wallet",
      date: "2026-10-20",
      payeeName: "U10 Payee",
      memo: "x-u10-C",
      amount: "-3000",
    },
  ],
};

// A category with $50.00 scheduled and nothing available.
describe("UpcomingTransactions", () => {
  it("shows the upcoming total and what's left after it, yellow when short", () => {
    const { container } = render(
      <UpcomingTransactions
        name="U10 C"
        available={0n}
        upcoming={upcoming}
        format={format}
        formatDate={(d) => d}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "2 Upcoming Transactions" })).toBeInTheDocument();
    expect(screen.getByText("Available After Upcoming")).toBeInTheDocument();
    expect(screen.getAllByText("$-50.00")).toHaveLength(2);
    expect(container.firstElementChild?.className).toContain("bg-yellow-100");
  });

  it("lists them in an Activity popover and opens one in its register", async () => {
    const onOpen = vi.fn();
    render(
      <UpcomingTransactions
        name="U10 C"
        available={6000n}
        upcoming={{ ...upcoming, transactions: upcoming.transactions.slice(1), amount: "-3000" }}
        format={format}
        formatDate={(d) => d}
        onOpen={onOpen}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "1 Upcoming Transaction" }));
    expect(await screen.findByText("Activity")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Wallet" }));
    expect(onOpen).toHaveBeenCalledWith("wallet", "s1");
  });
});
