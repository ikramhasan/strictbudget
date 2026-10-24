import type { components } from "@strictbudget/api-client";
import {
  type AccountType,
  type BudgetMonth,
  monthBounds,
  rateThousandths,
} from "@strictbudget/engine";
import { queryOptions } from "@tanstack/react-query";
import { format as formatDateFns } from "date-fns";
import { apiClient } from "./api";
import { isoToDate, todayIso } from "./dates";
import { transactionsQueryPrefix } from "./transactions";

export type LoanActivity = components["schemas"]["LoanActivity"];
export type LoanMonthData = LoanActivity["months"][number];
export type LoanChargeData = components["schemas"]["LoanCharge"];
export type LoanLineData = LoanMonthData["transactions"][number];
export type LoanUpcoming = LoanActivity["upcoming"][number];

/**
 * A loan's months up to the user's today (interest and escrow are worked out per month). Keyed
 * under the register's prefix, so any transaction change refreshes it too.
 */
export const loanQueryOptions = (budgetId: string, accountId: string, today = todayIso()) =>
  queryOptions({
    queryKey: [...transactionsQueryPrefix, budgetId, "loan", accountId, today],
    queryFn: async ({ signal }) => {
      const { data, error } = await apiClient.GET(
        "/v1/budgets/{budgetId}/accounts/{accountId}/loan",
        { params: { path: { budgetId, accountId }, query: { today } }, signal },
      );
      if (error) throw error;
      return data;
    },
  });

/** Only mortgages ask about escrow. */
export const hasEscrow = (type: AccountType) => type === "mortgage";

/** "6.000" → "6", "5.125" → "5.125". */
export function formatRate(rate: string) {
  return rate.includes(".") ? rate.replace(/\.?0+$/, "") : rate;
}

export const dayLabel = (iso: string) => formatDateFns(isoToDate(iso), "MMMM d");

export const shortMonth = (month: BudgetMonth) =>
  formatDateFns(isoToDate(monthBounds(month).start), "MMM yyyy");

export const longMonth = (month: BudgetMonth) =>
  formatDateFns(isoToDate(monthBounds(month).start), "MMMM yyyy");

export type LoanTermsCheck = components["schemas"]["LoanTermsCheck"];

/**
 * The Changes lines of Update Balance's interest rate / escrow check: "Your interest rate has been
 * changed to 7% for October and going forward." and, with "Keep … going forward" unchecked, "… for
 * October.". Only values that changed get a line.
 */
export function loanTermsChangeLines(
  check: LoanTermsCheck,
  before: { interestRate: string | null; escrowAmount: string | null },
  month: BudgetMonth,
  formatAmount: (minorUnits: bigint) => string,
): string[] {
  const name = formatDateFns(isoToDate(monthBounds(month).start), "MMMM");
  const when = (keep: boolean) => `for ${name}${keep ? " and going forward" : ""}.`;
  const lines: string[] = [];
  const rate = check.interestRate;
  if (rate && rateChanged(rate.rate, before.interestRate)) {
    const shown = rate.rate === null ? "0" : formatRate(rate.rate);
    lines.push(`Your interest rate has been changed to ${shown}% ${when(rate.keepGoingForward)}`);
  }
  const escrow = check.escrowAmount;
  if (escrow && BigInt(escrow.amount ?? 0) !== BigInt(before.escrowAmount ?? 0)) {
    const shown = formatAmount(BigInt(escrow.amount ?? 0));
    lines.push(
      `Your monthly escrow amount has been changed to ${shown} ${when(escrow.keepGoingForward)}`,
    );
  }
  return lines;
}

const rateChanged = (a: string | null, b: string | null) =>
  a === null || b === null ? a !== b : rateThousandths(a) !== rateThousandths(b);

/** "a", "a and b", "a, b and c". */
export function joinAnd(items: readonly string[]) {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The distinct dates of `lines`, oldest first, as "October 1 and October 13". */
export function datesLabel(lines: readonly { date: string }[]) {
  return joinAnd([...new Set(lines.map((l) => l.date))].sort().map(dayLabel));
}

/** Whether a charge gets a line: anything set by hand or reconciled, or an estimate that applied. */
export const chargeShown = (charge: LoanChargeData) =>
  charge.status !== "estimated" || BigInt(charge.applied) > 0n;

/**
 * The note under "Interest Charges This Month" or "Escrow Held": "Estimated" or "Set aside by your
 * lender", with ", $77.08 still due ($427.08 total this month)" when the month's payments didn't
 * cover it; "Edited on October 13"; "Reconciled".
 */
export function chargeNote(
  kind: "interest" | "escrow",
  charge: LoanChargeData,
  format: (minorUnits: bigint) => string,
) {
  if (charge.status === "reconciled") return "Reconciled";
  if (charge.status === "edited") {
    return charge.editedAt ? `Edited on ${dayLabel(charge.editedAt.slice(0, 10))}` : "Edited";
  }
  const base = kind === "interest" ? "Estimated" : "Set aside by your lender";
  const total = BigInt(charge.total);
  const due = total - BigInt(charge.applied);
  return due > 0n ? `${base}, ${format(due)} still due (${format(total)} total this month)` : base;
}

/** The month's payments: none (clock), all charges covered (check), or partly (half circle). */
export function paymentStatus(month: LoanMonthData): "none" | "partial" | "covered" {
  if (BigInt(month.payments) <= 0n) return "none";
  const short = [month.interest, month.escrow].some(
    (c) => c.status === "estimated" && BigInt(c.applied) < BigInt(c.total),
  );
  return short ? "partial" : "covered";
}

export type OtherLineKind = "initial" | "adjustment" | "credit" | "charge";

/** What a loan line that isn't a payment is (the "Other Activity" wording). */
export function otherKind(line: LoanLineData): OtherLineKind {
  if (line.kind === "starting_balance") return "initial";
  if (line.payeeKind === "manual_balance_adjustment") return "adjustment";
  if (line.payeeKind === "reconciliation_balance_adjustment") return "adjustment";
  return BigInt(line.amount) >= 0n ? "credit" : "charge";
}

export const OTHER_LABELS: Record<OtherLineKind, string> = {
  initial: "Initial Balance",
  adjustment: "Balance adjustment",
  credit: "Credit",
  charge: "Charge",
};

export const newestFirst = <T extends { date: string; id: string }>(lines: readonly T[]) =>
  [...lines].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
