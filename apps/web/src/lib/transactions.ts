import type { components } from "@strictbudget/api-client";
import {
  type AccountType,
  accountFamily,
  distributeSplit,
  impliedRate,
  isCurrencyCode,
  isDebtAccount,
  money,
  roundRate,
  type ScheduleFrequency,
} from "@strictbudget/engine";
import { $api } from "./api";
import type { CategoryList } from "./categories";
import type { FlagColor } from "./flags";
import { inCurrency, type MoneySettings, parseMoneyInput, toMoneyInput } from "./money-input";

export type Transaction = components["schemas"]["Transaction"];
export type SubTransaction = components["schemas"]["SubTransaction"];
export type Payee = components["schemas"]["Payee"];

/**
 * The payee's recent categories for the category list's "Suggested" (none for a payee set to "Do
 * not auto-categorize", nor for transfers or a row without a known payee). A split line goes by its
 * own payee only, never its transaction's.
 */
export function payeeSuggestionIds(
  payees: readonly Payee[],
  row: { payeeName: string | null; transferAccountId: string | null },
): readonly string[] | undefined {
  if (row.transferAccountId) return undefined;
  const name = row.payeeName?.trim().toLowerCase();
  const payee = name ? payees.find((p) => p.name.toLowerCase() === name) : undefined;
  return payee && payee.categorization !== "never" ? payee.recentCategoryIds : undefined;
}

type CreateBody = components["schemas"]["CreateTransaction"];
type UpdateBody = components["schemas"]["UpdateTransaction"];
type LineBody = components["schemas"]["SubTransactionInput"];

export const REGISTER_PAGE_SIZE = 100;

/** Prefix of every register query (any budget, account, filter or sort). */
export const transactionsQueryPrefix = ["register"] as const;

export const payeesQueryOptions = (budgetId: string) =>
  $api.queryOptions("get", "/v1/budgets/{budgetId}/payees", {
    params: { path: { budgetId } },
  });

export interface CategoryOption {
  id: string;
  name: string;
  group: string;
}

/**
 * The categories a transaction can be filed under: "Ready to Assign" for income first, then the
 * visible groups and categories. Payment categories only get money by assigning, so they're left
 * out.
 */
export function categoryOptions(list: CategoryList): CategoryOption[] {
  return [
    { id: list.readyToAssignCategoryId, name: "Ready to Assign", group: "Inflow" },
    ...list.groups
      .filter((g) => !g.kind && !g.hidden)
      .flatMap((g) =>
        g.categories
          .filter((c) => !c.hidden)
          .map((c) => ({ id: c.id, name: c.name, group: g.name })),
      ),
  ];
}

/** What the register shows for a category: income reads "Inflow: Ready to Assign". */
export function categoryLabel(option: CategoryOption) {
  return option.group === "Inflow" ? `Inflow: ${option.name}` : option.name;
}

/** How the register names an account's transfer payee (the API stores the same). */
export function transferLabel(accountName: string) {
  return `Transfer : ${accountName}`;
}

/** Which way money moves for the account being edited; null before an amount is typed. */
export type TransferDirection = "in" | "out" | null;

interface TransferAccount {
  name: string;
  type: AccountType;
}

/**
 * Whether money moving from `from` to `to` is a payment: into a loan, or into a credit account from
 * a cash or asset account. Money between two cards, into a cash account, or from a liability is a
 * transfer.
 */
function isPayment(from: AccountType, to: AccountType) {
  const family = accountFamily(to);
  return family === "loan" || (family === "credit" && !isDebtAccount(from));
}

/**
 * How the payee list names a transfer to or from `other` while editing in an `own` account:
 * "Payment from Brac" / "Transfer from Card B" for an inflow, "Payment to Card A" / "Transfer to
 * Savings" for an outflow, "To/From X" before an amount is typed. A loan always reads "Payment: X".
 */
export function transferChoiceLabel(
  own: AccountType,
  other: TransferAccount,
  direction: TransferDirection,
) {
  if (accountFamily(other.type) === "loan") return `Payment: ${other.name}`;
  if (direction === "in") {
    return `${isPayment(other.type, own) ? "Payment" : "Transfer"} from ${other.name}`;
  }
  if (direction === "out") {
    return `${isPayment(own, other.type) ? "Payment" : "Transfer"} to ${other.name}`;
  }
  return `To/From ${other.name}`;
}

export function directionOf(amount: bigint): TransferDirection {
  return amount > 0n ? "in" : amount < 0n ? "out" : null;
}

/**
 * How a register row names its transfer payee: "Payment: X" on both sides of a payment
 * (`isPayment`), "Transfer: X" otherwise. The stored payee stays "Transfer : X".
 */
export function transferRowLabel(own: AccountType, other: TransferAccount, amount: bigint) {
  const payment = amount > 0n ? isPayment(other.type, own) : isPayment(own, other.type);
  return `${payment ? "Payment" : "Transfer"}: ${other.name}`;
}

/**
 * A transfer between a credit and a cash account shows the card's payment category on both sides,
 * whichever way the money goes (a payment or a cash advance). Returns the card, or null.
 */
export function paymentCategoryCard<A extends { type: AccountType }>(own: A, other: A): A | null {
  const pair = [own, other];
  const card = pair.find((a) => accountFamily(a.type) === "credit");
  const cash = pair.find((a) => accountFamily(a.type) === "cash");
  return card && cash ? card : null;
}

/** The fields of the inline editor, as typed. */
export interface Draft {
  accountId: string;
  date: string;
  /** The date picker's "Repeat:"; new and scheduled transactions only. */
  frequency?: ScheduleFrequency;
  payeeName: string;
  /** Set when the payee is another account's "Transfer : <account>". */
  transferAccountId: string | null;
  categoryId: string | null;
  memo: string;
  outflow: string;
  inflow: string;
  cleared: "uncleared" | "cleared";
  flag: FlagColor | null;
  /** A split's lines (the category is then unused); null when it isn't split. */
  lines: LineDraft[] | null;
  /**
   * In an account in another currency than the budget's: a typed rate ("1 account currency =
   * rate budget currency"); empty for the date's rate.
   */
  fxRate?: string;
  /**
   * A transfer to an account in another currency: what that account receives (or sends), in its
   * currency, unsigned; empty for the date's rate.
   */
  transferAmount?: string;
  /** A new transfer's fee, in the sending account's currency; empty for none. */
  fee?: string;
  feeCategoryId?: string | null;
}

export interface LineDraft {
  /** Stable React key; new lines get a local one. */
  key: string;
  /** The saved line this edits; new lines leave it out. */
  id?: string;
  payeeName: string;
  transferAccountId: string | null;
  categoryId: string | null;
  memo: string;
  outflow: string;
  inflow: string;
}

let nextLineKey = 0;

export function emptyLine(patch: Partial<LineDraft> = {}): LineDraft {
  nextLineKey += 1;
  return {
    key: `new-${nextLineKey}`,
    payeeName: "",
    transferAccountId: null,
    categoryId: null,
    memo: "",
    outflow: "",
    inflow: "",
    ...patch,
  };
}

/** "Split": the current category moves to the first of two lines. */
export function startSplit(draft: Draft): Draft {
  return {
    ...draft,
    categoryId: null,
    lines: [emptyLine({ categoryId: draft.categoryId }), emptyLine()],
  };
}

/**
 * How a new transaction starts in an account of `type`: cleared in a cash account, otherwise
 * uncleared (the editor re-applies it when the account changes).
 */
export function clearedFor(type: AccountType | undefined): Draft["cleared"] {
  return type === "cash" ? "cleared" : "uncleared";
}

export function emptyDraft(accountId: string, date: string, accountType?: AccountType): Draft {
  return {
    accountId,
    date,
    payeeName: "",
    transferAccountId: null,
    categoryId: null,
    memo: "",
    outflow: "",
    inflow: "",
    cleared: clearedFor(accountType),
    flag: null,
    lines: null,
  };
}

export function draftFrom(t: Transaction, settings: MoneySettings): Draft {
  const amount = BigInt(t.amount);
  return {
    accountId: t.accountId,
    date: t.date,
    payeeName: t.payeeName ?? "",
    transferAccountId: t.transferAccountId,
    categoryId: t.categoryId,
    memo: t.memo,
    outflow: amount < 0n ? toMoneyInput(-amount, settings) : "",
    inflow: amount > 0n ? toMoneyInput(amount, settings) : "",
    cleared: t.cleared === "uncleared" ? "uncleared" : "cleared",
    flag: t.flag,
    lines:
      t.subtransactions.length > 0 ? t.subtransactions.map((l) => lineFrom(l, settings)) : null,
    fxRate: t.fxRateManual && t.fxRate ? t.fxRate : "",
    transferAmount: crossSide(t)
      ? toMoneyInput(
          abs(BigInt(t.transferSide.amount)),
          inCurrency(settings, t.transferSide.currency),
        )
      : "",
  };
}

const abs = (n: bigint) => (n < 0n ? -n : n);

/** Whether `t` is a transfer whose other side is in another currency (with its own amount). */
export function crossSide<T extends Pick<Transaction, "currency" | "transferSide">>(
  t: T,
): t is T & { transferSide: NonNullable<Transaction["transferSide"]> } {
  return t.transferSide !== null && t.transferSide.currency !== t.currency;
}

/**
 * "1 EUR = 1.17647 USD": the rate a cross-currency transfer's two amounts imply, 1 of the other
 * account's currency in this one's; null until both are typed.
 */
export function transferRateLabel(
  own: bigint,
  ownCurrency: string,
  other: bigint,
  otherCurrency: string,
) {
  if (!isCurrencyCode(ownCurrency) || !isCurrencyCode(otherCurrency)) return null;
  const rate = impliedRate(money(abs(other), otherCurrency), money(abs(own), ownCurrency));
  return rate ? `1 ${otherCurrency} = ${roundRate(rate)} ${ownCurrency}` : null;
}

function lineFrom(line: SubTransaction, settings: MoneySettings): LineDraft {
  const amount = BigInt(line.amount);
  return {
    key: line.id,
    id: line.id,
    payeeName: line.payeeName ?? "",
    transferAccountId: line.transferAccountId,
    categoryId: line.categoryId,
    memo: line.memo,
    outflow: amount < 0n ? toMoneyInput(-amount, settings) : "",
    inflow: amount > 0n ? toMoneyInput(amount, settings) : "",
  };
}

/** Inflow minus outflow, in minor units; empty fields count as zero. */
export function draftAmount(
  draft: Pick<Draft, "outflow" | "inflow">,
  settings: MoneySettings,
): bigint | string {
  const parse = (text: string) => (text.trim() === "" ? 0n : parseMoneyInput(text, settings));
  const outflow = parse(draft.outflow);
  if (typeof outflow === "string") return outflow;
  const inflow = parse(draft.inflow);
  if (typeof inflow === "string") return inflow;
  return inflow - outflow;
}

/**
 * A split's total and what's left to put on its lines. With the transaction's own amount left
 * empty, the lines make up the total.
 */
export function splitRemaining(
  draft: Draft,
  settings: MoneySettings,
): { error: string } | { total: bigint; remaining: bigint } {
  let lines = 0n;
  for (const line of draft.lines ?? []) {
    const amount = draftAmount(line, settings);
    if (typeof amount === "string") return { error: amount };
    lines += amount;
  }
  const blank = draft.outflow.trim() === "" && draft.inflow.trim() === "";
  const total = blank ? lines : draftAmount(draft, settings);
  if (typeof total === "string") return { error: total };
  // Positive while lines are still missing, negative when they go past the total.
  const remaining = total < 0n ? lines - total : total - lines;
  return { total, remaining };
}

/** A money input's text for a signed amount: an outflow or an inflow, empty at zero. */
function sides(amount: bigint, settings: MoneySettings): Pick<LineDraft, "outflow" | "inflow"> {
  return {
    outflow: amount < 0n ? toMoneyInput(-amount, settings) : "",
    inflow: amount > 0n ? toMoneyInput(amount, settings) : "",
  };
}

/**
 * A split whose lines don't add up to its total, for the "Something Doesn't Add Up" prompt: the
 * total, what the lines add up to and what's unassigned (total minus lines), all signed. Null when
 * it adds up or an amount can't be read.
 */
export function splitMismatch(draft: Draft, settings: MoneySettings) {
  if (!draft.lines) return null;
  const amounts = draft.lines.map((line) => draftAmount(line, settings));
  const total = draftAmount(draft, settings);
  const blank = draft.outflow.trim() === "" && draft.inflow.trim() === "";
  if (blank || typeof total === "string" || amounts.some((a) => typeof a === "string")) {
    return null;
  }
  const lines = (amounts as bigint[]).reduce((sum, a) => sum + a, 0n);
  if (lines === total) return null;
  const unassigned = total - lines;
  const added = distributeSplit(unassigned, amounts as bigint[]);
  return {
    total,
    lines,
    unassigned,
    /** The lines after Auto-Distribute; null when they cancel out and have no proportion. */
    distributed: added
      ? draft.lines.map((line, i) => {
          const amount = (amounts[i] as bigint) + (added[i] ?? 0n);
          // A $0 line is skipped and stays as it was (empty).
          return added[i] === 0n ? line : { ...line, ...sides(amount, settings) };
        })
      : null,
  };
}

/** "Update Total": the transaction takes what its lines add up to. */
export function withSplitTotal(draft: Draft, settings: MoneySettings): Draft {
  const mismatch = splitMismatch(draft, settings);
  return mismatch ? { ...draft, ...sides(mismatch.lines, settings) } : draft;
}

/** How the editor and errors describe what's left of a split. */
export function remainingLabel(remaining: bigint, settings: MoneySettings) {
  if (remaining === 0n) return "Fully split";
  const amount = toMoneyInput(remaining < 0n ? -remaining : remaining, settings);
  return remaining > 0n ? `${amount} left to split` : `${amount} too much on the lines`;
}

/**
 * A split cut down to one line (or none) isn't a split any more: the transaction takes the
 * remaining line's category (or transfer) and, if it had none, its amount.
 */
function collapseSplit(draft: Draft): Draft {
  if (!draft.lines || draft.lines.length >= 2) return draft;
  const [line] = draft.lines;
  const blank = draft.outflow.trim() === "" && draft.inflow.trim() === "";
  return {
    ...draft,
    lines: null,
    categoryId: line?.categoryId ?? null,
    ...(line?.transferAccountId
      ? { transferAccountId: line.transferAccountId, payeeName: line.payeeName }
      : {}),
    ...(line && blank ? { outflow: line.outflow, inflow: line.inflow } : {}),
  };
}

type Result<T> = { ok: true; body: T } | { ok: false; error: string };

/** The amount to save, and the split's lines if it has them. */
function amountAndLines(
  draft: Draft,
  settings: MoneySettings,
): Result<{ amount: bigint; lines?: LineBody[] }> {
  if (!draft.lines) {
    const amount = draftAmount(draft, settings);
    return typeof amount === "string"
      ? { ok: false, error: amount }
      : { ok: true, body: { amount } };
  }
  const split = splitRemaining(draft, settings);
  if ("error" in split) return { ok: false, error: split.error };
  if (split.remaining !== 0n) {
    return {
      ok: false,
      error: `The lines must add up to the total: ${remainingLabel(split.remaining, settings)}.`,
    };
  }
  const lines = draft.lines.map((line): LineBody => {
    const amount = draftAmount(line, settings) as bigint;
    return {
      ...(line.id ? { id: line.id } : {}),
      amount: amount.toString(),
      ...(line.transferAccountId
        ? { payeeName: null, transferAccountId: line.transferAccountId }
        : { payeeName: line.payeeName.trim() || null }),
      categoryId: line.categoryId,
      memo: line.memo,
    };
  });
  return { ok: true, body: { amount: split.total, lines } };
}

const RATE = /^\d+(\.\d{1,12})?$/;

/** A typed FX rate: null when left empty (the date's rate), or an error message. */
function typedRate(draft: Draft): Result<string | null> {
  const rate = draft.fxRate?.trim() ?? "";
  if (rate === "") return { ok: true, body: null };
  if (!RATE.test(rate) || !/[1-9]/.test(rate)) {
    return { ok: false, error: "Enter the rate as a number above zero, like 1.0842." };
  }
  return { ok: true, body: rate };
}

/**
 * The other side's amount to send for a transfer between currencies (`other`: the money settings
 * in its account's currency, given only then): the opposite way to `amount`; null when empty.
 */
function typedTransferAmount(
  draft: Draft,
  amount: bigint,
  other: MoneySettings | undefined,
): Result<string | null> {
  const text = draft.transferAmount?.trim() ?? "";
  if (!other || !draft.transferAccountId || draft.lines || text === "") {
    return { ok: true, body: null };
  }
  const parsed = parseMoneyInput(text, other);
  if (typeof parsed === "string") return { ok: false, error: parsed };
  return { ok: true, body: (amount > 0n ? -abs(parsed) : abs(parsed)).toString() };
}

/** A new transfer's fee, in the sending account's currency (the other one's for an inflow). */
function typedFee(
  draft: Draft,
  amount: bigint,
  settings: MoneySettings,
  other: MoneySettings | undefined,
): Result<CreateBody["fee"] | null> {
  const text = draft.fee?.trim() ?? "";
  if (!draft.transferAccountId || draft.lines || text === "") return { ok: true, body: null };
  const parsed = parseMoneyInput(text, amount > 0n && other ? other : settings);
  if (typeof parsed === "string") return { ok: false, error: parsed };
  if (parsed <= 0n) return { ok: false, error: "Enter the fee as an amount above zero." };
  return {
    ok: true,
    body: { amount: parsed.toString(), categoryId: draft.feeCategoryId ?? null },
  };
}

/**
 * `other`: for a transfer to an account in another currency, the money settings in that
 * account's currency (its amount and, for an inflow, the fee are in it).
 */
export function createBody(
  input: Draft,
  settings: MoneySettings,
  other?: MoneySettings,
): Result<CreateBody> {
  const draft = collapseSplit(input);
  const result = amountAndLines(draft, settings);
  if (!result.ok) return result;
  const rate = typedRate(draft);
  if (!rate.ok) return rate;
  const { amount, lines } = result.body;
  const transferAmount = typedTransferAmount(draft, amount, other);
  if (!transferAmount.ok) return transferAmount;
  const fee = typedFee(draft, amount, settings, other);
  if (!fee.ok) return fee;
  return {
    ok: true,
    body: {
      accountId: draft.accountId,
      date: draft.date,
      amount: amount.toString(),
      ...(draft.transferAccountId
        ? { payeeName: null, transferAccountId: draft.transferAccountId }
        : { payeeName: draft.payeeName.trim() || null }),
      categoryId: lines ? null : draft.categoryId,
      memo: draft.memo,
      cleared: draft.cleared,
      flag: draft.flag,
      ...(lines ? { subtransactions: lines } : {}),
      ...(rate.body ? { fxRate: rate.body } : {}),
      ...(transferAmount.body ? { transferAmount: transferAmount.body } : {}),
      ...(fee.body ? { fee: fee.body } : {}),
    },
  };
}

/**
 * Only what changed, so untouched fields keep server-side meaning (e.g. a credit card's starting
 * debt stays uncategorized).
 */
export function updateBody(
  original: Transaction,
  input: Draft,
  settings: MoneySettings,
  other?: MoneySettings,
): Result<UpdateBody> {
  const draft = collapseSplit(input);
  const result = amountAndLines(draft, settings);
  if (!result.ok) return result;
  const { amount, lines } = result.body;
  const rate = typedRate(draft);
  if (!rate.ok) return rate;
  const transferAmount = typedTransferAmount(draft, amount, other);
  if (!transferAmount.ok) return transferAmount;
  const before = draftFrom(original, settings);
  const body: UpdateBody = {};
  // Emptied, it goes back to the date's rate.
  if ((draft.fxRate?.trim() ?? "") !== (before.fxRate ?? "")) body.fxRate = rate.body;
  // Left as it was, the other side keeps its amount; emptied, the date's rate converts again.
  if (other && (draft.transferAmount?.trim() ?? "") !== (before.transferAmount ?? "")) {
    body.transferAmount = transferAmount.body;
  }
  if (draft.accountId !== before.accountId) body.accountId = draft.accountId;
  if (draft.date !== before.date) body.date = draft.date;
  if (amount.toString() !== original.amount) body.amount = amount.toString();
  if (draft.transferAccountId) {
    if (draft.transferAccountId !== before.transferAccountId) {
      body.transferAccountId = draft.transferAccountId;
    }
  } else if (before.transferAccountId || draft.payeeName.trim() !== before.payeeName) {
    body.payeeName = draft.payeeName.trim() || null;
  }
  if (lines) {
    // The API replaces a split's lines as a whole (matched by id).
    const same =
      before.lines !== null &&
      JSON.stringify(lines) === JSON.stringify(amountAndLinesOf(before, settings));
    if (!same) body.subtransactions = lines;
  } else if (before.lines || draft.categoryId !== before.categoryId) {
    // Giving a split a category un-splits it.
    body.categoryId = draft.categoryId;
  }
  if (draft.memo !== before.memo) body.memo = draft.memo;
  if (draft.cleared !== before.cleared) body.cleared = draft.cleared;
  if (draft.flag !== before.flag) body.flag = draft.flag;
  return { ok: true, body };
}

function amountAndLinesOf(draft: Draft, settings: MoneySettings) {
  const result = amountAndLines(draft, settings);
  return result.ok ? result.body.lines : undefined;
}

/**
 * The accounts an existing transaction (or schedule) can be moved to: open ones in its currency,
 * since a move into another currency is refused (`CROSS_CURRENCY_MOVE`), plus the one it's in.
 */
export function movableAccounts<A extends { id: string; closed: boolean; currency: string }>(
  accounts: readonly A[],
  t: { accountId: string; currency: string },
): A[] {
  return accounts.filter((a) => a.id === t.accountId || (!a.closed && a.currency === t.currency));
}

/** The cells editable in place on an existing transaction. */
export type CellColumn = "account" | "date" | "payee" | "category" | "memo" | "outflow" | "inflow";

/** A cell's starting text (or id, for account and category). */
export function cellValue(t: Transaction, column: CellColumn, settings: MoneySettings) {
  const draft = draftFrom(t, settings);
  switch (column) {
    case "account":
      return t.accountId;
    case "payee":
      return draft.payeeName;
    case "category":
      return t.categoryId;
    default:
      return draft[column];
  }
}

/**
 * What to send after editing one cell; an empty body means nothing changed. Typing an outflow
 * makes it an outflow (and an inflow an inflow); emptying the amount's own side makes it zero.
 * For the payee cell, `transferAccountId` is set when a transfer was chosen.
 */
export function cellUpdate(
  t: Transaction,
  column: CellColumn,
  value: string | null,
  settings: MoneySettings,
  transferAccountId: string | null = null,
): Result<UpdateBody> {
  if (column === "payee") {
    if (transferAccountId) {
      return {
        ok: true,
        body: transferAccountId === t.transferAccountId ? {} : { transferAccountId },
      };
    }
    // A normal payee replaces a transfer even if the name reads the same.
    const name = value?.trim() || null;
    const same = name === t.payeeName && t.transferAccountId === null;
    return { ok: true, body: same ? {} : { payeeName: name } };
  }
  if (column === "outflow" || column === "inflow") {
    const text = value ?? "";
    let amount: bigint;
    if (text.trim() === "") {
      const current = BigInt(t.amount);
      const ownSide = column === "outflow" ? current < 0n : current > 0n;
      amount = ownSide ? 0n : current;
    } else {
      const parsed = parseMoneyInput(text, settings);
      if (typeof parsed === "string") return { ok: false, error: parsed };
      amount = column === "outflow" ? -parsed : parsed;
    }
    return { ok: true, body: amount.toString() === t.amount ? {} : { amount: amount.toString() } };
  }
  if (value === cellValue(t, column, settings)) return { ok: true, body: {} };
  switch (column) {
    case "account":
      return value ? { ok: true, body: { accountId: value } } : { ok: true, body: {} };
    case "date":
      return value ? { ok: true, body: { date: value } } : { ok: false, error: "Enter a date." };
    case "category":
      return { ok: true, body: { categoryId: value } };
    case "memo":
      return { ok: true, body: { memo: value ?? "" } };
  }
}
