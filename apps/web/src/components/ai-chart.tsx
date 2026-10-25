import { money } from "@strictbudget/engine";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@strictbudget/ui/components/chart";
import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  XAxis,
  YAxis,
} from "recharts";
import { useBudget } from "@/lib/budget-context";

/** The assistant's chart, as its `presentChart` tool call describes it (checked by the server). */
export interface AiChartSpec {
  type: "bar" | "line" | "area" | "pie" | "radar" | "radial";
  title: string;
  description?: string;
  valueFormat: "money" | "number" | "percent";
  data: Array<{ label: string } & Record<string, number | string>>;
  series: Array<{ key: string; label: string }>;
  stacked?: boolean;
  horizontal?: boolean;
  curve?: "linear" | "monotone" | "step";
  donut?: boolean;
}

const TYPES = new Set(["bar", "line", "area", "pie", "radar", "radial"]);

/** The spec, if the tool call's input is one (anything else isn't drawn). */
export function chartSpec(input: unknown): AiChartSpec | null {
  if (!input || typeof input !== "object") return null;
  const spec = input as Partial<AiChartSpec>;
  return TYPES.has(String(spec.type)) && Array.isArray(spec.data) && Array.isArray(spec.series)
    ? (spec as AiChartSpec)
    : null;
}

/** The report palette: colourful in both themes (the chart tokens are greys in this theme). */
const color = (i: number) => `var(--report-${(i % 8) + 1})`;

/**
 * A chart the assistant showed: every kind shadcn's chart component draws (bar, line, area, pie,
 * radar, radial). Series get safe keys (`s0`, `s1`, …) for the component's CSS colour variables,
 * and money is formatted in the budget's currency.
 */
export function AiChart({ spec }: { spec: AiChartSpec }) {
  const { budget, formatAmount } = useBudget();
  const format = (value: unknown): string => {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return String(value);
    if (spec.valueFormat === "money")
      return formatAmount(money(BigInt(Math.round(n)), budget.currency));
    if (spec.valueFormat === "percent") return `${n.toLocaleString()}%`;
    return n.toLocaleString();
  };

  const keys = spec.series.map((_, i) => `s${i}`);
  const rows = spec.data.map((row) => ({
    label: String(row.label),
    ...Object.fromEntries(spec.series.map((s, i) => [`s${i}`, Number(row[s.key]) || 0])),
  }));
  const sliced = spec.type === "pie" || spec.type === "radial";
  // A pie or radial chart colours its slices; the others colour their series.
  const config: ChartConfig = sliced
    ? Object.fromEntries(rows.map((r, i) => [`r${i}`, { label: r.label, color: color(i) }]))
    : Object.fromEntries(spec.series.map((s, i) => [`s${i}`, { label: s.label, color: color(i) }]));
  const slices = rows.map((r, i) => ({ ...r, slice: `r${i}`, fill: color(i) }));

  const tooltip = (
    <ChartTooltip
      content={
        <ChartTooltipContent
          nameKey={sliced ? "slice" : undefined}
          formatter={(value, name, item) => (
            <div className="flex w-full items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ background: item.color ?? item.payload?.fill }}
              />
              <span className="text-muted-foreground">
                {config[String(sliced ? item.payload?.slice : name)]?.label ?? name}
              </span>
              <span className="ml-auto font-medium font-mono tabular-nums">{format(value)}</span>
            </div>
          )}
        />
      }
    />
  );
  const legend =
    keys.length > 1 || sliced ? (
      <ChartLegend
        content={
          // One line per item; the row wraps between items, not inside a name.
          <ChartLegendContent
            nameKey={sliced ? "slice" : undefined}
            className="flex-wrap gap-x-4 gap-y-1.5 *:whitespace-nowrap"
          />
        }
      />
    ) : null;
  const axisTick = (v: unknown) => format(v);
  const curve = spec.curve ?? "monotone";

  let chart: ReactNode;
  switch (spec.type) {
    case "bar":
      chart = (
        <BarChart
          accessibilityLayer
          data={rows}
          layout={spec.horizontal ? "vertical" : "horizontal"}
          margin={{ left: 4, right: 8 }}
        >
          <CartesianGrid vertical={spec.horizontal} horizontal={!spec.horizontal} />
          {spec.horizontal ? (
            <>
              <XAxis type="number" tickFormatter={axisTick} tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey="label"
                width={110}
                tickLine={false}
                axisLine={false}
              />
            </>
          ) : (
            <>
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis tickFormatter={axisTick} width={84} tickLine={false} axisLine={false} />
            </>
          )}
          {tooltip}
          {legend}
          {keys.map((k) => (
            <Bar
              key={k}
              dataKey={k}
              fill={`var(--color-${k})`}
              radius={4}
              stackId={spec.stacked ? "stack" : undefined}
            />
          ))}
        </BarChart>
      );
      break;
    case "line":
      chart = (
        <LineChart accessibilityLayer data={rows} margin={{ left: 4, right: 12 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickFormatter={axisTick} width={84} tickLine={false} axisLine={false} />
          {tooltip}
          {legend}
          {keys.map((k) => (
            <Line
              key={k}
              dataKey={k}
              type={curve}
              stroke={`var(--color-${k})`}
              strokeWidth={2}
              dot={rows.length <= 24}
            />
          ))}
        </LineChart>
      );
      break;
    case "area":
      chart = (
        <AreaChart accessibilityLayer data={rows} margin={{ left: 4, right: 12 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickFormatter={axisTick} width={84} tickLine={false} axisLine={false} />
          {tooltip}
          {legend}
          {keys.map((k) => (
            <Area
              key={k}
              dataKey={k}
              type={curve}
              stroke={`var(--color-${k})`}
              fill={`var(--color-${k})`}
              fillOpacity={0.3}
              stackId={spec.stacked ? "stack" : undefined}
            />
          ))}
        </AreaChart>
      );
      break;
    case "pie":
      chart = (
        <PieChart accessibilityLayer>
          {tooltip}
          {legend}
          <Pie
            data={slices}
            dataKey="s0"
            nameKey="slice"
            innerRadius={spec.donut ? "55%" : 0}
            outerRadius="85%"
            strokeWidth={2}
          >
            {slices.map((s) => (
              <Cell key={s.slice} fill={s.fill} />
            ))}
          </Pie>
        </PieChart>
      );
      break;
    case "radar":
      chart = (
        <RadarChart accessibilityLayer data={rows}>
          <PolarGrid />
          <PolarAngleAxis dataKey="label" />
          {tooltip}
          {legend}
          {keys.map((k) => (
            <Radar
              key={k}
              dataKey={k}
              stroke={`var(--color-${k})`}
              fill={`var(--color-${k})`}
              fillOpacity={0.35}
            />
          ))}
        </RadarChart>
      );
      break;
    case "radial":
      chart = (
        <RadialBarChart accessibilityLayer data={slices} innerRadius="25%" outerRadius="100%">
          {tooltip}
          {legend}
          <RadialBar dataKey="s0" background cornerRadius={4}>
            {slices.map((s) => (
              <Cell key={s.slice} fill={s.fill} />
            ))}
          </RadialBar>
        </RadialBarChart>
      );
      break;
  }

  return (
    // As wide as the assistant's text bubbles (`Bubble`'s max-w-[80%]), not the whole column.
    <figure className="grid w-full max-w-[80%] gap-3 rounded-lg border bg-card p-3">
      <figcaption className="grid gap-0.5">
        <span className="font-medium text-sm">{spec.title}</span>
        {spec.description && (
          <span className="text-muted-foreground text-xs">{spec.description}</span>
        )}
      </figcaption>
      <ChartContainer
        config={config}
        className={
          sliced || spec.type === "radar" ? "aspect-auto h-80 w-full" : "aspect-auto h-64 w-full"
        }
      >
        {chart}
      </ChartContainer>
      {/* The numbers behind the picture, for screen readers. */}
      <table className="sr-only">
        <caption>{spec.title}</caption>
        <thead>
          <tr>
            <th scope="col">Label</th>
            {spec.series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.data.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows of one static chart
            <tr key={i}>
              <th scope="row">{row.label}</th>
              {spec.series.map((s) => (
                <td key={s.key}>{format(row[s.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
