import { money } from "@strictbudget/engine";
import { Tooltip, TooltipContent, TooltipTrigger } from "@strictbudget/ui/components/tooltip";
import { cn } from "@strictbudget/ui/lib/utils";
import type { CSSProperties } from "react";
import { useOptionalBudget } from "@/lib/budget-context";
import type { BudgetMonthData } from "@/lib/months";

export type Bar = NonNullable<BudgetMonthData["categories"][number]["bar"]>;
type SegmentKind = Bar["sections"][number]["segments"][number]["kind"];

/** Share of `whole` as a CSS percentage. */
const percent = (part: string, whole: bigint) =>
  whole === 0n ? "0%" : `${Number((BigInt(part) * 100_000n) / whole) / 1000}%`;

/** Stripes for spent money and overspending: 5px of one shade, 1px of the other, at 135°. */
const stripes = (shade: string, stripe: string) =>
  `repeating-linear-gradient(135deg, var(${shade}) 0 5px, var(${stripe}) 5px 6px)`;

/** How a segment is painted, on the bar and on its swatch in the tooltip alike. */
function paint(kind: SegmentKind, yellow: boolean): { className?: string; style: CSSProperties } {
  if (kind === "available") {
    return { className: yellow ? "bg-(--bar-underfunded)" : "bg-(--bar-funded)", style: {} };
  }
  return {
    style: {
      backgroundImage:
        kind === "overspent"
          ? stripes("--bar-overspent", "--bar-overspent-stripe")
          : yellow
            ? stripes("--bar-underfunded-spent", "--bar-underfunded-spent-stripe")
            : stripes("--bar-funded-spent", "--bar-funded-spent-stripe"),
    },
  };
}

/**
 * Sections in proportion to what they stand for (the server works them out), each filled with what
 * was spent (striped), what's still available (solid) and overspending (red stripes): green when
 * the target's met, snoozed or there's no target, yellow while it asks for more. Colours are the
 * `--bar-*` variables in styles.css. A gap sets apart money carried over from last month, a weekly
 * target's weeks, and what goes beyond them; the tooltip names each part.
 */
export function ProgressBar({ bar, className }: { bar: Bar; className?: string }) {
  const total = bar.sections.reduce((sum, s) => sum + BigInt(s.size), 0n);
  const yellow = bar.tone === "underfunded";
  const sections =
    total === 0n ? [{ kind: "target" as const, size: "1", segments: [] }] : bar.sections;
  // The extra section stands apart; the others round only at their ends.
  const last = sections.findLastIndex((s) => s.kind !== "extra");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* The bar says in words what its colours show; the hit area reaches past its 4px. */}
        <div
          role="img"
          aria-label={barLabel(bar)}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: focus opens the bar's explanation
          tabIndex={0}
          className={cn(
            "relative flex h-1 gap-1 rounded-full outline-none before:absolute before:-inset-y-1.5 before:inset-x-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            className,
          )}
        >
          {sections.map((section, i) => (
            <div
              key={i}
              className={cn(
                "flex overflow-hidden bg-(--bar-track) shadow-[inset_0_0_0_1px_var(--bar-border)]",
                section.kind === "extra" || last === 0
                  ? "rounded-full"
                  : i === 0
                    ? "rounded-l-full"
                    : i === last && "rounded-r-full",
              )}
              style={{
                flexBasis: total === 0n ? "100%" : percent(section.size, total),
                flexGrow: 0,
              }}
            >
              {section.segments.map((g, j) => {
                const { className: fill, style } = paint(g.kind, yellow);
                return (
                  <div
                    key={j}
                    className={cn("h-full", fill)}
                    style={{ ...style, width: percent(g.amount, BigInt(section.size)) }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="block min-w-52">
        <BarExplanation bar={bar} />
      </TooltipContent>
    </Tooltip>
  );
}

const SEGMENT_WORD: Record<SegmentKind, string> = {
  spent: "spent",
  available: "available",
  overspent: "overspent",
};

/** The tooltip: the bar's state, each section's money in words, and what the fills mean. */
function BarExplanation({ bar }: { bar: Bar }) {
  const budget = useOptionalBudget();
  const yellow = bar.tone === "underfunded";
  const parts = barParts(bar);
  const total = parts.reduce((sum, p) => sum + p.size, 0n);
  const amount = (minor: bigint) =>
    budget
      ? budget.formatAmount(money(minor, budget.budget.currency))
      : `${total === 0n ? 0n : (minor * 100n) / total}%`;
  const kinds = (["spent", "available", "overspent"] as const).filter((k) =>
    parts.some((p) => p.segments[k] > 0n),
  );
  return (
    <div className="grid gap-1.5">
      <p className="font-medium">{yellow ? "Needs more this month" : "On track"}</p>
      {parts.length > 0 && (
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
          {parts.map((p, i) => {
            const figures = kinds
              .filter((k) => p.segments[k] > 0n)
              .map((k) => `${amount(p.segments[k])} ${SEGMENT_WORD[k]}`);
            return (
              <div key={i} className="contents">
                <dt className="opacity-70">{p.label}</dt>
                <dd className="text-right tabular-nums">{figures.join(" · ") || "Nothing yet"}</dd>
              </div>
            );
          })}
        </dl>
      )}
      {kinds.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 border-background/15 border-t pt-1.5">
          {kinds.map((k) => {
            const { className, style } = paint(k, yellow);
            return (
              <li key={k} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn("h-2 w-3 rounded-[2px] ring-1 ring-background/20", className)}
                  style={style}
                />
                {k === "spent" ? "Spent" : k === "available" ? "Available" : "Overspent"}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export interface BarPart {
  label: string;
  size: bigint;
  segments: Record<SegmentKind, bigint>;
}

/**
 * The bar's sections named for the tooltip: money carried over from last month, the month (or each
 * week of a weekly target) and anything beyond the weeks. Sections without size are left out.
 */
export function barParts(bar: Bar): BarPart[] {
  const weeks = bar.sections.filter((s) => s.kind === "target").length;
  let week = 0;
  return bar.sections
    .filter((s) => BigInt(s.size) > 0n)
    .map((s) => {
      const segments = { spent: 0n, available: 0n, overspent: 0n };
      for (const g of s.segments) segments[g.kind] += BigInt(g.amount);
      const label =
        s.kind === "rollover"
          ? "From last month"
          : s.kind === "extra"
            ? "Beyond the weeks"
            : weeks > 1
              ? `Week ${++week}`
              : "This month";
      return { label, size: BigInt(s.size), segments };
    });
}

/** A bar in words: how much of it is spent, still available and overspent, in whole percent. */
export function barLabel(bar: Bar): string {
  const sums = { spent: 0n, available: 0n, overspent: 0n };
  let total = 0n;
  for (const section of bar.sections) {
    total += BigInt(section.size);
    for (const g of section.segments) {
      if (g.kind in sums) sums[g.kind as keyof typeof sums] += BigInt(g.amount);
    }
  }
  const pct = (part: bigint) => (total === 0n ? 0n : (part * 100n) / total);
  const parts = [
    sums.spent > 0n && `${pct(sums.spent)}% spent`,
    sums.available > 0n && `${pct(sums.available)}% available`,
    sums.overspent > 0n && `${pct(sums.overspent)}% overspent`,
  ].filter(Boolean);
  const tone = bar.tone === "underfunded" ? "Needs more" : "On track";
  return `Progress: ${tone}${parts.length ? `, ${parts.join(", ")}` : ""}`;
}
