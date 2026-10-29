import { formatAmount, money } from "@strictbudget/engine";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type MoneySettings, parseMoneyInput, toMoneyInput } from "@/lib/money-input";
import type { CategoryTarget, TargetNeed } from "@/lib/targets";
import { goalPreview } from "./savings-goal-editor";
import { ReadOnlyTarget, TargetSection } from "./target-inspector";

const usd: MoneySettings = {
  currency: "USD",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
};
const io = {
  format: (amount: string) => formatAmount(money(BigInt(amount), "USD"), usd),
  parse: (text: string) => parseMoneyInput(text, usd),
  toInput: (amount: string) => toMoneyInput(amount, usd),
};

const goalTarget = (extra: Partial<CategoryTarget>): CategoryTarget => ({
  cadence: "monthly",
  behavior: "refill",
  amount: "50000",
  currency: "USD",
  dueDay: null,
  dueDate: null,
  repeatEvery: null,
  repeatUnit: null,
  startMonth: "2026-10",
  startDay: null,
  snoozedMonth: null,
  goal: "safety_fund",
  goalAmount: "1000000",
  ...extra,
});
const need = (needed: string, funded: string, underfunded: string): TargetNeed => ({
  needed,
  funded,
  underfunded,
  dueDate: null,
  pastDue: false,
  snoozed: false,
  beforeOpening: false,
});

function renderSavings(
  target: CategoryTarget | null = null,
  targetNeed: TargetNeed | null = null,
  saved = { before: 0n, assigned: 0n },
) {
  const onSave = vi.fn().mockResolvedValue(true);
  render(
    <TargetSection
      name="Emergency fund"
      target={target}
      need={targetNeed}
      {...io}
      dateFormat="MM/DD/YYYY"
      onSave={onSave}
      onDelete={vi.fn().mockResolvedValue(true)}
      savings={{ month: "2026-10", saved }}
    />,
  );
  return { onSave };
}

describe("savings goals in the inspector", () => {
  it("invites a goal on a savings category, saving up by a date by default", async () => {
    const { onSave } = renderSavings(null, null, { before: 40000n, assigned: 0n });
    expect(screen.getByText("What are you saving Emergency fund for?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Set a Savings Goal" }));
    expect(screen.getByRole("radio", { name: /Save up for something/ })).toBeChecked();
    await userEvent.type(screen.getByLabelText("How much do you want to save?"), "1500");
    // Due September 2027 by default: twelve months from October 2026.
    expect(
      screen.getByText("That's $91.67 a month until Sep 2027. $400.00 is in it already."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save Goal" }));
    expect(onSave).toHaveBeenCalledWith({
      cadence: "custom",
      behavior: "set_aside",
      amount: "150000",
      goalAmount: "150000",
      dueDate: "2027-09-30",
      repeat: null,
      goal: "save_up",
    });
  });

  it("saves up so much a month and says when it gets there", async () => {
    const { onSave } = renderSavings();
    await userEvent.click(screen.getByRole("button", { name: "Set a Savings Goal" }));
    await userEvent.type(screen.getByLabelText("How much do you want to save?"), "1000");
    await userEvent.click(screen.getByRole("radio", { name: "So much a month" }));
    await userEvent.type(screen.getByLabelText("How much each month?"), "250");
    expect(
      screen.getByText("At $250.00 a month you'll get there by Jan 2027."),
    ).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("How much each month?"));
    await userEvent.type(screen.getByLabelText("How much each month?"), "2000");
    await userEvent.click(screen.getByRole("button", { name: "Save Goal" }));
    expect(screen.getByText("That's more than the goal itself.")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText("How much each month?"));
    await userEvent.type(screen.getByLabelText("How much each month?"), "250");
    await userEvent.click(screen.getByRole("button", { name: "Save Goal" }));
    expect(onSave).toHaveBeenCalledWith({
      cadence: "monthly",
      behavior: "set_aside",
      amount: "25000",
      goalAmount: "100000",
      dueDay: null,
      goal: "save_up",
    });
  });

  it("keeps a safety fund, a little each month or all at once", async () => {
    const { onSave } = renderSavings();
    await userEvent.click(screen.getByRole("button", { name: "Set a Savings Goal" }));
    await userEvent.click(screen.getByRole("radio", { name: /Keep a safety fund/ }));
    await userEvent.type(screen.getByLabelText("How much do you want to keep?"), "10000");
    await userEvent.type(screen.getByLabelText("Most to put in each month"), "500");
    expect(
      screen.getByText(
        "It asks for up to $500.00 a month until it holds $10,000.00, and again after you use it.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "All at once" }));
    expect(screen.queryByLabelText("Most to put in each month")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save Goal" }));
    expect(onSave).toHaveBeenCalledWith({
      cadence: "monthly",
      behavior: "refill",
      amount: "1000000",
      goalAmount: "1000000",
      dueDay: null,
      goal: "safety_fund",
    });
  });

  it("keeps saving so much a month, counted as saved in reports", async () => {
    const { onSave } = renderSavings();
    await userEvent.click(screen.getByRole("button", { name: "Set a Savings Goal" }));
    await userEvent.click(screen.getByRole("radio", { name: /Keep saving/ }));
    expect(screen.getByText(/counts as saved, not spent, in your reports/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("How much each month?"), "400");
    await userEvent.click(screen.getByRole("button", { name: "Save Goal" }));
    expect(onSave).toHaveBeenCalledWith({
      cadence: "monthly",
      behavior: "set_aside",
      amount: "40000",
      dueDay: null,
      goal: "keep_saving",
    });
  });

  it("offers the usual target form, and back", async () => {
    renderSavings();
    await userEvent.click(screen.getByRole("button", { name: "Set a Savings Goal" }));
    await userEvent.click(screen.getByRole("button", { name: "Use another kind of target" }));
    expect(screen.getByRole("button", { name: "Save Target" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Use a savings goal instead" }));
    expect(screen.getByRole("button", { name: "Save Goal" })).toBeInTheDocument();
  });

  it("sums up a safety fund and edits it with its values", async () => {
    renderSavings(goalTarget({}), need("1000000", "900000", "0"));
    expect(screen.getByText("Keep a safety fund")).toBeInTheDocument();
    expect(screen.getByText("Keep $10,000.00 Saved")).toBeInTheDocument();
    expect(screen.getByText("Refills Up to $500.00 a Month")).toBeInTheDocument();
    expect(screen.getByText("You're on track: it's filling up.")).toBeInTheDocument();
    expect(screen.getByText("In the Fund").nextSibling).toHaveTextContent("$9,000.00");
    await userEvent.click(screen.getByRole("button", { name: "Edit Goal" }));
    expect(screen.getByRole("radio", { name: /Keep a safety fund/ })).toBeChecked();
    expect(screen.getByLabelText("How much do you want to keep?")).toHaveValue("10,000.00");
    expect(screen.getByLabelText("Most to put in each month")).toHaveValue("500.00");
  });

  it("says when a save-up goal saving so much a month gets there", () => {
    render(
      <ReadOnlyTarget
        target={goalTarget({
          behavior: "set_aside",
          goal: "save_up",
          amount: "25000",
          goalAmount: "300000",
        })}
        need={need("300000", "110000", "15000")}
        format={io.format}
        month="2026-10"
      />,
    );
    expect(screen.getByText("Savings Goal")).toBeInTheDocument();
    expect(screen.getByText("Save $3,000.00, $250.00 a Month")).toBeInTheDocument();
    // $1,900 left: $150 more this month, then $250 a month for seven months.
    expect(screen.getByText("Reached by May 2027")).toBeInTheDocument();
    expect(screen.getByText("Saved So Far").nextSibling).toHaveTextContent("$1,100.00");
  });
});

describe("goalPreview", () => {
  const preview = (extra: Partial<Parameters<typeof goalPreview>[0]>) =>
    goalPreview({
      goal: "save_up",
      byDate: true,
      allAtOnce: false,
      month: "2026-10",
      dueMonth: "2027-03",
      saved: { before: 0n, assigned: 0n },
      goalAmount: 120000n,
      perMonth: null,
      format: io.format,
      ...extra,
    });

  it("spreads what was left before this month, as the plan does", () => {
    expect(preview({})).toBe("That's $200.00 a month until Mar 2027.");
    // $200 assigned this month doesn't lower this month's share, only what's in.
    expect(preview({ saved: { before: 0n, assigned: 20000n } })).toBe(
      "That's $200.00 a month until Mar 2027. $200.00 is in it already.",
    );
    expect(preview({ dueMonth: "2026-10" })).toBe("That's $1,200.00 this month.");
    expect(preview({ dueMonth: "2026-09" })).toBe("Choose this month or later.");
    expect(preview({ saved: { before: 120000n, assigned: 0n } })).toBe(
      "You've already saved that much.",
    );
  });

  it("counts this month's Assigned toward when so much a month gets there", () => {
    const monthly = { byDate: false, perMonth: 25000n, goalAmount: 100000n };
    expect(preview(monthly)).toBe("At $250.00 a month you'll get there by Jan 2027.");
    expect(preview({ ...monthly, saved: { before: 0n, assigned: 25000n } })).toBe(
      "At $250.00 a month you'll get there by Jan 2027. $250.00 is in it already.",
    );
    expect(preview({ ...monthly, goalAmount: 20000n })).toBe(
      "At $250.00 a month you'll get there this month.",
    );
    expect(preview({ byDate: false, perMonth: null })).toBeNull();
  });

  it("explains safety funds and keep saving", () => {
    expect(preview({ goal: "safety_fund", allAtOnce: true })).toBe(
      "Whenever it's below $1,200.00, it asks for what brings it back up.",
    );
    expect(preview({ goal: "keep_saving", goalAmount: null })).toMatch(/counts as saved/);
  });
});
