import { describe, expect, it } from "vitest";
import { type CashFlowData, cashFlowGraph, type FlowGraph } from "./cash-flow";

/** Every node's inflows equal its outflows (sources and sinks: their own amount). */
function expectBalanced({ nodes, links }: FlowGraph) {
  nodes.forEach((node, i) => {
    const inflow = links.filter((l) => l.target === i).reduce((s, l) => s + l.amount, 0n);
    const outflow = links.filter((l) => l.source === i).reduce((s, l) => s + l.amount, 0n);
    if (inflow > 0n) expect(inflow).toBe(node.amount);
    if (outflow > 0n) expect(outflow).toBe(node.amount);
    expect(inflow > 0n || outflow > 0n).toBe(true);
  });
}

const source = (name: string, amount: number) => ({
  payeeId: name.toLowerCase(),
  name,
  amount: String(amount),
});

/** $10,000 of income from 7 payees; groups of 5,000, 2,500, 100 and 90 (the last two under 2%). */
const data: CashFlowData = {
  currency: "USD",
  income: "1000000",
  spending: "-769000",
  sources: [
    source("Job", 900000),
    source("Gig", 50000),
    source("Gift", 20000),
    source("Refund co", 15000),
    source("Bank", 10000),
    source("Cashback", 3000),
    source("Interest", 2000),
  ],
  paidBack: [],
  refunds: [{ categoryId: "phone", name: "Phone", amount: "1000", groupId: "bills" }],
  groups: [
    {
      groupId: null,
      name: "Uncategorized",
      amount: "10000",
      categories: [{ categoryId: "unc", name: "Uncategorized", amount: "10000" }],
    },
    {
      groupId: "bills",
      name: "Bills",
      amount: "500000",
      categories: [
        { categoryId: "rent", name: "Rent", amount: "490000" },
        { categoryId: "water", name: "Water", amount: "6000" },
        { categoryId: "bin", name: "Bin", amount: "4000" },
      ],
    },
    {
      groupId: "needs",
      name: "Needs",
      amount: "250000",
      categories: [{ categoryId: "food", name: "Food", amount: "250000" }],
    },
    {
      groupId: "fun",
      name: "Fun",
      amount: "10000",
      categories: [{ categoryId: "games", name: "Games", amount: "10000" }],
    },
  ],
  saved: "231000",
  fromSavings: "0",
};

describe("cashFlowGraph", () => {
  it("folds the long tail of sources and small groups, keeping exact sums", () => {
    const graph = cashFlowGraph(data, { all: false, open: new Set() });
    expectBalanced(graph);
    expect(graph.total).toBe(1001000n);
    expect(graph.folding).toBe(true);
    const names = graph.nodes.map((n) => n.name);
    expect(names).toEqual([
      "Job",
      "Gig",
      "Gift",
      "Refund co",
      "Bank",
      "Other income",
      "Refunds",
      "Income",
      "Bills",
      "Needs",
      "Other spending",
      "Saved",
    ]);
    const other = graph.nodes.find((n) => n.name === "Other income");
    expect(other).toMatchObject({ amount: 5000n, folded: 2 });
    expect(other?.drill).toEqual({ kind: "income", payeeIds: ["cashback", "interest"] });
    // Uncategorized and Fun, both 10,000 of 1,001,000 (under 2%).
    expect(graph.nodes.find((n) => n.name === "Other spending")).toMatchObject({
      amount: 20000n,
      folded: 2,
      drill: { kind: "spending", categoryIds: ["unc", "games"] },
    });
  });

  it("shows everything with `all`", () => {
    const graph = cashFlowGraph(data, { all: true, open: new Set(["bills"]) });
    expectBalanced(graph);
    expect(graph.nodes.filter((n) => n.kind === "source")).toHaveLength(7);
    expect(graph.nodes.filter((n) => n.kind === "group").map((n) => n.name)).toEqual([
      "Uncategorized",
      "Bills",
      "Needs",
      "Fun",
    ]);
    expect(graph.nodes.filter((n) => n.kind === "category").map((n) => n.name)).toEqual([
      "Rent",
      "Water",
      "Bin",
    ]);
  });

  it("expands a group into its categories, folding small ones", () => {
    const graph = cashFlowGraph(data, { all: false, open: new Set(["bills"]) });
    expectBalanced(graph);
    const cats = graph.nodes.filter((n) => n.kind === "category");
    expect(cats.map((n) => [n.name, n.amount, n.column])).toEqual([
      ["Rent", 490000n, 3],
      ["Other Bills", 10000n, 3],
    ]);
  });

  it("brings a shortfall in from savings and pays back negative income", () => {
    const graph = cashFlowGraph(
      {
        ...data,
        sources: [source("Job", 100000)],
        refunds: [],
        paidBack: [{ payeeId: "clawback", name: "Clawback", amount: "5000" }],
        groups: [
          {
            groupId: "needs",
            name: "Needs",
            amount: "150000",
            categories: [{ categoryId: "food", name: "Food", amount: "150000" }],
          },
        ],
        saved: "0",
        fromSavings: "55000",
      },
      { all: false, open: new Set() },
    );
    expectBalanced(graph);
    expect(graph.nodes.map((n) => [n.name, n.amount])).toEqual([
      ["Job", 100000n],
      ["From savings", 55000n],
      ["Income", 155000n],
      ["Needs", 150000n],
      ["Income paid back", 5000n],
    ]);
  });

  it("is empty with nothing in or out", () => {
    const empty = cashFlowGraph(
      { ...data, sources: [], refunds: [], groups: [], saved: "0", fromSavings: "0" },
      { all: false, open: new Set() },
    );
    expect(empty).toEqual({ nodes: [], links: [], total: 0n, folding: false });
  });
});
