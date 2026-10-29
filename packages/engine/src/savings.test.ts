import { describe, expect, it } from "vitest";
import { looksLikeSavings } from "./savings";

describe("looksLikeSavings", () => {
  it.each([
    "😌 Emergency fund",
    "💰 Savings",
    "Short-Term Savings",
    "Rainy day",
    "Nest egg",
    "📈 Investments",
    "Investing a little extra",
    "Retirement fund",
    "401k",
    "401(k)",
    "Roth IRA",
    "Stocks & Shares ISA",
    "Saving for a car",
  ])("matches %s", (name) => expect(looksLikeSavings(name)).toBe(true));

  it.each([
    "📻 Emergency Radio",
    "✉️ Invites, Save the Dates, Postage",
    "🎨 Retirement Hobbies & Fun",
    "Groceries",
    "Dining out",
    "Isabella's gifts",
    "Investigations",
  ])("doesn't match %s", (name) => expect(looksLikeSavings(name)).toBe(false));
});
