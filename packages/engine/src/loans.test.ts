import { describe, expect, it } from "vitest";
import {
  type LoanLine,
  type LoanTerms,
  loanCharges,
  loanMonths,
  loanTermsEntries,
  monthlyInterest,
  rateThousandths,
  termsFor,
  withLoanTerms,
} from "./loans";

const terms = (
  month: string,
  interestRate: string | null,
  escrowAmount: bigint | null = null,
): LoanTerms => ({ month, interestRate, minimumPayment: null, escrowAmount });
const start = (date: string, amount: bigint): LoanLine => ({
  date,
  amount,
  kind: "starting_balance",
});
const pay = (date: string, amount: bigint): LoanLine => ({ date, amount, kind: "payment" });
const other = (date: string, amount: bigint): LoanLine => ({ date, amount, kind: "other" });

describe("rateThousandths", () => {
  it.each([
    ["5.125", 5125n],
    ["6", 6000n],
    ["0.5", 500n],
    ["12.25", 12250n],
    ["100", 100000n],
  ])("%s → %s", (rate, expected) => expect(rateThousandths(rate)).toBe(expected));

  it("rejects anything else", () => {
    expect(() => rateThousandths("5.1255")).toThrow(RangeError);
    expect(() => rateThousandths("-1")).toThrow(RangeError);
  });
});

describe("monthlyInterest", () => {
  it.each([
    [10_000_000n, "5.125", 42_708n], // $100,000.00 → $427.08
    [9_967_708n, "5.125", 42_570n], // $99,677.08 → $425.70
    [9_840_000n, "5.125", 42_025n], // $98,400.00 → $420.25
    [1_000_100n, "6", 5_001n], // $10,001.00 → $50.01 (50.005 rounds up)
    [700n, "6", 4n], // $7.00 → $0.04 (0.035 rounds up)
    [1_000_100n, "12", 10_001n], // $10,001.00 at 12% → $100.01
    [207_497n, "6", 1_038n], // $2,074.97 → $10.38: 10.37485 → 10.375 → 10.38
    [974_500n, "6", 4_873n], // $9,745.00 → $48.73 (48.725)
  ])("%s at %s%% → %s", (owed, rate, expected) =>
    expect(monthlyInterest(owed, rate, 2)).toBe(expected),
  );

  it("rounds once for currencies with three decimals and twice to whole units", () => {
    expect(monthlyInterest(2_074_970n, "6", 3)).toBe(10_375n); // 10.37485 → 10.375
    expect(monthlyInterest(2_075n, "6", 0)).toBe(10n); // 10.375 → 10.375 → 10
    expect(monthlyInterest(2_100n, "6", 0)).toBe(11n); // 10.5 → 11
  });

  it("is zero without debt or a rate", () => {
    expect(monthlyInterest(0n, "6", 2)).toBe(0n);
    expect(monthlyInterest(-500n, "6", 2)).toBe(0n);
    expect(monthlyInterest(10_000n, null, 2)).toBe(0n);
  });
});

describe("termsFor", () => {
  const history = [terms("2026-10", "6"), terms("2026-12", "7")];
  it.each([
    ["2026-08", "6"], // before the first entry: the first one
    ["2026-10", "6"],
    ["2026-11", "6"],
    ["2026-12", "7"],
    ["2027-03", "7"],
  ])("%s uses %s%%", (month, rate) => expect(termsFor(history, month)?.interestRate).toBe(rate));

  it("is null without terms", () => expect(termsFor([], "2026-10")).toBeNull());
});

describe("loanTermsEntries (Update Balance's check step)", () => {
  const history = [terms("2026-10", "6", 15_000n)];
  const keep = <T>(value: T) => ({ value, keep: true });
  const once = <T>(value: T) => ({ value, keep: false });

  it("writes nothing when nothing changes", () => {
    expect(loanTermsEntries(history, "2026-10", {})).toEqual([]);
    expect(
      loanTermsEntries(history, "2026-10", {
        interestRate: keep("6.000"),
        escrowAmount: keep(15_000n),
      }),
    ).toEqual([]);
  });

  it("changes the month and going forward", () => {
    expect(loanTermsEntries(history, "2026-10", { interestRate: keep("7") })).toEqual([
      terms("2026-10", "7", 15_000n),
    ]);
    expect(loanTermsEntries(history, "2026-11", { escrowAmount: keep(20_000n) })).toEqual([
      terms("2026-11", "6", 20_000n),
    ]);
  });

  it("brings the old value back next month when not kept", () => {
    // 6% → 7% unchecked: {2026-10-01: 7%, 2026-11-01: 6%}.
    expect(loanTermsEntries(history, "2026-10", { interestRate: once("7") })).toEqual([
      terms("2026-10", "7", 15_000n),
      terms("2026-11", "6", 15_000n),
    ]);
    expect(
      loanTermsEntries(history, "2026-12", {
        interestRate: keep("7"),
        escrowAmount: once(20_000n),
      }),
    ).toEqual([terms("2026-12", "7", 20_000n), terms("2027-01", "7", 15_000n)]);
  });

  it("keeps a kept value in later months an earlier unkept change wrote", () => {
    // 7% unkept in October left {Oct: 7%, Nov: 6%}; 8% kept in October must hold in November too.
    const after = [terms("2026-10", "7", 15_000n), terms("2026-11", "6", 15_000n)];
    expect(loanTermsEntries(after, "2026-10", { interestRate: keep("8") })).toEqual([
      terms("2026-10", "8", 15_000n),
      terms("2026-11", "8", 15_000n),
    ]);
  });

  it("merges entries over the history", () => {
    const merged = withLoanTerms(
      [terms("2026-09", "5"), terms("2026-10", "6")],
      [terms("2026-10", "7"), terms("2026-11", "6")],
    );
    expect(merged).toEqual([terms("2026-09", "5"), terms("2026-10", "7"), terms("2026-11", "6")]);
  });

  it("re-estimates the month's interest at the new rate", () => {
    // $100,000 from Sep 1, $900 on Sep 15 and Oct 5, $150 escrow.
    const lines: LoanLine[] = [
      start("2026-09-01", -10_000_000n),
      { date: "2026-09-15", amount: 90_000n, kind: "payment" },
      { date: "2026-10-05", amount: 90_000n, kind: "payment" },
    ];
    const run = (t: LoanTerms[]) =>
      loanMonths({ lines, terms: t, overrides: [], through: "2026-10", exponent: 2 });
    // September keeps its terms (the API pins them before writing October's).
    const pinned = [terms("2026-09", "6", 15_000n)];
    const before = run(pinned);
    expect(before[1]?.interest.applied).toBe(49_875n);
    expect(before[1]?.endBalance).toBe(-9_949_875n);
    const after = run(
      withLoanTerms(pinned, loanTermsEntries(pinned, "2026-10", { interestRate: keep("7") })),
    );
    expect(after[0]).toEqual(before[0]);
    // $99,750 × 7% ÷ 12 = $581.875 → $581.88: the charges grow by $83.13.
    expect(after[1]?.interest.applied).toBe(58_188n);
    expect(loanCharges(after) - loanCharges(before)).toBe(8_313n);
  });
});

describe("loanMonths", () => {
  // $100,000 at 5.125% with $150 escrow, started July 1.
  const mortgage = [terms("2026-10", "5.125", 15_000n)];

  it("charges escrow, then interest, then principal, only in months with payments", () => {
    const months = loanMonths({
      lines: [
        start("2026-07-01", -10_000_000n),
        pay("2026-08-05", 90_000n),
        pay("2026-09-05", 90_000n),
        pay("2026-09-20", 50_000n),
      ],
      terms: mortgage,
      overrides: [],
      through: "2026-10",
      exponent: 2,
    });
    expect(months.map((m) => m.month)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
    const [jul, aug, sep, oct] = months;
    expect(jul?.interest.applied).toBe(0n); // no payment, no charges
    expect(jul?.escrow.applied).toBe(0n);
    expect(aug?.interest).toEqual({ total: 42_708n, applied: 42_708n, status: "estimated" });
    expect(aug?.escrow).toEqual({ total: 15_000n, applied: 15_000n, status: "estimated" });
    expect(aug?.endBalance).toBe(-9_967_708n);
    // Two payments share one month's charges.
    expect(sep?.interest.applied).toBe(42_570n);
    expect(sep?.endBalance).toBe(-9_885_278n);
    expect(oct?.payments).toBe(0n);
    expect(oct?.endBalance).toBe(-9_885_278n);
  });

  it("caps the charges at the month's payments without capitalizing the rest", () => {
    const [jul] = loanMonths({
      lines: [start("2026-07-01", -10_000_000n), pay("2026-07-10", 50_000n)],
      terms: mortgage,
      overrides: [],
      through: "2026-07",
      exponent: 2,
    });
    // Escrow −$150, interest −$350 of $427.08 ($77.08 still due).
    expect(jul?.escrow.applied).toBe(15_000n);
    expect(jul?.interest).toEqual({ total: 42_708n, applied: 35_000n, status: "estimated" });
    expect(jul?.endBalance).toBe(-10_000_000n);

    const [small] = loanMonths({
      lines: [start("2026-07-01", -10_000_000n), pay("2026-07-10", 10_000n)],
      terms: mortgage,
      overrides: [],
      through: "2026-07",
      exponent: 2,
    });
    // Escrow −$100 of $150.00 ($50.00 still due), no interest.
    expect(small?.escrow).toEqual({ total: 15_000n, applied: 10_000n, status: "estimated" });
    expect(small?.interest.applied).toBe(0n);
  });

  it("raises the cap with a later payment in the same month", () => {
    const lines = [start("2026-08-01", -1_000_100n), pay("2026-09-05", 2_000n)];
    const terms6 = [terms("2026-10", "6")];
    const once = loanMonths({
      lines,
      terms: terms6,
      overrides: [],
      through: "2026-10",
      exponent: 2,
    });
    expect(once[1]?.interest.applied).toBe(2_000n);
    expect(once[1]?.endBalance).toBe(-1_000_100n);
    const twice = loanMonths({
      lines: [...lines, pay("2026-09-20", 10_000n)],
      terms: terms6,
      overrides: [],
      through: "2026-10",
      exponent: 2,
    });
    expect(twice[1]?.interest.applied).toBe(5_001n);
    expect(twice[1]?.endBalance).toBe(-993_101n);
  });

  it("leaves the month's own activity out of the interest base", () => {
    const months = loanMonths({
      lines: [
        start("2026-07-01", -10_000_000n),
        other("2026-10-01", 10_000n), // a $100 credit on the 1st
        pay("2026-10-05", 90_000n),
      ],
      terms: [terms("2026-07", "5.125")],
      overrides: [],
      through: "2026-10",
      exponent: 2,
    });
    // Interest on $100,000.00, not $99,900.00.
    expect(months.at(-1)?.interest.total).toBe(42_708n);
  });

  it("applies overrides in full, payments or not", () => {
    const months = loanMonths({
      lines: [start("2026-07-01", -10_000_000n), pay("2026-08-05", 90_000n)],
      terms: mortgage,
      overrides: [
        { month: "2026-08", kind: "interest", amount: 40_000n, status: "edited" },
        { month: "2026-09", kind: "interest", amount: 1_234n, status: "edited" },
        { month: "2026-08", kind: "escrow", amount: 0n, status: "reconciled" },
      ],
      through: "2026-09",
      exponent: 2,
    });
    expect(months[1]?.interest).toEqual({ total: 40_000n, applied: 40_000n, status: "edited" });
    expect(months[1]?.escrow).toEqual({ total: 0n, applied: 0n, status: "reconciled" });
    expect(months[1]?.endBalance).toBe(-10_000_000n - 40_000n + 90_000n);
    // September has no payment but its recorded interest still counts.
    expect(months[2]?.interest.applied).toBe(1_234n);
    expect(loanCharges(months)).toBe(41_234n);
  });

  it("uses each month's terms", () => {
    const months = loanMonths({
      lines: [
        start("2026-07-01", -1_000_000n),
        pay("2026-08-05", 100_000n),
        pay("2026-09-05", 100_000n),
      ],
      terms: [terms("2026-07", "6"), terms("2026-09", "12")],
      overrides: [],
      through: "2026-09",
      exponent: 2,
    });
    expect(months[1]?.interest.applied).toBe(5_000n); // $10,000 at 6%
    // September at 12% on what August left: 10,000 + 50 − 1,000 = $9,050.
    expect(months[2]?.interest.applied).toBe(9_050n);
  });

  it("is empty without transactions", () =>
    expect(
      loanMonths({ lines: [], terms: [], overrides: [], through: "2026-10", exponent: 2 }),
    ).toEqual([]));
});
