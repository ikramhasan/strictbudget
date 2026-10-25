import { formatAmount, money } from "@strictbudget/engine";
import { describe, expect, it } from "vitest";
import {
  chargeNote,
  chargeShown,
  datesLabel,
  formatRate,
  joinAnd,
  type LoanChargeData,
  type LoanMonthData,
  otherKind,
  paymentStatus,
  shortMonth,
} from "./loans";

const usd = (minor: bigint) =>
  formatAmount(money(minor, "USD"), {
    numberFormat: "comma_dot",
    currencySymbolPosition: "before",
    dateFormat: "MM/DD/YYYY",
  });
const charge = (patch: Partial<LoanChargeData>): LoanChargeData => ({
  total: "0",
  applied: "0",
  status: "estimated",
  editedAt: null,
  ...patch,
});
const month = (patch: Partial<LoanMonthData>): LoanMonthData => ({
  month: "2026-07",
  startBalance: "0",
  endBalance: "0",
  payments: "0",
  interest: charge({}),
  escrow: charge({}),
  transactions: [],
  ...patch,
});

describe("loan page wording", () => {
  it("notes estimated, partly covered, edited and reconciled charges", () => {
    expect(chargeNote("interest", charge({ total: "42708", applied: "42708" }), usd)).toBe(
      "Estimated",
    );
    expect(chargeNote("interest", charge({ total: "42708", applied: "35000" }), usd)).toBe(
      "Estimated, $77.08 still due ($427.08 total this month)",
    );
    expect(chargeNote("escrow", charge({ total: "15000", applied: "10000" }), usd)).toBe(
      "Set aside by your lender, $50.00 still due ($150.00 total this month)",
    );
    expect(
      chargeNote("escrow", charge({ status: "edited", editedAt: "2026-10-13T16:00:00.000Z" }), usd),
    ).toBe("Edited on October 13");
    expect(chargeNote("interest", charge({ status: "reconciled" }), usd)).toBe("Reconciled");
  });

  it("hides a charge that nothing applied unless it was set", () => {
    expect(chargeShown(charge({ total: "42708" }))).toBe(false);
    expect(chargeShown(charge({ total: "42708", applied: "1" }))).toBe(true);
    expect(chargeShown(charge({ status: "edited" }))).toBe(true);
  });

  it("marks payments as none, partly covered or covered", () => {
    expect(paymentStatus(month({}))).toBe("none");
    expect(
      paymentStatus(
        month({ payments: "50000", interest: charge({ total: "42708", applied: "35000" }) }),
      ),
    ).toBe("partial");
    expect(
      paymentStatus(
        month({ payments: "90000", interest: charge({ total: "42708", applied: "42708" }) }),
      ),
    ).toBe("covered");
  });

  it("joins dates and names", () => {
    expect(joinAnd(["F Card", "L7 Chk"])).toBe("F Card and L7 Chk");
    expect(joinAnd(["a", "b", "c"])).toBe("a, b and c");
    expect(
      datesLabel([{ date: "2026-10-13" }, { date: "2026-10-01" }, { date: "2026-10-13" }]),
    ).toBe("October 1 and October 13");
    expect(shortMonth("2026-09")).toBe("Sep 2026");
  });

  it("names other activity and formats rates", () => {
    const line = (patch: Record<string, unknown>) =>
      ({
        id: "t",
        date: "2026-10-01",
        amount: "100",
        memo: "",
        kind: "other",
        payeeKind: null,
        fromAccountId: null,
        otherSideId: null,
        ...patch,
      }) as LoanMonthData["transactions"][number];
    expect(otherKind(line({ kind: "starting_balance" }))).toBe("initial");
    expect(otherKind(line({ payeeKind: "reconciliation_balance_adjustment" }))).toBe("adjustment");
    expect(otherKind(line({}))).toBe("credit");
    expect(otherKind(line({ amount: "-500" }))).toBe("charge");
    expect(formatRate("6.000")).toBe("6");
    expect(formatRate("5.125")).toBe("5.125");
    expect(formatRate("12.500")).toBe("12.5");
  });
});
