import { describe, expect, it } from "vitest";
import {
  type Account,
  closeAccountNotice,
  editBalanceLabel,
  excludedHint,
  sidebarSections,
  totalHint,
} from "./accounts";

function account(id: string, type: Account["type"], working: string, closed = false): Account {
  return {
    id,
    name: id,
    logo: null,
    type,
    note: "",
    closed,
    starredOrder: null,
    currency: "USD",
    interestRate: null,
    minimumPayment: null,
    escrowAmount: null,
    paymentCategoryId: null,
    hasHistory: false,
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
    balances: { cleared: working, uncleared: "0", working },
  };
}

describe("sidebarSections", () => {
  it("groups accounts for the sidebar, with totals", () => {
    const sections = sidebarSections(
      [
        account("checking", "checking", "150000"),
        account("visa", "credit_card", "-37500"),
        account("mortgage", "mortgage", "-2500000"),
        account("house", "asset", "40000000"),
        account("old", "savings", "0", true),
      ],
      "USD",
    );
    expect(sections.map((s) => [s.id, s.accounts.map((a) => a.id), s.total])).toEqual([
      ["budget", ["checking", "visa"], 112500n],
      ["loans", ["mortgage"], -2500000n],
      ["tracking", ["house"], 40000000n],
      ["closed", ["old"], 0n],
    ]);
  });

  it("puts starred open cash and credit accounts first, in their own order", () => {
    const star = (a: Account, order: number) => ({ ...a, starredOrder: order });
    const sections = sidebarSections(
      [
        star(account("checking", "checking", "1000"), 1),
        star(account("visa", "credit_card", "-300"), 0),
        account("savings", "savings", "50"),
        star(account("closed", "savings", "0", true), 2),
      ],
      "USD",
    );
    expect(sections.map((s) => [s.id, s.title, s.accounts.map((a) => a.id), s.total])).toEqual([
      ["starred", "Starred", ["visa", "checking"], 700n],
      ["budget", "Budget", ["checking", "visa", "savings"], 750n],
      ["closed", "Closed", ["closed"], 0n],
    ]);
  });

  it("leaves out empty sections", () => {
    expect(sidebarSections([account("cash", "cash", "100")], "USD").map((s) => s.id)).toEqual([
      "budget",
    ]);
  });
});

describe("sidebarSections with accounts in other currencies", () => {
  const inCurrency = (a: Account, currency: Account["currency"]): Account => ({ ...a, currency });

  it("totals only the budget's currency and lists the accounts left out", () => {
    const sections = sidebarSections(
      [
        account("house", "asset", "40000000"),
        inCurrency(account("euro", "asset", "123456"), "EUR"),
        inCurrency(account("yen", "liability", "-50000"), "JPY"),
        account("checking", "checking", "1000"),
      ],
      "USD",
    );
    expect(
      sections.map((s) => [s.id, s.total, s.excluded.map((a) => a.id), excludedHint(s.excluded)]),
    ).toEqual([
      ["budget", 1000n, [], null],
      ["tracking", 40000000n, ["euro", "yen"], "Excludes 2 accounts in other currencies"],
    ]);
  });

  it("names the currency when the accounts left out share one", () => {
    expect(excludedHint([{ currency: "EUR" }])).toBe("Excludes 1 EUR account");
    expect(excludedHint([{ currency: "EUR" }, { currency: "EUR" }])).toBe(
      "Excludes 2 EUR accounts",
    );
    expect(excludedHint([])).toBeNull();
  });

  it("totals a group of foreign accounts as zero in the budget's currency", () => {
    const [tracking] = sidebarSections(
      [inCurrency(account("euro", "asset", "123456"), "EUR")],
      "USD",
    );
    expect(tracking).toMatchObject({ id: "tracking", total: 0n });
    expect(tracking?.excluded).toHaveLength(1);
  });
});

describe("sidebarSections with converted totals", () => {
  const total = (amount: string, converted: boolean, missing: string[] = [], currency = "USD") => ({
    currency: currency as Account["currency"],
    amount,
    converted,
    missing,
  });
  const totals = {
    starred: total("0", false),
    budget: total("16000", true),
    loans: total("0", false),
    tracking: total("40000000", false, ["yen"]),
    closed: total("0", false),
    netWorth: total("40016000", true, ["yen"]),
  };

  it("uses the API's totals, marking converted ones and those missing a rate", () => {
    const sections = sidebarSections(
      [
        account("checking", "checking", "5000"),
        { ...account("euro", "savings", "10000"), currency: "EUR" },
        account("house", "asset", "40000000"),
        { ...account("yen", "liability", "-50000"), currency: "JPY" },
      ],
      "USD",
      totals,
    );
    expect(
      sections.map((s) => [s.id, s.total, s.currency, s.converted, s.excluded.map((a) => a.id)]),
    ).toEqual([
      ["budget", 16000n, "USD", true, []],
      ["tracking", 40000000n, "USD", false, ["yen"]],
    ]);
    expect(sections.map(totalHint)).toEqual([
      "Converted to USD at today's rates",
      "Excludes 1 JPY account",
    ]);
  });

  it("shows totals in the display currency", () => {
    const [budget] = sidebarSections([account("checking", "checking", "5000")], "USD", {
      ...totals,
      budget: total("4500", true, [], "EUR"),
    });
    expect(budget).toMatchObject({ total: 4500n, currency: "EUR", converted: true });
    expect(totalHint({ converted: true, currency: "EUR", excluded: [] })).toBe(
      "Converted to EUR at today's rates",
    );
  });

  it("has no hint for a total all in one currency", () => {
    expect(totalHint({ converted: false, currency: "USD", excluded: [] })).toBeNull();
  });
});

describe("closeAccountNotice", () => {
  it.each([
    ["cash account with money (Wallet)", "checking", 92400n, -92400n, true],
    ["card above zero (Card P)", "credit_card", 1000n, -1000n, true],
    ["line of credit above zero", "line_of_credit", 500n, -500n, true],
    ["overdrawn checking (x-129-Overdrawn)", "checking", -1000n, 1000n, false],
    ["card in debt (Card Y)", "credit_card", -2000n, 2000n, false],
    ["tracking asset above zero (x-129-AssetPos)", "asset", 4900n, -4900n, false],
    ["tracking asset below zero (x-129-AssetNeg)", "asset", -600n, 600n, false],
    ["tracking liability owing (x-129-LiabDebt)", "liability", -10100n, 10100n, false],
    ["tracking liability above zero (x-129-LiabPos)", "liability", 1900n, -1900n, false],
  ] as const)("%s", (_, type, working, adjustment, removesMoneyFromPlan) => {
    expect(closeAccountNotice(type, working)).toEqual({ adjustment, removesMoneyFromPlan });
  });
});

describe("editBalanceLabel", () => {
  it("says Today's Balance for loans and tracking accounts, Working Balance otherwise", () => {
    expect(editBalanceLabel("checking")).toBe("Working Balance");
    expect(editBalanceLabel("credit_card")).toBe("Working Balance");
    expect(editBalanceLabel("mortgage")).toBe("Today's Balance");
    expect(editBalanceLabel("asset")).toBe("Today's Balance");
    expect(editBalanceLabel("liability")).toBe("Today's Balance");
  });
});
