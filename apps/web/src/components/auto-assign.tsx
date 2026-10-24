import {
  AUTO_ASSIGN_OPTIONS,
  type AutoAssignOption,
  type FundingStep,
  fundUnderfunded,
} from "@strictbudget/engine";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@strictbudget/ui/components/alert-dialog";
import { Button } from "@strictbudget/ui/components/button";
import { cn } from "@strictbudget/ui/lib/utils";
import { useState } from "react";
import type { BudgetMonthData } from "@/lib/months";

type Format = (minorUnits: string) => string;
type MonthCategory = BudgetMonthData["categories"][number];

/** An Auto-Assign as Recent Moves names its method ("Method: Reset Assigned Amounts"). */
export const autoAssignMethodLabel = (option: AutoAssignOption) => label(option, false);

function label(option: AutoAssignOption, one: boolean, payment = false) {
  switch (option) {
    case "underfunded":
      return "Underfunded";
    case "reduceOverfunding":
      return "Reduce Overfunding";
    case "assignedLastMonth":
      return "Assigned Last Month";
    case "spentLastMonth":
      return payment ? "Paid Last Month" : "Spent Last Month";
    case "averageAssigned":
      return "Average Assigned";
    case "averageSpent":
      return payment ? "Average Paid" : "Average Spent";
    case "resetAvailable":
      return one ? "Reset Available Amount" : "Reset Available Amounts";
    case "resetAssigned":
      return one ? "Reset Assigned Amount" : "Reset Assigned Amounts";
  }
}

export interface AutoAssignChange {
  categoryId: string;
  name: string;
  group: string;
  delta: bigint;
}

/**
 * What an option would change: each category whose Assigned moves, and by how much. Underfunded
 * with `readyToAssign` given (the whole plan or a view) funds in `fundUnderfunded`'s order until
 * it runs out, as the server does.
 */
export function autoAssignChanges(
  option: AutoAssignOption,
  categories: readonly MonthCategory[],
  names: ReadonlyMap<string, { name: string; group: string }>,
  readyToAssign?: bigint,
): AutoAssignChange[] {
  const given =
    option === "underfunded" && readyToAssign !== undefined
      ? fundUnderfunded(
          categories.map((c) => ({
            categoryId: c.categoryId,
            parts: c.underfundedParts.map((p) => ({
              amount: BigInt(p.amount),
              step: p.step as FundingStep,
              date: p.date,
            })),
          })),
          readyToAssign,
        )
      : null;
  return categories.flatMap((c) => {
    const delta = given
      ? (given.get(c.categoryId) ?? 0n)
      : BigInt(c.autoAssign[option]) - BigInt(c.assigned);
    const named = names.get(c.categoryId);
    return delta !== 0n && named ? [{ categoryId: c.categoryId, ...named, delta }] : [];
  });
}

/**
 * The amount on an option's button: what the categories would end up with. For Reset Available
 * that's the Available after it, otherwise the Assigned. Underfunded and Reduce Overfunding show
 * what they'd add or take back.
 */
function buttonAmount(option: AutoAssignOption, categories: readonly MonthCategory[]) {
  return categories.reduce((sum, c) => {
    const target = BigInt(c.autoAssign[option]);
    const assigned = BigInt(c.assigned);
    switch (option) {
      case "underfunded":
        return sum + target - assigned;
      case "reduceOverfunding":
        return sum + assigned - target;
      case "resetAvailable":
        return sum + BigInt(c.available) + target - assigned;
      default:
        return sum + target;
    }
  }, 0n);
}

/**
 * Reduce Overfunding is listed only when something is over, and Underfunded on a single category
 * only while it's short (a met target has no Underfunded button).
 */
function listsOption(option: AutoAssignOption, amount: bigint, one: boolean) {
  if (option === "reduceOverfunding") return amount !== 0n;
  if (option === "underfunded") return !one || amount !== 0n;
  return true;
}

/** Cards Underfunded lists apart: credit overspending, or uncategorized transactions this month. */
const needsAttention = (c: MonthCategory) =>
  Boolean(c.payment && (c.payment.overspentCategories !== "0" || c.payment.hasUncategorized));

/**
 * The inspector's Auto-Assign section. With categories selected an option applies to them at
 * once; with none selected it covers every visible category, after a preview (and Reset Assigned
 * asks first).
 */
export function AutoAssignPanel({
  categories,
  names,
  selection,
  readyToAssign,
  format,
  onApply,
  onViewAll,
  bare = false,
}: {
  /** The categories it covers: the selection, or the rows in view. */
  categories: readonly MonthCategory[];
  names: ReadonlyMap<string, { name: string; group: string }>;
  /** Whether categories are selected (no preview then). */
  selection: boolean;
  /** The month's Ready to Assign: what Underfunded can give the whole plan or a view. */
  readyToAssign: bigint;
  format: Format;
  onApply: (option: AutoAssignOption) => Promise<void>;
  /** A view that keeps nothing: say so instead of listing the options. */
  onViewAll?: () => void;
  /** Without the frame and heading, as in the Ready to Assign banner's Assign pop-up. */
  bare?: boolean;
}) {
  const [preview, setPreview] = useState<AutoAssignOption | null>(null);
  // Labels go singular whenever one category is covered (selected or the only one in view).
  const one = categories.length === 1;
  const payment = one && Boolean(categories[0]?.payment);
  const underfunded = preview === "underfunded";
  const changes = preview ? autoAssignChanges(preview, categories, names, readyToAssign) : [];
  // Underfunded lists the cards that need attention on their own, changed or not (even at
  // $0.00), and counts the categories it funds in full.
  const attention = underfunded
    ? categories.filter(needsAttention).flatMap((c) => {
        const named = names.get(c.categoryId);
        if (!named) return [];
        const delta = changes.find((ch) => ch.categoryId === c.categoryId)?.delta ?? 0n;
        return [{ categoryId: c.categoryId, ...named, delta }];
      })
    : [];
  const listed = changes.filter((c) => !attention.some((a) => a.categoryId === c.categoryId));
  const full = new Map(categories.map((c) => [c.categoryId, c]));
  const isFull = (c: AutoAssignChange) => {
    const category = full.get(c.categoryId);
    return (
      category && BigInt(category.assigned) + c.delta === BigInt(category.autoAssign.underfunded)
    );
  };
  // Underfunded lists what it can only partly fund apart from what it funds in full.
  const fullyFunded = underfunded ? listed.filter(isFull) : listed;
  const partlyFunded = underfunded ? listed.filter((c) => !isFull(c)) : [];
  const amountText = (delta: bigint) => `${delta > 0n ? "+" : ""}${format(delta.toString())}`;
  const count = (n: number) => `${n} ${n === 1 ? "category" : "categories"}`;

  return (
    <section
      aria-label="Auto-Assign"
      className={cn("grid gap-2", !bare && "rounded-lg border p-4")}
    >
      {!bare && <h2 className="font-semibold text-sm">Auto-Assign</h2>}
      {categories.length === 0 ? (
        <div className="grid justify-items-start gap-1 text-muted-foreground text-sm">
          <p>This view has no categories.</p>
          {onViewAll && (
            <Button variant="link" size="sm" className="h-auto p-0" onClick={onViewAll}>
              View All Categories
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-1">
          {AUTO_ASSIGN_OPTIONS.map((option) => {
            const value = buttonAmount(option, categories);
            if (!listsOption(option, value, one)) return null;
            const amount = format(value.toString());
            return (
              <Button
                key={option}
                variant="secondary"
                size="sm"
                aria-label={`${label(option, one, payment)} ${amount}`}
                className="justify-between font-normal"
                onClick={() => (selection ? void onApply(option) : setPreview(option))}
              >
                <span>{label(option, one, payment)}</span>
                <span className="tabular-nums">{amount}</span>
              </Button>
            );
          })}
        </div>
      )}

      <AlertDialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Auto-Assign Preview: {preview && label(preview, false)}
            </AlertDialogTitle>
            <AlertDialogDescription className={cn(underfunded && changes.length > 0 && "sr-only")}>
              {changes.length === 0
                ? "This won't change any assigned amounts."
                : underfunded
                  ? `${count(fullyFunded.length)} will be fully funded.`
                  : `This will update the assigned amount for ${count(changes.length)}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid max-h-96 gap-3 overflow-y-auto text-sm">
            {attention.length > 0 && (
              <PreviewBox tone="yellow">
                <p>
                  {attention.length === 1 ? "This credit card" : "These credit cards"} may need more
                  attention, because of credit overspending, or uncategorized transactions.
                </p>
                <ChangeList changes={attention} amountText={amountText} />
              </PreviewBox>
            )}
            {partlyFunded.length > 0 && (
              <PreviewBox tone="yellow">
                <p>
                  You don't have enough money to fully fund all of your categories.{" "}
                  <strong>{count(partlyFunded.length)}</strong> will be partially funded.
                </p>
                <ChangeList changes={partlyFunded} amountText={amountText} />
              </PreviewBox>
            )}
            {underfunded && fullyFunded.length > 0 && (
              <PreviewBox tone="green">
                <p>
                  <strong>{count(fullyFunded.length)}</strong> will be fully funded.
                </p>
                <ChangeList changes={fullyFunded} amountText={amountText} />
              </PreviewBox>
            )}
            {!underfunded && <ChangeList changes={listed} amountText={amountText} />}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={changes.length === 0}
              onClick={() => {
                if (preview) void onApply(preview);
                setPreview(null);
              }}
            >
              {underfunded ? "Assign Money" : "Update Assigned Amounts"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** One of the Underfunded preview's boxes: yellow for what needs a look, green for what's funded. */
function PreviewBox({ tone, children }: { tone: "yellow" | "green"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "grid gap-2 rounded-md p-3",
        tone === "yellow"
          ? "bg-yellow-100 text-yellow-950 dark:bg-yellow-900/40 dark:text-yellow-50"
          : "bg-green-100 text-green-950 dark:bg-green-900/40 dark:text-green-50",
      )}
    >
      {children}
    </div>
  );
}

/** Changes listed by category group. */
function ChangeList({
  changes,
  amountText,
}: {
  changes: readonly { categoryId: string; name: string; group: string; delta: bigint }[];
  amountText: (delta: bigint) => string;
}) {
  const byGroup = new Map<string, (typeof changes)[number][]>();
  for (const c of changes) byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c]);
  return (
    <div className="grid gap-3">
      {[...byGroup].map(([group, list]) => (
        <div key={group} className="grid gap-1">
          <p className="font-semibold">{group}</p>
          {list.map((c) => (
            <div key={c.categoryId} className="flex justify-between gap-2 pl-2">
              <span className="truncate">{c.name}</span>
              <span className="tabular-nums">{amountText(c.delta)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
