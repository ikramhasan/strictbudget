/** One credit account's net activity in a category on one day (negative: spending). */
export interface CardActivity {
  accountId: string;
  /** ISO date (`YYYY-MM-DD`). */
  date: string;
  /** Net of the card's spending and returns in the category that day (minor units). */
  amount: bigint;
  /**
   * The part of the day's returns paid back above the card's zero (cash, positive). It reaches the
   * category on its date, after the card activity before it: it isn't in `cash`, and it doesn't
   * refill earlier unfunded card spending. Defaults to zero.
   */
  cash?: bigint;
  /** Breaks ties between equal purchases on one day: the smallest transaction id goes first. */
  order: string;
}

export interface FundedCardSpending {
  /** accountId → what moves into (positive) or out of (negative) the card's payment category. */
  moved: Map<string, bigint>;
  /**
   * accountId → that card's spending left unfunded when it happened (positive): its payment
   * category's "Overspent Categories". A later refill (e.g. another card's return) doesn't
   * lower it.
   */
  unfunded: Map<string, bigint>;
}

/**
 * How a category's card activity in a month moves money into each card's payment category (or, for
 * returns, back out of it), the category's Funded Spending:
 *
 * - `cash` is what the category has before card spending: carried in, assigned and the whole
 *   month's cash activity. Cash is funded first, even cash spending dated after the card's
 *   ($10 assigned, card −$8 on 10/01, cash −$6 on 10/05 moves $4).
 * - Card activity then runs in date order; on the same day the largest outflow goes first, and
 *   equal ones by transaction id, smallest first (ids are time-ordered). Each purchase is funded
 *   with what the category has left; the rest is credit overspending.
 * - A return first refills what earlier card spending left unfunded; only the rest leaves the
 *   returning card's payment category and is the category's again (card −$3 on 10/01, another
 *   card's +$5 return on 10/02 leaves the first unfunded and moves $2 out). A return doesn't
 *   refill cash overspending: it moves out in full.
 * - What a return pays back above the card's zero (`cash`) joins the category on its date and
 *   refills nothing.
 */
export function fundedCardSpending(
  cash: bigint,
  cards: readonly CardActivity[],
): FundedCardSpending {
  const moved = new Map<string, bigint>();
  const unfunded = new Map<string, bigint>();
  const add = (map: Map<string, bigint>, id: string, n: bigint) =>
    map.set(id, (map.get(id) ?? 0n) + n);
  /** What's left of each unfunded purchase, oldest first, for a later return to refill. */
  const holes: bigint[] = [];
  /** What the category has for card spending; negative while it's overspent in cash. */
  let pool = cash;

  const ordered = [...cards].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0) ||
      a.order.localeCompare(b.order),
  );
  for (const { accountId, amount, cash: returned = 0n } of ordered) {
    if (amount < 0n) {
      const spent = -amount;
      const funded = pool <= 0n ? 0n : pool < spent ? pool : spent;
      pool -= funded;
      add(moved, accountId, funded);
      if (spent > funded) {
        add(unfunded, accountId, spent - funded);
        holes.push(spent - funded);
      }
    } else if (amount > 0n) {
      let rest = amount;
      while (rest > 0n && holes.length > 0) {
        const hole = holes[0] as bigint;
        const fill = hole < rest ? hole : rest;
        rest -= fill;
        if (hole === fill) holes.shift();
        else holes[0] = hole - fill;
      }
      add(moved, accountId, -rest);
      pool += rest;
    }
    pool += returned;
  }
  for (const card of cards) {
    if (!moved.has(card.accountId)) moved.set(card.accountId, 0n);
  }
  return { moved, unfunded };
}

/**
 * What one card line is, for `cardLedger`: spending or a return in a category (Uncategorized
 * included), money to or from Ready to Assign (statement credits, starting balances, the closing
 * adjustment), a transfer with a cash budget account (a payment in, a cash advance out), a
 * transfer with another credit account, or something that moves no plan money.
 */
export type CardLineKind =
  | "category"
  | "readyToAssign"
  | "budgetTransfer"
  | "creditTransfer"
  | "neutral";

export interface CardLine {
  /** The line's id (a transaction's, or a split line's). */
  id: string;
  transactionId: string;
  /** ISO date (`YYYY-MM-DD`). */
  date: string;
  /** The whole transaction's amount; orders a day's transactions. */
  transactionAmount: bigint;
  /** A split line's place in its split (0 for a whole transaction); orders a split's lines. */
  lineOrder: number;
  amount: bigint;
  kind: CardLineKind;
}

export interface CardLineEffect {
  id: string;
  date: string;
  /** Category lines: the part paid from (or returned to) the card's balance above zero: cash. */
  cash: bigint;
  /** Category lines: the rest, card debt (spending) or debt paid down (a return): credit. */
  credit: bigint;
  /** What the line adds to (or takes from) Ready to Assign. */
  readyToAssign: bigint;
  /**
   * Transfers out to another credit account: the part paid from this card's balance above zero,
   * which reaches the other card as a payment (out of its payment category).
   */
  paidFromCash: bigint;
}

/**
 * Walks one card's lines in order and splits each by the card's balance just before it: the part
 * of a balance above zero is cash. Lines run by date; on the same day outflows come first, the
 * largest first (spending dated the day of the payment that made the card positive is credit),
 * and a split's lines in their order.
 *
 * - Spending is cash up to the balance above zero and credit for the rest (−$10 at +$6 is $6 cash
 *   and $4 credit). A return pays down debt first (credit, out of the payment category) and the
 *   rest is cash (+$5 owing $3 moves $3 out, the category gets $5).
 * - Ready to Assign and payments in add the part that takes the card above zero; money out to
 *   Ready to Assign (including closing the card) takes out the part that was above zero.
 * - A cash advance adds what becomes new debt: the amount less what was above zero (at +$6
 *   moving $8: +$2; owing $5 moving $3: +$3).
 * - Between two credit accounts, the sending card's new debt adds nothing; the part it paid from
 *   above zero (`paidFromCash`) is a payment to the other card, and the receiving card counts like
 *   a payment in: what takes it above zero goes to Ready to Assign.
 */
export function cardLedger(lines: readonly CardLine[]): CardLineEffect[] {
  const ordered = [...lines].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      compare(a.transactionAmount, b.transactionAmount) ||
      a.transactionId.localeCompare(b.transactionId) ||
      a.lineOrder - b.lineOrder ||
      a.id.localeCompare(b.id),
  );
  let balance = 0n;
  return ordered.map(({ id, date, amount, kind }) => {
    const effect: CardLineEffect = {
      id,
      date,
      cash: 0n,
      credit: 0n,
      readyToAssign: 0n,
      paidFromCash: 0n,
    };
    if (amount < 0n) {
      const above = balance > 0n ? balance : 0n;
      const fromAbove = above < -amount ? above : -amount;
      if (kind === "category") {
        effect.cash = -fromAbove;
        effect.credit = amount + fromAbove;
      } else if (kind === "readyToAssign") {
        effect.readyToAssign = -fromAbove;
      } else if (kind === "budgetTransfer") {
        effect.readyToAssign = -amount - fromAbove;
      } else if (kind === "creditTransfer") {
        effect.paidFromCash = fromAbove;
      }
    } else if (amount > 0n) {
      const owed = balance < 0n ? -balance : 0n;
      const toDebt = owed < amount ? owed : amount;
      if (kind === "category") {
        effect.credit = toDebt;
        effect.cash = amount - toDebt;
      } else if (kind !== "neutral") {
        effect.readyToAssign = amount - toDebt;
      }
    }
    balance += amount;
    return effect;
  });
}

const compare = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);
