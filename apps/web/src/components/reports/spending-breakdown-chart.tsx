import { type CurrencyCode, money, shareLabel } from "@strictbudget/engine";
import { ChartContainer } from "@strictbudget/ui/components/chart";
import { Pie, PieChart, Tooltip, Treemap, type TreemapNode } from "recharts";
import { useBudget } from "@/lib/budget-context";
import { chartNumber } from "@/lib/reports";
import type { Breakdown, BreakdownRow } from "@/lib/spending-breakdown";

export type BreakdownChartKind = "donut" | "treemap";

function RowTip({ row, breakdown }: { row: BreakdownRow; breakdown: Breakdown }) {
  const { budget, formatAmount } = useBudget();
  return (
    <div className="grid gap-0.5 rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
      {row.groupName && row.groupName !== row.name && (
        <span className="text-muted-foreground">{row.groupName}</span>
      )}
      <span className="font-medium">{row.name}</span>
      <span className="tabular-nums">
        {formatAmount(money(-row.net, budget.currency))}
        {breakdown.grossOutflows > 0n && (
          <span className="text-muted-foreground">
            {" · "}
            {shareLabel(-row.net, breakdown.grossOutflows)}
          </span>
        )}
      </span>
    </div>
  );
}

/** The treemap (area = spending) keeps small categories readable. Only rows that spent draw a mark. */
export function SpendingBreakdownChart({
  kind,
  breakdown,
  nested,
  onSelect,
}: {
  kind: BreakdownChartKind;
  breakdown: Breakdown;
  nested: boolean;
  onSelect: (row: BreakdownRow) => void;
}) {
  const { budget, formatAmount } = useBudget();
  const currency = budget.currency as CurrencyCode;
  const marks = breakdown.spending.filter((r) => r.net < 0n);
  const value = (r: BreakdownRow) => chartNumber(-r.net, currency);
  const byKey = new Map(marks.map((r) => [r.key, r]));

  if (kind === "treemap") {
    const leaves = (rows: BreakdownRow[]) =>
      rows.map((r) => ({ name: r.name, value: value(r), rowKey: r.key, fill: r.color }));
    const data:
      | { name: string; children: ReturnType<typeof leaves> }[]
      | ReturnType<typeof leaves> = nested
      ? nestByGroup(marks).map((g) => ({ name: g.name, children: leaves(g.rows) }))
      : leaves(marks);
    return (
      <ChartContainer config={{}} className="aspect-auto h-72 w-full">
        <Treemap
          data={data}
          dataKey="value"
          nameKey="name"
          isAnimationActive={false}
          aspectRatio={4 / 3}
          content={(node: TreemapNode) => (
            <TreemapCell
              node={node}
              onSelect={(key) => byKey.get(key) && onSelect(byKey.get(key) as BreakdownRow)}
            />
          )}
        >
          <Tooltip
            content={({ active, payload }) => {
              const key = (payload?.[0]?.payload as { rowKey?: string } | undefined)?.rowKey;
              const row = key ? byKey.get(key) : undefined;
              return active && row ? <RowTip row={row} breakdown={breakdown} /> : null;
            }}
          />
        </Treemap>
      </ChartContainer>
    );
  }

  const data = marks.map((r) => ({ name: r.name, value: value(r), rowKey: r.key, fill: r.color }));
  return (
    <div className="relative">
      <ChartContainer config={{}} className="mx-auto aspect-square h-64 max-w-full sm:h-72">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="64%"
            outerRadius="100%"
            paddingAngle={data.length > 1 ? 1 : 0}
            stroke="var(--background)"
            strokeWidth={1}
            isAnimationActive={false}
            className="cursor-pointer"
            onClick={(entry: { payload?: { rowKey?: string } }) => {
              const row = entry.payload?.rowKey ? byKey.get(entry.payload.rowKey) : undefined;
              if (row) onSelect(row);
            }}
          />
          <Tooltip
            content={({ active, payload }) => {
              const key = (payload?.[0]?.payload as { rowKey?: string } | undefined)?.rowKey;
              const row = key ? byKey.get(key) : undefined;
              return active && row ? <RowTip row={row} breakdown={breakdown} /> : null;
            }}
          />
        </PieChart>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
        <span className="text-muted-foreground text-xs">Total Spending</span>
        <span className="font-semibold text-lg tabular-nums">
          {formatAmount(money(breakdown.total, currency))}
        </span>
      </div>
    </div>
  );
}

/** Rows grouped under their category group, groups in order of their first (largest) row. */
function nestByGroup(rows: readonly BreakdownRow[]) {
  const groups = new Map<string, { name: string; rows: BreakdownRow[] }>();
  for (const r of rows) {
    const key = r.groupKey ?? r.key;
    const g = groups.get(key) ?? { name: r.groupName ?? r.name, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  return [...groups.values()];
}

function TreemapCell({ node, onSelect }: { node: TreemapNode; onSelect: (key: string) => void }) {
  const { x, y, width, height, name } = node;
  const rowKey = node.rowKey as string | undefined;
  if (!rowKey) {
    return node.depth > 0 ? (
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="none"
        stroke="var(--background)"
        strokeWidth={3}
      />
    ) : (
      <g />
    );
  }
  const fits = width > 48 && height > 22;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the list beside the chart is the keyboard path
    <g className="cursor-pointer" onClick={() => onSelect(rowKey)}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={node.fill as string}
        stroke="var(--background)"
        strokeWidth={1}
      />
      {fits && (
        <text
          x={x + 6}
          y={y + 16}
          fontSize={12}
          fill="white"
          className="pointer-events-none"
          style={{ paintOrder: "stroke" }}
          stroke="rgb(0 0 0 / 0.35)"
          strokeWidth={2}
        >
          {name.length * 7 > width - 12
            ? `${name.slice(0, Math.max(1, Math.floor((width - 12) / 7) - 1))}…`
            : name}
        </text>
      )}
    </g>
  );
}
