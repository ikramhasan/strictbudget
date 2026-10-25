import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MoneySettings } from "@/lib/money-input";
import { bankBalance, ReconcileBanner, reconciledLabel } from "./reconcile";

const usd: MoneySettings = {
  currency: "USD",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
};
const show = (amount: bigint) => `$${(Number(amount) / 100).toFixed(2)}`;

describe("reconciledLabel", () => {
  const now = new Date("2026-10-11T00:00:00Z");
  it("words the last reconciliation", () => {
    expect(reconciledLabel(null, now)).toBe("Not Yet Reconciled");
    expect(reconciledLabel("2026-10-10T23:59:50Z", now)).toBe("Reconciled a few seconds ago");
    expect(reconciledLabel("2026-10-10T23:56:00Z", now)).toBe("Reconciled 4 minutes ago");
    // "9 days ago" for 8 days and 13 hours.
    expect(reconciledLabel("2026-10-02T10:02:18Z", now)).toBe("Reconciled 9 days ago");
  });
});

describe("bankBalance", () => {
  it("takes what's owed on debt accounts, whatever the sign", () => {
    expect(bankBalance("480", { type: "checking" }, usd)).toBe(48000n);
    expect(bankBalance("-5", { type: "checking" }, usd)).toBe(-500n);
    expect(bankBalance("57", { type: "credit_card" }, usd)).toBe(-5700n);
    expect(bankBalance("-60", { type: "credit_card" }, usd)).toBe(-6000n);
    expect(bankBalance("110", { type: "liability" }, usd)).toBe(-11000n);
    expect(typeof bankBalance("abc", { type: "checking" }, usd)).toBe("string");
  });
});

describe("ReconcileBanner", () => {
  it("says how the cleared balance compares and how to finish", () => {
    const props = { show, pending: false, onCancel: vi.fn(), onFinish: vi.fn() };
    const { rerender } = render(<ReconcileBanner difference={-1100n} {...props} />);
    expect(screen.getByRole("region", { name: "Reconciling" })).toHaveTextContent(
      "This account's cleared balance in strictbudget is $11.00 higher than your actual account.",
    );
    expect(screen.getByRole("button", { name: "Create Adjustment & Finish" })).toBeVisible();
    rerender(<ReconcileBanner difference={300n} {...props} />);
    expect(screen.getByRole("region")).toHaveTextContent("$3.00 lower than");
    rerender(<ReconcileBanner difference={0n} {...props} />);
    expect(screen.getByRole("region")).toHaveTextContent("is the same as your actual account.");
    expect(screen.getByRole("button", { name: "Finish Reconciliation" })).toBeVisible();
  });
});

describe("ReconcilePopover", () => {
  it("asks for the bank balance, explains the difference and remembers Don't Show Again", async () => {
    const { ReconcilePopover } = await import("./reconcile");
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    localStorage.clear();
    const onStart = vi.fn();
    const account = {
      type: "credit_card",
      balances: { cleared: "-5300", uncleared: "0", working: "-5300" },
    } as Parameters<typeof ReconcilePopover>[0]["account"];
    render(
      <ReconcilePopover
        account={account}
        settings={usd}
        open
        onOpenChange={vi.fn()}
        show={show}
        pending={false}
        onConfirm={vi.fn()}
        onStart={onStart}
      />,
    );
    expect(screen.getByText("$-53.00?")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "No" }));
    await user.type(screen.getByLabelText("Current balance at your bank"), "57{Enter}");
    expect(screen.getByText("Difference")).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "Don't Show Again" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onStart).toHaveBeenCalledWith(-5700n);
    expect(localStorage.getItem("strictbudget:skipDifferenceExplanation")).toBe("true");
  });
});
