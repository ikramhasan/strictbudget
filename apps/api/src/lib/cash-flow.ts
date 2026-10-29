/**
 * Where the money came from and where it went, from Income v Expense's sums: income per payee and
 * spending per category, every amount in the budget's currency. A Sankey can't draw a negative
 * flow, so each net goes to the side its sign puts it on:
 * - a payee with positive income is a **source**; one netting below zero (income paid back) flows
 *   out of Income to **paid back**;
 * - a category that spent is under its **group**; one where more came back than went out
 *   (refunds) flows into Income as a **refund**;
 * - what's left is **saved**; a shortfall comes in **from savings**.
 *
 * So sources + refunds + fromSavings = groups + paidBack + saved, exactly, and saved − fromSavings
 * is Income v Expense's net income.
 */

export interface CashFlowCategory {
  categoryId: string;
  name: string;
  /** Spent (> 0) or, in `refunds`, came back (> 0). */
  amount: bigint;
}

export interface CashFlowGroup {
  /** null: categories outside the plan's groups (Uncategorized). */
  groupId: string | null;
  name: string;
  /** The sum of `categories`. */
  amount: bigint;
  categories: CashFlowCategory[];
}

export interface CashFlowSource {
  /** null: income without a payee. */
  payeeId: string | null;
  name: string;
  amount: bigint;
}

export interface CashFlow {
  /** Income v Expense's income and net spending (negative when spent). */
  income: bigint;
  spending: bigint;
  sources: CashFlowSource[];
  paidBack: CashFlowSource[];
  refunds: (CashFlowCategory & { groupId: string | null })[];
  groups: CashFlowGroup[];
  saved: bigint;
  fromSavings: bigint;
}

export interface CashFlowInput {
  /** Income nets per payee (null: no payee). */
  income: readonly { payeeId: string | null; net: bigint }[];
  /** Spending nets per category. */
  spending: readonly { categoryId: string; net: bigint }[];
  payeeNames: ReadonlyMap<string, string>;
  /** The plan's groups in order, categories in order; anything else is Uncategorized. */
  groups: readonly {
    id: string;
    name: string;
    categories: readonly { id: string; name: string }[];
  }[];
  /** Names of categories outside `groups` (Uncategorized, a deleted group's). */
  otherCategoryNames: ReadonlyMap<string, string>;
}

export const NO_PAYEE = "[No Payee]";
export const UNCATEGORIZED = "Uncategorized";

const byAmount = <T extends { amount: bigint; name: string }>(a: T, b: T) =>
  a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : a.name.localeCompare(b.name);

export function cashFlow(input: CashFlowInput): CashFlow {
  const income = input.income.reduce((s, r) => s + r.net, 0n);
  const spending = input.spending.reduce((s, r) => s + r.net, 0n);
  const named = (payeeId: string | null) =>
    payeeId === null ? NO_PAYEE : (input.payeeNames.get(payeeId) ?? NO_PAYEE);
  const sources = input.income
    .filter((r) => r.net > 0n)
    .map((r) => ({ payeeId: r.payeeId, name: named(r.payeeId), amount: r.net }))
    .sort(byAmount);
  const paidBack = input.income
    .filter((r) => r.net < 0n)
    .map((r) => ({ payeeId: r.payeeId, name: named(r.payeeId), amount: -r.net }))
    .sort(byAmount);

  const nets = new Map(input.spending.map((r) => [r.categoryId, r.net]));
  const listed = new Set<string>();
  const refunds: CashFlow["refunds"] = [];
  const groupOf = (
    groupId: string | null,
    name: string,
    categories: readonly { id: string; name: string }[],
  ): CashFlowGroup[] => {
    const spent: CashFlowCategory[] = [];
    for (const c of categories) {
      listed.add(c.id);
      const net = nets.get(c.id);
      if (net === undefined || net === 0n) continue;
      if (net > 0n) refunds.push({ categoryId: c.id, name: c.name, amount: net, groupId });
      else spent.push({ categoryId: c.id, name: c.name, amount: -net });
    }
    if (!spent.length) return [];
    return [{ groupId, name, amount: spent.reduce((s, c) => s + c.amount, 0n), categories: spent }];
  };
  const planned = input.groups.flatMap((g) => groupOf(g.id, g.name, g.categories));
  // Uncategorized first, as every spending report lists it.
  const others = input.spending
    .filter((r) => !listed.has(r.categoryId))
    .map((r) => ({
      id: r.categoryId,
      name: input.otherCategoryNames.get(r.categoryId) ?? UNCATEGORIZED,
    }));
  const groups = [...groupOf(null, UNCATEGORIZED, others), ...planned];
  refunds.sort(byAmount);

  const net = income + spending;
  return {
    income,
    spending,
    sources,
    paidBack,
    refunds,
    groups,
    saved: net > 0n ? net : 0n,
    fromSavings: net < 0n ? -net : 0n,
  };
}
