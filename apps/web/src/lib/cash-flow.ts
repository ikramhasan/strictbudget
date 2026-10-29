import type { components } from "@strictbudget/api-client";
import { foldTail, type MonthRange, TOP_INCOME_SOURCES } from "@strictbudget/engine";
import { z } from "zod";
import { $api } from "./api";
import { todayIso } from "./dates";
import { reportSearchSchema } from "./reports";

export type CashFlowData = components["schemas"]["CashFlow"];

export const cashFlowSearchSchema = reportSearchSchema.extend({
  /** Show every source, group and category instead of folding the small ones into "Other". */
  all: z.boolean().optional().catch(undefined),
  /** Expanded groups' ids ("uncategorized" for Uncategorized), comma-separated. */
  open: z.string().optional().catch(undefined),
});

export const cashFlowOptions = (
  budgetId: string,
  range: MonthRange,
  accountIds: string | undefined,
) =>
  $api.queryOptions("get", "/v1/budgets/{budgetId}/reports/cash-flow", {
    params: {
      path: { budgetId },
      query: {
        from: range.from,
        to: range.to,
        today: todayIso(),
        ...(accountIds !== undefined && { accountIds }),
      },
    },
  });

/** The key of a group in `open`: its id, or "uncategorized". */
export const groupKey = (groupId: string | null) => groupId ?? "uncategorized";

/** Groups and categories below this percent of the flow fold into "Other" unless all are shown. */
export const FOLD_PERCENT = 2n;

export type FlowNodeKind =
  | "source"
  | "refunds"
  | "from-savings"
  | "income"
  | "group"
  | "category"
  | "paid-back"
  | "saved";

/** What a node's drill-down lists; null for nodes with no lines of their own (Income, Saved). */
export type FlowDrill =
  | { kind: "income"; payeeIds: (string | null)[] }
  | { kind: "spending"; groupIds?: string[]; categoryIds?: string[] }
  | null;

export interface FlowNode {
  key: string;
  kind: FlowNodeKind;
  name: string;
  /** Money through the node, in minor units. */
  amount: bigint;
  /** 0: where it came from, 1: Income, 2: groups and what's left, 3: an expanded group's categories. */
  column: number;
  drill: FlowDrill;
  /** A group that expands into its categories on click (with its key). */
  expand?: string;
  /** An expanded group. */
  open?: boolean;
  /** Folded items in an "Other" node. */
  folded?: number;
  /** The plan's group or category id, for its colour. */
  colorId?: string | null;
}

export interface FlowLink {
  source: number;
  target: number;
  amount: bigint;
}

export interface FlowGraph {
  nodes: FlowNode[];
  links: FlowLink[];
  /** Everything through Income: sources + refunds + from savings (= groups + paid back + saved). */
  total: bigint;
  /** Whether anything is folded (so "Show all" changes something). */
  folding: boolean;
}

/** Keeps items of at least `FOLD_PERCENT` of `total`; folds the rest unless just one would go. */
function foldSmall<T extends { amount: bigint }>(items: readonly T[], total: bigint, all: boolean) {
  if (all) return { kept: [...items], small: [] as T[] };
  const kept = items.filter((i) => i.amount * 100n >= total * FOLD_PERCENT);
  const small = items.filter((i) => i.amount * 100n < total * FOLD_PERCENT);
  return small.length > 1 ? { kept, small } : { kept: [...items], small: [] as T[] };
}

const amountOf = (s: { amount: string }) => BigInt(s.amount);
const sumOf = (items: readonly { amount: bigint }[]) => items.reduce((s, i) => s + i.amount, 0n);

/**
 * The Sankey's nodes and links: income sources (top 5 and "Other income", as the savings rate's
 * income sources fold), refunds and money from savings into Income; Income out to the groups
 * (Uncategorized first, then plan order; small ones in "Other spending"), income paid back and
 * Saved; an expanded group out to its categories. Amounts stay exact, and every node's inflows
 * equal its outflows.
 */
export function cashFlowGraph(
  data: CashFlowData,
  options: { all: boolean; open: ReadonlySet<string> },
): FlowGraph {
  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];
  const add = (node: FlowNode) => nodes.push(node) - 1;
  let folding = false;

  const sources = data.sources.map((s) => ({ ...s, amount: amountOf(s) }));
  const refunds = data.refunds.map((r) => ({ ...r, amount: amountOf(r) }));
  const fromSavings = BigInt(data.fromSavings);
  const total = sumOf(sources) + sumOf(refunds) + fromSavings;

  const { top, rest } = options.all
    ? { top: sources, rest: [] }
    : foldTail(sources, TOP_INCOME_SOURCES, (s) => s.amount);
  folding ||= rest.length > 0;
  const left: number[] = [];
  for (const s of top) {
    left.push(
      add({
        key: `source:${s.payeeId ?? ""}`,
        kind: "source",
        name: s.name,
        amount: s.amount,
        column: 0,
        drill: { kind: "income", payeeIds: [s.payeeId] },
      }),
    );
  }
  if (rest.length) {
    left.push(
      add({
        key: "source:other",
        kind: "source",
        name: "Other income",
        amount: sumOf(rest),
        column: 0,
        drill: { kind: "income", payeeIds: rest.map((s) => s.payeeId) },
        folded: rest.length,
      }),
    );
  }
  if (refunds.length) {
    left.push(
      add({
        key: "refunds",
        kind: "refunds",
        name: "Refunds",
        amount: sumOf(refunds),
        column: 0,
        drill: { kind: "spending", categoryIds: refunds.map((r) => r.categoryId) },
        folded: refunds.length,
      }),
    );
  }
  if (fromSavings > 0n) {
    left.push(
      add({
        key: "from-savings",
        kind: "from-savings",
        name: "From savings",
        amount: fromSavings,
        column: 0,
        drill: null,
      }),
    );
  }
  if (total === 0n) return { nodes: [], links: [], total, folding: false };
  const income = add({
    key: "income",
    kind: "income",
    name: "Income",
    amount: total,
    column: 1,
    drill: null,
  });
  for (const i of left) links.push({ source: i, target: income, amount: nodes[i]?.amount ?? 0n });

  const groups = data.groups.map((g) => ({
    ...g,
    amount: amountOf(g),
    categories: g.categories.map((c) => ({ ...c, amount: amountOf(c) })),
  }));
  const { kept, small } = foldSmall(groups, total, options.all);
  folding ||= small.length > 0;
  for (const g of kept) {
    const key = groupKey(g.groupId);
    const open = options.open.has(key);
    const group = add({
      key: `group:${key}`,
      kind: "group",
      name: g.name,
      amount: g.amount,
      column: 2,
      drill: g.groupId
        ? { kind: "spending", groupIds: [g.groupId] }
        : { kind: "spending", categoryIds: g.categories.map((c) => c.categoryId) },
      expand: key,
      open,
      colorId: g.groupId,
    });
    links.push({ source: income, target: group, amount: g.amount });
    if (!open) continue;
    const cats = foldSmall(g.categories, total, options.all);
    folding ||= cats.small.length > 0;
    for (const c of cats.kept) {
      const node = add({
        key: `category:${c.categoryId}`,
        kind: "category",
        name: c.name,
        amount: c.amount,
        column: 3,
        drill: { kind: "spending", categoryIds: [c.categoryId] },
        colorId: c.categoryId,
      });
      links.push({ source: group, target: node, amount: c.amount });
    }
    if (cats.small.length) {
      const amount = sumOf(cats.small);
      const node = add({
        key: `category:other:${key}`,
        kind: "category",
        name: `Other ${g.name}`,
        amount,
        column: 3,
        drill: { kind: "spending", categoryIds: cats.small.map((c) => c.categoryId) },
        folded: cats.small.length,
      });
      links.push({ source: group, target: node, amount });
    }
  }
  if (small.length) {
    const amount = sumOf(small);
    const node = add({
      key: "group:other",
      kind: "group",
      name: "Other spending",
      amount,
      column: 2,
      // Its categories (the API ANDs group and category filters, so one list says it all).
      drill: {
        kind: "spending",
        categoryIds: small.flatMap((g) => g.categories.map((c) => c.categoryId)),
      },
      folded: small.length,
    });
    links.push({ source: income, target: node, amount });
  }
  const paidBack = data.paidBack.map((p) => ({ ...p, amount: amountOf(p) }));
  if (paidBack.length) {
    const amount = sumOf(paidBack);
    const node = add({
      key: "paid-back",
      kind: "paid-back",
      name: "Income paid back",
      amount,
      column: 2,
      drill: { kind: "income", payeeIds: paidBack.map((p) => p.payeeId) },
      folded: paidBack.length,
    });
    links.push({ source: income, target: node, amount });
  }
  const saved = BigInt(data.saved);
  if (saved > 0n) {
    const node = add({
      key: "saved",
      kind: "saved",
      name: "Saved",
      amount: saved,
      column: 2,
      drill: null,
    });
    links.push({ source: income, target: node, amount: saved });
  }
  return { nodes, links, total, folding };
}
