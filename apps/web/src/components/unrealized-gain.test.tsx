import { formatAmount, money } from "@strictbudget/engine";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { signedAmount, UnrealizedGain } from "./unrealized-gain";

const usd = (m: bigint) =>
  formatAmount(money(m, "USD"), {
    numberFormat: "comma_dot",
    currencySymbolPosition: "before",
    dateFormat: "MM/DD/YYYY",
  });

const euros = {
  currency: "EUR" as const,
  closed: false,
  type: "checking" as const,
  unrealizedGain: "1234",
  rate: "1.0842",
};

describe("UnrealizedGain", () => {
  it("shows the gain with its rate and revalues after a confirm", async () => {
    const onRevalue = vi.fn(async () => {});
    render(
      <dl>
        <UnrealizedGain
          account={euros}
          budgetCurrency="USD"
          format={usd}
          pending={false}
          onRevalue={onRevalue}
        />
      </dl>,
    );
    expect(screen.getByText("+$12.34")).toBeInTheDocument();
    expect(screen.getByText("(at 1 EUR = 1.0842 USD)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Revalue" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("goes to Ready to Assign");
    await userEvent.click(screen.getByRole("button", { name: "Revalue" }));
    expect(onRevalue).toHaveBeenCalledOnce();
  });

  it("shows nothing without a rate, and no button on a closed account", () => {
    const { container } = render(
      <UnrealizedGain
        account={{ ...euros, unrealizedGain: null, rate: null }}
        budgetCurrency="USD"
        format={usd}
        pending={false}
        onRevalue={async () => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    render(
      <UnrealizedGain
        account={{ ...euros, closed: true }}
        budgetCurrency="USD"
        format={usd}
        pending={false}
        onRevalue={async () => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Revalue" })).not.toBeInTheDocument();
  });

  it("signs gains and losses", () => {
    expect(signedAmount(500n, usd)).toBe("+$5.00");
    expect(signedAmount(-500n, usd)).toBe(usd(-500n));
    expect(signedAmount(0n, usd)).toBe("$0.00");
  });
});
