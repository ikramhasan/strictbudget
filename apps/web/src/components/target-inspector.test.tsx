import { type CurrencyCode, formatAmount, money } from "@strictbudget/engine";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { inCurrency, type MoneySettings, parseMoneyInput, toMoneyInput } from "@/lib/money-input";
import type { CategoryTarget, TargetNeed } from "@/lib/targets";
import {
  type MoneyIO,
  paymentAlertShows,
  ReadOnlyTarget,
  type TargetCurrency,
  TargetSection,
} from "./target-inspector";

const usd: MoneySettings = {
  currency: "USD",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
};

const moneyIn = (currency: CurrencyCode): MoneyIO => {
  const settings = inCurrency(usd, currency);
  return {
    format: (amount) => formatAmount(money(BigInt(amount), settings.currency), settings),
    parse: (text) => parseMoneyInput(text, settings),
    toInput: (amount) => toMoneyInput(amount, settings),
  };
};

const eurTarget: CategoryTarget = {
  cadence: "monthly",
  behavior: "set_aside",
  amount: "150000",
  currency: "EUR",
  dueDay: null,
  dueDate: null,
  repeatEvery: null,
  repeatUnit: null,
  startMonth: "2026-10",
  startDay: null,
  snoozedMonth: null,
};
const need: TargetNeed = {
  needed: "162630",
  funded: "0",
  underfunded: "162630",
  dueDate: null,
  pastDue: false,
  snoozed: false,
  beforeOpening: false,
};

function renderSection(
  target: CategoryTarget | null,
  targetNeed: TargetNeed | null,
  currency: Partial<TargetCurrency> = {},
) {
  const onSave = vi.fn().mockResolvedValue(true);
  const usdIO = moneyIn("USD");
  render(
    <TargetSection
      name="Holiday"
      target={target}
      need={targetNeed}
      {...usdIO}
      dateFormat="MM/DD/YYYY"
      onSave={onSave}
      onDelete={vi.fn().mockResolvedValue(true)}
      currency={{
        budgetCurrency: "USD",
        moneyIn,
        conversion: null,
        rateMissing: false,
        ...currency,
      }}
    />,
  );
  return { onSave };
}

describe("TargetSection with a target in its own currency", () => {
  it("shows the target in its currency and what it needs in the budget's", () => {
    renderSection(eurTarget, need, { conversion: { amountInBase: "162630", rate: "1.0842" } });
    expect(screen.getByText("Set Aside Another €1,500.00 Each Month")).toBeInTheDocument();
    expect(screen.getByText("≈ $1,626.30 at today's rate")).toBeInTheDocument();
    expect(screen.getByText("Amount to Assign This Month").nextSibling).toHaveTextContent(
      "$1,626.30",
    );
  });

  it("says when no rate is known instead of offering a new target", () => {
    renderSection(eurTarget, null, { rateMissing: true });
    expect(screen.getByText("Set Aside Another €1,500.00 Each Month")).toBeInTheDocument();
    expect(screen.getByText(/No EUR to USD exchange rate is available yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Target" })).not.toBeInTheDocument();
  });

  it("creates a target in the budget's currency by default", async () => {
    const { onSave } = renderSection(null, null);
    await userEvent.click(screen.getByRole("button", { name: "Create Target" }));
    expect(screen.getByLabelText("Currency")).toHaveTextContent("USD");
    await userEvent.type(screen.getByLabelText("I need"), "100");
    await userEvent.click(screen.getByRole("button", { name: "Save Target" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ amount: "10000", currency: "USD" }),
    );
  });

  it("reads the amount in the picked currency's minor units", async () => {
    // cmdk scrolls the picked currency into view, which jsdom doesn't implement.
    Element.prototype.scrollIntoView = vi.fn();
    const { onSave } = renderSection(null, null);
    await userEvent.click(screen.getByRole("button", { name: "Create Target" }));
    await userEvent.click(screen.getByLabelText("Currency"));
    await userEvent.click(await screen.findByRole("option", { name: /JPY/ }));
    expect(screen.getByLabelText("Currency")).toHaveTextContent("JPY");
    await userEvent.type(screen.getByLabelText("I need"), "150,000");
    await userEvent.click(screen.getByRole("button", { name: "Save Target" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ cadence: "monthly", amount: "150000", currency: "JPY" }),
    );
    // The currency list has every ISO code; under a full parallel run this takes seconds.
  }, 15_000);

  it("edits a EUR target in euros", async () => {
    const { onSave } = renderSection(eurTarget, need, {
      conversion: { amountInBase: "162630", rate: "1.0842" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Edit Target" }));
    expect(screen.getByLabelText("Currency")).toHaveTextContent("EUR");
    expect(screen.getByLabelText("I need")).toHaveValue("1,500.00");
    await userEvent.click(screen.getByRole("button", { name: "Save Target" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ amount: "150000", currency: "EUR" }),
    );
  });
});

describe("ReadOnlyTarget for a viewer", () => {
  const usdIO = moneyIn("USD");
  const usdTarget: CategoryTarget = { ...eurTarget, currency: "USD", amount: "15000" };

  it("shows the target's details with nothing to change", () => {
    render(<ReadOnlyTarget target={usdTarget} need={need} format={usdIO.format} />);
    expect(screen.getByRole("region", { name: "Target" })).toBeInTheDocument();
    expect(screen.getByText("Set Aside Another $150.00 Each Month")).toBeInTheDocument();
    expect(screen.getByText("Amount to Assign This Month").nextSibling).toHaveTextContent(
      "$1,626.30",
    );
    for (const name of ["Edit Target", "Create Target", "Assign"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("shows nothing for a category without a target", () => {
    const { container } = render(
      <ReadOnlyTarget target={null} need={null} format={usdIO.format} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("titles a debt payment target", () => {
    render(<ReadOnlyTarget target={usdTarget} need={need} format={usdIO.format} debt />);
    expect(screen.getByRole("region", { name: "Debt Payment Target" })).toBeInTheDocument();
  });

  it("says when no rate is known, without an Edit button", () => {
    render(
      <ReadOnlyTarget
        target={eurTarget}
        need={null}
        format={usdIO.format}
        currency={{ budgetCurrency: "USD", moneyIn, conversion: null, rateMissing: true }}
      />,
    );
    expect(screen.getByText("Set Aside Another €1,500.00 Each Month")).toBeInTheDocument();
    expect(screen.getByText(/No EUR to USD exchange rate is available yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("paymentAlertShows", () => {
  const base = { target: eurTarget, need, overpaid: false, past: false };
  it("shows the alert while no target applies, or when overpaid, but not in a past month", () => {
    expect(paymentAlertShows({ ...base, target: null })).toBe(true);
    expect(paymentAlertShows({ ...base, need: null })).toBe(true);
    expect(paymentAlertShows({ ...base, overpaid: true })).toBe(true);
    expect(paymentAlertShows(base)).toBe(false);
    expect(paymentAlertShows({ ...base, target: null, past: true })).toBe(false);
  });
});
