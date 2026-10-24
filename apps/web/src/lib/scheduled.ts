import type { components } from "@strictbudget/api-client";
import { addMonths, format, parseISO } from "date-fns";
import type { MoneySettings } from "./money-input";
import { toMoneyInput } from "./money-input";
import {
  createBody,
  type Draft,
  draftFrom,
  emptyLine,
  scheduledQueryPrefix,
  type Transaction,
} from "./transactions";

export type ScheduledTransaction = components["schemas"]["ScheduledTransaction"];
type CreateBody = components["schemas"]["CreateScheduledTransaction"];
type UpdateBody = components["schemas"]["UpdateScheduledTransaction"];

export { scheduledQueryPrefix };

type Result<T> = { ok: true; body: T } | { ok: false; error: string };

/** A draft is saved as a schedule when it repeats or its date is still ahead. */
export function isScheduled(draft: Pick<Draft, "date" | "frequency">, today: string) {
  return (draft.frequency ?? "never") !== "never" || draft.date > today;
}

/**
 * The selected scheduled splits, for bulk Categorize's un-split warning (counted with the
 * transactions). A split's other sides (`splitTransfer` rows) aren't the split:
 * bulk actions skip them.
 */
export function scheduledSplits(rows: readonly ScheduledTransaction[]) {
  const splits = rows.filter((row) => row.kind === "schedule" && row.subtransactions.length > 0);
  return {
    splits: splits.length,
    splitsWithTransfers: splits.filter((row) =>
      row.subtransactions.some((line) => line.transferAccountId !== null),
    ).length,
  };
}

/** The editor's fields for a scheduled row, in that row's account (a transfer's other side too). */
export function draftFromScheduled(row: ScheduledTransaction, settings: MoneySettings): Draft {
  const amount = BigInt(row.amount);
  const money = (value: bigint) => toMoneyInput(value, settings);
  return {
    accountId: row.accountId,
    date: row.dateNext,
    frequency: row.frequency,
    payeeName: row.payeeName ?? "",
    transferAccountId: row.transferAccountId,
    categoryId: row.categoryId,
    memo: row.memo,
    outflow: amount < 0n ? money(-amount) : "",
    inflow: amount > 0n ? money(amount) : "",
    cleared: "uncleared",
    flag: row.flag,
    lines:
      row.subtransactions.length > 0
        ? row.subtransactions.map((l) => {
            const lineAmount = BigInt(l.amount);
            return {
              key: l.id,
              id: l.id,
              payeeName: l.payeeName ?? "",
              transferAccountId: l.transferAccountId,
              categoryId: l.categoryId,
              memo: l.memo,
              outflow: lineAmount < 0n ? money(-lineAmount) : "",
              inflow: lineAmount > 0n ? money(lineAmount) : "",
            };
          })
        : null,
  };
}

/** A new schedule from the editor (the same checks as a new transaction). */
export function scheduleCreateBody(
  draft: Draft,
  settings: MoneySettings,
  today: string,
): Result<CreateBody> {
  const result = createBody(draft, settings);
  if (!result.ok) return result;
  // Scheduled transfers stay in one currency, without a fee.
  if (result.body.fee) return { ok: false, error: "A scheduled transfer can't have a fee." };
  const { cleared: _, subtransactions, transferAmount: _t, fee: _f, ...body } = result.body;
  return {
    ok: true,
    body: {
      ...body,
      frequency: draft.frequency ?? "never",
      today,
      ...(subtransactions
        ? { subtransactions: subtransactions.map(({ id: _id, ...line }) => line) }
        : {}),
    },
  };
}

/**
 * What to send after editing a scheduled row. The date and frequency only go when changed (a new
 * date restarts the repeats there). On the other side of a transfer, amounts are this account's,
 * so they're flipped back; choosing another payee there moves the schedule to this account, as
 * changing a transfer's payee does on transactions.
 */
export function scheduleUpdateBody(
  row: ScheduledTransaction,
  input: Draft,
  settings: MoneySettings,
  today: string,
  /** Whether this row's side of a transfer takes the category. */
  categorized: boolean,
): Result<UpdateBody> {
  const result = scheduleCreateBody(input, settings, today);
  if (!result.ok) return result;
  const { accountId, date, frequency, amount, payeeName, transferAccountId, ...rest } = result.body;
  const body: UpdateBody = { today };
  if (date !== row.dateNext) body.date = date;
  if (frequency !== row.frequency) body.frequency = frequency;
  body.memo = rest.memo;
  body.flag = rest.flag;
  const mirror = row.kind === "transfer";
  const keptTransfer =
    mirror && transferAccountId === row.transferAccountId && accountId === row.accountId;
  if (mirror && keptTransfer) {
    body.amount = (-BigInt(amount)).toString();
    if (categorized) body.categoryId = rest.categoryId;
    return { ok: true, body };
  }
  if (mirror || accountId !== row.accountId) body.accountId = accountId;
  body.amount = amount;
  if (transferAccountId) body.transferAccountId = transferAccountId;
  else body.payeeName = payeeName ?? null;
  if (rest.subtransactions) body.subtransactions = rest.subtransactions;
  else body.categoryId = rest.categoryId;
  return { ok: true, body };
}

/**
 * A body that recreates (or puts back) a schedule exactly, first date included, from its own
 * row: what undo sends.
 */
export function scheduleRestoreBody(row: ScheduledTransaction): CreateBody {
  return {
    accountId: row.accountId,
    frequency: row.frequency,
    date: row.dateNext,
    dateFirst: row.dateFirst,
    amount: row.amount,
    ...(row.transferAccountId
      ? { transferAccountId: row.transferAccountId, payeeName: null }
      : { payeeName: row.payeeName }),
    memo: row.memo,
    flag: row.flag,
    ...(row.subtransactions.length > 0
      ? {
          subtransactions: row.subtransactions.map((l) => ({
            amount: l.amount,
            ...(l.transferAccountId
              ? { transferAccountId: l.transferAccountId, payeeName: null }
              : { payeeName: l.payeeName }),
            categoryId: l.categoryId,
            memo: l.memo,
          })),
          categoryId: null,
        }
      : { categoryId: row.categoryId }),
    // An undo puts it back even if its accounts were closed since.
    restore: true,
  };
}

/** A plain transaction rescheduled to `draft` (its date moved into the future). */
export function rescheduleBody(
  t: Transaction,
  draft: Draft,
  settings: MoneySettings,
  today: string,
): Result<CreateBody> {
  const result = scheduleCreateBody(draft, settings, today);
  if (!result.ok) return result;
  return { ok: true, body: { ...result.body, fromTransactionId: t.id } };
}

/**
 * Make Repeating: a new scheduled row prefilled from `t`, a month after its date (the
 * last day of a shorter month), repeating monthly. The transaction itself stays as it is.
 */
export function makeRepeatingDraft(t: Transaction, settings: MoneySettings): Draft {
  const draft = draftFrom(t, settings);
  return {
    ...draft,
    date: format(addMonths(parseISO(t.date), 1), "yyyy-MM-dd"),
    frequency: "monthly",
    cleared: "uncleared",
    lines: draft.lines?.map(({ id: _, key: __, ...line }) => emptyLine(line)) ?? null,
  };
}
