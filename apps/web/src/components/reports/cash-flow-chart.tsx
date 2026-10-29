import { money, percentOf } from "@strictbudget/engine";
import { useState } from "react";
import { Layer, Rectangle, ResponsiveContainer, Sankey, Tooltip } from "recharts";
import { useBudget } from "@/lib/budget-context";
import type { FlowGraph, FlowNode } from "@/lib/cash-flow";
import { chartNumber, UNCATEGORIZED_COLOR } from "@/lib/reports";

/** A node's colour: income in the income hue, groups and categories in their plan colours. */
export function flowColor(
  node: FlowNode,
  colors: { groups: Map<string, string>; categories: Map<string, string> },
) {
  switch (node.kind) {
    case "source":
    case "income":
      return node.folded ? UNCATEGORIZED_COLOR : "var(--report-3)";
    case "from-savings":
      return "var(--report-4)";
    case "saved":
      return "var(--success)";
    case "group":
      return (node.colorId && colors.groups.get(node.colorId)) || UNCATEGORIZED_COLOR;
    case "category":
      return (node.colorId && colors.categories.get(node.colorId)) || UNCATEGORIZED_COLOR;
    default:
      return UNCATEGORIZED_COLOR;
  }
}

/** Share of the flow for the tooltip: of income, or of the money spent when nothing came in. */
export function shareLabel(amount: bigint, graph: FlowGraph, hasIncome: boolean) {
  const share = percentOf(amount, graph.total);
  if (share === null) return "";
  return `${share.toFixed(1)}% of ${hasIncome ? "income" : "the money spent"}`;
}

interface NodePayload {
  name: string;
  node: FlowNode;
  value: number;
}

/**
 * Income sources → Income → groups (and Saved) → an expanded group's categories. Widths are
 * positions only; labels and the tooltip show the exact amounts. Clicking a group expands it;
 * clicking a link or another node opens its transactions.
 */
export function CashFlowChart({
  graph,
  hasIncome,
  colors,
  onToggle,
  onPick,
}: {
  graph: FlowGraph;
  hasIncome: boolean;
  colors: { groups: Map<string, string>; categories: Map<string, string> };
  onToggle: (groupKey: string) => void;
  onPick: (node: FlowNode) => void;
}) {
  const { budget, formatAmount } = useBudget();
  const format = (amount: bigint) => formatAmount(money(amount, budget.currency));
  const [hover, setHover] = useState<number | null>(null);
  const lastColumn = Math.max(...graph.nodes.map((n) => n.column));
  const perColumn = new Map<number, number>();
  for (const n of graph.nodes) perColumn.set(n.column, (perColumn.get(n.column) ?? 0) + 1);
  const height = Math.max(360, Math.max(...perColumn.values()) * 46);
  const data = {
    nodes: graph.nodes.map((node) => ({ name: node.name, node })),
    links: graph.links.map((l) => ({
      source: l.source,
      target: l.target,
      // Layout only; never shown.
      value: chartNumber(l.amount, budget.currency),
      amount: l.amount,
    })),
  };

  return (
    <div className="grid gap-2">
      <div style={{ height }} className="w-full text-xs">
        <ResponsiveContainer width="100%" height="100%">
          <Sankey
            data={data}
            sort={false}
            align="left"
            nodeWidth={12}
            nodePadding={18}
            iterations={0}
            margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
            onClick={(item, type) => {
              const payload = item.payload as unknown as
                | NodePayload
                | { source: NodePayload; target: NodePayload };
              if (type === "node") {
                const node = (payload as NodePayload).node;
                if (node.expand) onToggle(node.expand);
                else onPick(node);
                return;
              }
              const link = payload as { source: NodePayload; target: NodePayload };
              // A link into Income shows its source's lines; any other its target's.
              const node = link.target.node.kind === "income" ? link.source.node : link.target.node;
              onPick(node);
            }}
            node={(props) => {
              const { x, y, width, height: h, index } = props;
              const node = (props.payload as unknown as NodePayload).node;
              const color = flowColor(node, colors);
              const right = node.column < lastColumn || lastColumn === 0;
              const clickable = node.expand !== undefined || node.drill !== null;
              return (
                <Layer key={node.key}>
                  <Rectangle
                    x={x}
                    y={y}
                    width={width}
                    height={Math.max(h, 1)}
                    fill={color}
                    radius={2}
                    className={clickable ? "cursor-pointer" : undefined}
                    onMouseEnter={() => setHover(index)}
                    onMouseLeave={() => setHover(null)}
                  />
                  <text
                    x={right ? x + width + 6 : x - 6}
                    y={y + h / 2}
                    textAnchor={right ? "start" : "end"}
                    dominantBaseline="middle"
                    className="pointer-events-none fill-foreground"
                  >
                    <tspan className="font-medium">
                      {node.expand !== undefined && `${node.open ? "▾" : "▸"} `}
                      {node.name}
                    </tspan>
                    <tspan dx={6} className="fill-muted-foreground tabular-nums">
                      {format(node.amount)}
                    </tspan>
                  </text>
                </Layer>
              );
            }}
            link={(props) => {
              const {
                sourceX,
                targetX,
                sourceY,
                targetY,
                sourceControlX,
                targetControlX,
                linkWidth,
                index,
              } = props;
              const link = graph.links[index];
              const source = link && graph.nodes[link.source];
              const target = link && graph.nodes[link.target];
              // Into Income a flow takes its source's colour, after it its target's.
              const colored = target?.kind === "income" ? source : target;
              const color = colored ? flowColor(colored, colors) : UNCATEGORIZED_COLOR;
              const lit = hover === null || link?.source === hover || link?.target === hover;
              return (
                <path
                  d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={Math.max(linkWidth, 1)}
                  strokeOpacity={lit ? 0.4 : 0.12}
                  className="cursor-pointer transition-[stroke-opacity] duration-150 hover:stroke-opacity-60"
                />
              );
            }}
          >
            <Tooltip
              content={({ active, payload }) => {
                const item = active ? payload?.[0]?.payload : undefined;
                if (!item) return null;
                const entry = item as
                  | { payload?: NodePayload & { source?: NodePayload; target?: NodePayload } }
                  | undefined;
                const p = entry?.payload as
                  | (NodePayload & { source?: NodePayload; target?: NodePayload; amount?: bigint })
                  | undefined;
                if (!p) return null;
                const title = p.source && p.target ? `${p.source.name} → ${p.target.name}` : p.name;
                const amount = p.source && p.target ? (p.amount ?? 0n) : p.node.amount;
                return (
                  <div className="grid min-w-44 gap-0.5 rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                    <p className="font-medium">{title}</p>
                    <p className="tabular-nums">{format(amount)}</p>
                    <p className="text-muted-foreground">{shareLabel(amount, graph, hasIncome)}</p>
                    {p.node?.folded && (
                      <p className="text-muted-foreground">{p.node.folded} folded together</p>
                    )}
                  </div>
                );
              }}
            />
          </Sankey>
        </ResponsiveContainer>
      </div>
      <p className="text-center text-muted-foreground text-xs">
        Click a group to show its categories; click a flow to see its transactions.
      </p>
    </div>
  );
}
