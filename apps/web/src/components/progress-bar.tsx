import { cn } from "@strictbudget/ui/lib/utils";
import type { BudgetMonthData } from "@/lib/months";

type Bar = NonNullable<BudgetMonthData["categories"][number]["bar"]>;

/** Share of `whole` as a CSS percentage. */
const percent = (part: string, whole: bigint) =>
  whole === 0n ? "0%" : `${Number((BigInt(part) * 100_000n) / whole) / 1000}%`;

/** Stripes for spent money and overspending: 5px of one shade, 1px of the other, at 135°. */
const stripes = (shade: string, stripe: string) =>
  `repeating-linear-gradient(135deg, var(${shade}) 0 5px, var(${stripe}) 5px 6px)`;

/**
 * Sections in proportion to what they stand for (the server works them out), each filled with what
 * was spent (striped), what's still available (solid) and overspending (red stripes): green when
 * the target's met, snoozed or there's no target, yellow while it asks for more. Colours are the
 * `--bar-*` variables in styles.css.
 */
export function ProgressBar({ bar, className }: { bar: Bar; className?: string }) {
  const total = bar.sections.reduce((sum, s) => sum + BigInt(s.size), 0n);
  const yellow = bar.tone === "underfunded";
  const sections =
    total === 0n ? [{ kind: "target" as const, size: "1", segments: [] }] : bar.sections;
  // The extra section stands apart; the others round only at their ends.
  const last = sections.findLastIndex((s) => s.kind !== "extra");
  return (
    // The bar says in words what its colours show.
    <div role="img" aria-label={barLabel(bar)} className={cn("flex h-1 gap-1", className)}>
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
          style={{ flexBasis: total === 0n ? "100%" : percent(section.size, total), flexGrow: 0 }}
        >
          {section.segments.map((g, j) => (
            <div
              key={j}
              className={cn(
                "h-full",
                g.kind === "available" && (yellow ? "bg-(--bar-underfunded)" : "bg-(--bar-funded)"),
              )}
              style={{
                width: percent(g.amount, BigInt(section.size)),
                backgroundImage:
                  g.kind === "overspent"
                    ? stripes("--bar-overspent", "--bar-overspent-stripe")
                    : g.kind === "spent"
                      ? yellow
                        ? stripes("--bar-underfunded-spent", "--bar-underfunded-spent-stripe")
                        : stripes("--bar-funded-spent", "--bar-funded-spent-stripe")
                      : undefined,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
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
