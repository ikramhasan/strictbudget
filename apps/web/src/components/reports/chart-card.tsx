import { Button } from "@strictbudget/ui/components/button";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@strictbudget/ui/components/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@strictbudget/ui/components/tooltip";
import { cn } from "@strictbudget/ui/lib/utils";
import { ChartColumn, ChartNoAxesColumn, ImageDown, Table2 } from "lucide-react";
import { domToBlob } from "modern-screenshot";
import { type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import { saveBlob } from "@/lib/reports";

export type ChartView = "chart" | "table";

/** One of a card's ways to draw its chart (Donut, Treemap…), beside its table. */
export interface ChartKind {
  value: string;
  label: string;
  icon: ReactNode;
}

const DEFAULT_KINDS: readonly ChartKind[] = [
  { value: "chart", label: "Chart", icon: <ChartColumn /> },
];

/**
 * Every chart has a table view (the accessible alternative); the PNG is of the chart. The ways to
 * show it, chart kinds and the table, are one segmented control in the card's header.
 */
export function ChartCard({
  title,
  view,
  onViewChange,
  kinds,
  kind,
  options,
  loading,
  empty,
  chart,
  table,
  fileName,
  className,
}: {
  title: string;
  view: ChartView;
  /** `kind` is the chart kind picked, when the card has `kinds`. */
  onViewChange: (view: ChartView, kind?: string) => void;
  kinds?: readonly ChartKind[];
  kind?: string;
  /** Under the header in chart view: overlays and the like. */
  options?: ReactNode;
  loading?: boolean;
  /** What to say in the chart's place when there's nothing to draw. */
  empty?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
  /** The PNG's name, without ".png". */
  fileName: string;
  className?: string;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const savePng = async () => {
    if (!chartRef.current) return;
    setSaving(true);
    try {
      const background = getComputedStyle(chartRef.current).backgroundColor;
      const blob = await domToBlob(chartRef.current, { scale: 2, backgroundColor: background });
      saveBlob(blob, `${fileName}.png`);
    } catch {
      toast.error("Couldn't save the chart.");
    } finally {
      setSaving(false);
    }
  };
  const shown = kinds ?? DEFAULT_KINDS;
  const ways = [...shown, { value: "table", label: "Table", icon: <Table2 /> }];
  const value = view === "table" ? "table" : (kind ?? shown[0]?.value ?? "chart");
  const ready = !loading && !empty;
  return (
    <section
      aria-label={title}
      className={cn("grid gap-3 rounded-lg border bg-card p-4", className)}
    >
      <div className="flex min-h-8 flex-wrap items-center gap-2">
        <h2 className="font-semibold">{title}</h2>
        {ready && (
          <div className="ml-auto flex items-center gap-1">
            {view === "chart" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Save chart as PNG"
                    disabled={saving}
                    onClick={savePng}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ImageDown />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Save as PNG</TooltipContent>
              </Tooltip>
            )}
            <ToggleGroup
              type="single"
              spacing={0}
              size="sm"
              value={value}
              onValueChange={(v) => {
                if (!v) return;
                if (v === "table") onViewChange("table");
                else onViewChange("chart", kinds ? v : undefined);
              }}
              aria-label="Show as"
            >
              {ways.map((w) => (
                <Tooltip key={w.value}>
                  {/* A wrapper, so the tooltip's data-state doesn't replace the item's "on". */}
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <ToggleGroupItem value={w.value} aria-label={w.label} className="px-2">
                        {w.icon}
                      </ToggleGroupItem>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{w.label}</TooltipContent>
                </Tooltip>
              ))}
            </ToggleGroup>
          </div>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : empty ? (
        typeof empty === "string" ? (
          <ReportEmpty>{empty}</ReportEmpty>
        ) : (
          empty
        )
      ) : view === "chart" ? (
        <>
          {options}
          <div ref={chartRef} className="min-w-0 bg-card">
            {chart}
          </div>
        </>
      ) : (
        <div className="overflow-x-auto">{table}</div>
      )}
    </section>
  );
}

/**
 * A chart's or a card's calm "nothing here yet": what will show here and, when there's
 * something to do about it, what.
 */
export function ReportEmpty({
  title,
  children,
  action,
  className,
}: {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid min-h-40 place-content-center justify-items-center gap-1.5 rounded-md border border-dashed px-6 py-8 text-center",
        className,
      )}
    >
      <ChartNoAxesColumn aria-hidden className="mb-1 size-5 text-muted-foreground/70" />
      {title && <p className="font-medium text-sm">{title}</p>}
      <p className="max-w-sm text-balance text-muted-foreground text-sm">{children}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
