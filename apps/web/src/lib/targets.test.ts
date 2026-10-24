import { describe, expect, it } from "vitest";
import {
  type CategoryTarget,
  categoryRowNote,
  dueDayIn,
  ordinal,
  payoffAmount,
  type TargetNeed,
  targetDueLine,
  targetHeading,
  targetLines,
  targetMessage,
  targetRowNote,
} from "./targets";

const format = (minor: string) => `$${(Number(minor) / 100).toFixed(2)}`;

const target = (extra: Partial<CategoryTarget> = {}): CategoryTarget => ({
  cadence: "monthly",
  behavior: "set_aside",
  amount: "10000",
  currency: "USD",
  dueDay: null,
  dueDate: null,
  repeatEvery: null,
  repeatUnit: null,
  startMonth: "2026-10",
  startDay: null,
  snoozedMonth: null,
  ...extra,
});
const need = (
  needed: string,
  funded: string,
  underfunded: string,
  dueDate: string | null = null,
  pastDue = false,
): TargetNeed => ({
  needed,
  funded,
  underfunded,
  dueDate,
  pastDue,
  snoozed: false,
  beforeOpening: false,
});
const bar = (spent: string, left: string) => ({
  tone: "funded" as const,
  sections: [
    {
      kind: "target" as const,
      size: "0",
      segments: [
        { kind: "spent" as const, amount: spent },
        { kind: "available" as const, amount: left },
      ],
    },
  ],
});

describe("target wording", () => {
  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "31st",
    ]);
  });

  it("falls due on the last day by default", () => {
    expect(dueDayIn(null, "2026-10")).toBe(31);
    expect(dueDayIn(null, "2026-11")).toBe(30);
    expect(dueDayIn(15, "2026-11")).toBe(15);
    expect(dueDayIn(31, "2026-02")).toBe(28);
  });

  it("matches the inspector headings", () => {
    expect(targetHeading(target(), "$100.00")).toBe("Set Aside Another $100.00 Each Month");
    expect(targetHeading(target({ behavior: "refill" }), "$100.00")).toBe(
      "Refill Up to $100.00 Each Month",
    );
    expect(targetHeading(target({ cadence: "weekly", dueDay: 6 }), "$10.00")).toBe(
      "Set Aside Another $10.00 Each Week",
    );
    expect(targetHeading(target({ cadence: "yearly" }), "$1,000.00")).toBe(
      "Set Aside Another $1,000.00 Each Year",
    );
    expect(
      targetHeading(target({ cadence: "custom", repeatEvery: 2, repeatUnit: "month" }), "$300.00"),
    ).toBe("Set Aside Another $300.00 Every 2 Months");
    expect(targetHeading(target({ cadence: "custom" }), "$300.00")).toBe(
      "Set Aside Another $300.00",
    );
    expect(targetHeading(target({ cadence: "custom", behavior: "balance" }), "$300.00")).toBe(
      "Have a Balance of $300.00",
    );
  });

  it("matches the due lines", () => {
    expect(targetDueLine(target(), null)).toBe("By the End of the Month");
    expect(targetDueLine(target({ dueDay: 15 }), null)).toBe("By the 15th of the Month");
    expect(targetDueLine(target({ cadence: "weekly", dueDay: 6 }), null)).toBe("By Saturday");
    expect(
      targetDueLine(target({ cadence: "yearly", dueDate: "2026-12-30" }), {
        dueDate: "2026-12-30",
      }),
    ).toBe("By Dec 30 2026");
    const balance = target({ cadence: "custom", behavior: "balance" });
    expect(targetDueLine(balance, null)).toBe("Eventually");
    expect(targetDueLine({ ...balance, dueDate: "2026-12-01" }, null)).toBe("By Dec 2026");
  });

  it("matches the row notes", () => {
    const note = (t: CategoryTarget, n: TargetNeed, month = "2026-10") =>
      targetRowNote(t, n, month, format).text;
    expect(note(target(), need("10000", "4000", "6000"))).toBe("$60.00 more needed by the 31st");
    expect(note(target(), need("10000", "0", "10000"))).toBe("$100.00 more needed by the 31st");
    expect(note(target({ behavior: "refill" }), need("10000", "0", "10000"))).toBe(
      "$100.00 needed by the 31st",
    );
    expect(note(target(), need("10000", "10000", "0"))).toBe("Funded");
    expect(note(target({ cadence: "weekly", dueDay: 6 }), need("5000", "0", "5000"))).toBe(
      "$50.00 more needed this month",
    );
    const yearly = target({ cadence: "yearly", dueDate: "2026-12-30" });
    expect(note(yearly, need("100000", "0", "33334", "2026-12-30"))).toBe(
      "$333.34 more needed this month",
    );
    expect(note(yearly, need("100000", "33334", "66666", "2026-12-30"), "2026-12")).toBe(
      "$666.66 more needed by December 30th",
    );
    expect(note(yearly, need("100000", "33334", "0", "2026-12-30"))).toBe("On Track");
    const eventually = target({ cadence: "custom", behavior: "balance", amount: "30000" });
    expect(note(eventually, need("30000", "0", "0"))).toBe("$300.00 needed eventually");
    expect(
      note({ ...eventually, dueDate: "2026-12-01" }, need("30000", "0", "10000", "2026-12-01")),
    ).toBe("$100.00 needed this month");
  });

  it("writes met and past-due row notes with their spending", () => {
    const row = (t: CategoryTarget, n: TargetNeed, spent: string, left: string) =>
      categoryRowNote(t, n, bar(spent, left), "2026-10", format);
    const monthly = target({ amount: "5000" });
    // $50.00 assigned and spent.
    expect(row(monthly, need("5000", "5000", "0"), "5000", "0")).toEqual({
      strong: "",
      rest: "Fully Spent",
    });
    expect(row(monthly, need("5000", "5000", "0"), "2000", "3000")).toEqual({
      strong: "Funded",
      rest: ". Spent $20.00 of $50.00",
    });
    const once = target({ cadence: "custom", amount: "10000", dueDate: "2026-09-15" });
    const past = (funded: string) => need("10000", funded, "0", "2026-09-15", true);
    // $30.00 assigned, $10.00 spent; then with $40.00 and with nothing in it.
    expect(row(once, past("3000"), "1000", "2000")).toEqual({
      strong: "Funded",
      rest: ". Spent $10.00 of $30.00",
    });
    expect(row(once, past("4000"), "0", "4000")).toEqual({ strong: "Funded", rest: "" });
    expect(row(once, past("0"), "0", "0")).toBeNull();
    expect(targetMessage(once, past("3000"), format)).toBeNull();
  });

  it("asks to meet a pay-off target in its own month", () => {
    const payoff = target({ cadence: "payoff_by_date", dueDate: "2026-10-01", amount: "0" });
    const n = need("200", "100", "100", "2026-10-01");
    expect(targetMessage(payoff, n, format, "2026-10")).toEqual({
      prompt: "$1.00",
      suffix: " to meet your target",
    });
    expect(targetMessage(payoff, { ...n, dueDate: "2026-12-01" }, format, "2026-10")).toEqual({
      prompt: "$1.00",
      suffix: " this month to stay on track",
    });
    expect(targetMessage(payoff, need("200", "100", "0", "2026-10-01", true), format)).toBeNull();
  });

  // The card was opened Oct 8; its target is seen in September.
  it("asks $0.00 of a payment target before its card was opened", () => {
    const monthly = target({ cadence: "payment_monthly", behavior: "set_aside", amount: "3000" });
    const n = { ...need("3000", "0", "0"), beforeOpening: true };
    expect(targetMessage(monthly, n, format, "2026-09")).toEqual({
      prompt: "$0.00",
      suffix: " to meet your target",
    });
    expect(targetLines(monthly, n, format).at(-1)).toEqual({ label: "To Go", value: "$0.00" });
  });

  it("labels the inspector lines and message per kind", () => {
    const yearly = target({ cadence: "yearly", dueDate: "2026-12-30" });
    const n = need("100000", "0", "33334", "2026-12-30");
    expect(targetLines(yearly, n, format).map((l) => l.label)).toEqual([
      "Total to Assign by Dec 30 2026",
      "Assigned So Far",
      "To Go",
    ]);
    expect(targetMessage(yearly, n, format)).toEqual({
      prompt: "$333.34",
      suffix: " this month to stay on track",
    });
    expect(targetMessage(yearly, need("100000", "33334", "0"), format)).toEqual({
      text: "You're on track to meet your target!",
    });
    expect(targetMessage(target(), need("10000", "4000", "6000"), format)).toEqual({
      prompt: "$60.00 more",
      suffix: " to meet your target",
    });
    const eventually = target({ cadence: "custom", behavior: "balance" });
    expect(targetLines(eventually, need("30000", "0", "0"), format).map((l) => l.label)).toEqual([
      "Balance Needed",
      "Current Balance",
      "To Go",
    ]);
    expect(targetMessage(eventually, need("30000", "0", "0"), format)).toBeNull();
  });
});

describe("payment target wording", () => {
  const payoff = target({
    cadence: "payoff_by_date",
    behavior: "balance",
    amount: "0",
    dueDate: "2027-03-01",
  });
  const monthly = target({ cadence: "payment_monthly", amount: "3000" });

  it("heads Pay off by date with what's left to pay off, and its month", () => {
    expect(targetHeading(payoff, "$100.00")).toBe("Pay off $100.00");
    expect(targetDueLine(payoff, null)).toBe("By Mar 2027");
    // $110.00 owed, $10.00 of it funded spending: the lines add it back.
    expect(targetLines(payoff, need("10000", "0", "3334", "2026-12-01"), format, "1000")).toEqual([
      { label: "Needed for Payoff", value: "$110.00" },
      { label: "Available for Payment", value: "$10.00" },
      { label: "To Go", value: "$100.00" },
    ]);
    expect(targetMessage(payoff, need("12500", "0", "2084"), format)).toEqual({
      prompt: "$20.84",
      suffix: " this month to stay on track",
    });
    expect(targetMessage(payoff, need("12500", "5000", "0"), format)).toEqual({
      text: "You're on track to meet your target!",
    });
  });

  it("cheers a met pay-off target and heads it with what's been put in plus To Go", () => {
    // Owes $14.00, $20.00 assigned and $6.00 paid, so $14.00 counts.
    expect(targetMessage(payoff, need("1400", "1400", "0"), format)).toEqual({
      text: "Cheers to a debt-free future!",
    });
    expect(payoffAmount(need("1400", "1400", "0"), "-600")).toBe("2000");
    // Paid off: nothing owed or counted, $20.00 paid.
    expect(payoffAmount(need("0", "0", "0"), "-2000")).toBe("2000");
    // $50.00 counted of $125.00, nothing paid.
    expect(payoffAmount(need("12500", "5000", "2084"), "0")).toBe("12500");
    // A met Pay Specific Amount Monthly keeps the usual words.
    expect(targetMessage(monthly, need("500", "500", "0"), format)).toEqual({
      text: "You've met your target!",
    });
  });

  it("heads Pay Specific Amount Monthly with its amount, each month", () => {
    expect(targetHeading(monthly, "$30.00")).toBe("$30.00");
    expect(targetDueLine(monthly, null)).toBe("Each Month");
    expect(targetLines(monthly, need("3000", "0", "3000"), format).map((l) => l.label)).toEqual([
      "Amount to Assign This Month",
      "Assigned So Far",
      "To Go",
    ]);
    expect(targetMessage(monthly, need("3000", "0", "3000"), format)).toEqual({
      prompt: "$30.00",
      suffix: " to meet your target",
    });
  });
});
