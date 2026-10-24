import type { PayeeCategorization } from "@strictbudget/engine";
import { type CurrencyCode, money } from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@strictbudget/ui/components/native-select";
import { RadioGroup, RadioGroupItem } from "@strictbudget/ui/components/radio-group";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { $api } from "@/lib/api";
import { useBudget } from "@/lib/budget-context";
import { categoriesQueryOptions } from "@/lib/categories";
import { categoryOptions, type Payee } from "@/lib/transactions";

export interface CategorizationChange {
  categorization: PayeeCategorization;
  defaultCategoryId: string | null;
}

/** "Always use my choice" saves once a category is picked. */
export function PayeeCategorizationSection({
  payee,
  busy,
  onChange,
}: {
  payee: Payee;
  busy: boolean;
  onChange: (change: CategorizationChange) => Promise<void>;
}) {
  const { budget } = useBudget();
  const id = useId();
  const categoriesQuery = useQuery(categoriesQueryOptions(budget.id));
  const [choosing, setChoosing] = useState(false);
  const [showing, setShowing] = useState(false);
  const mode: PayeeCategorization = choosing ? "always" : payee.categorization;

  const { options, labels } = useMemo(() => {
    const list = categoriesQuery.data;
    if (!list) return { options: [], labels: new Map<string, string>() };
    const labels = new Map<string, string>([
      [list.readyToAssignCategoryId, "Inflow: Ready to Assign"],
    ]);
    for (const g of list.groups) {
      for (const c of g.categories) labels.set(c.id, `${g.name}: ${c.name}`);
    }
    return { options: categoryOptions(list), labels };
  }, [categoriesQuery.data]);
  const groups = useMemo(() => {
    const byGroup = new Map<string, typeof options>();
    for (const o of options) byGroup.set(o.group, [...(byGroup.get(o.group) ?? []), o]);
    return [...byGroup];
  }, [options]);

  function pick(value: string) {
    if (value === "always") {
      // Nothing to save until a category is chosen.
      setChoosing(true);
      return;
    }
    setChoosing(false);
    void onChange({ categorization: value as PayeeCategorization, defaultCategoryId: null });
  }

  const current = payee.autoCategoryId ? labels.get(payee.autoCategoryId) : undefined;

  return (
    <section className="dimmed grid gap-3 rounded-lg border bg-background p-4">
      <p className="font-semibold text-sm">Categorization</p>
      <RadioGroup value={mode} onValueChange={pick} disabled={busy} className="gap-3">
        <div className="grid gap-2">
          <div className="flex items-center gap-2 text-sm">
            <RadioGroupItem id={`${id}-auto`} value="auto" />
            <label htmlFor={`${id}-auto`}>Auto-categorize based on payee history</label>
          </div>
          {mode === "auto" && (
            <div className="grid gap-2 pl-6 text-sm">
              <p>
                strictbudget will auto-select the category for new {payee.name} transactions based
                on how the{" "}
                <button
                  type="button"
                  className="text-primary-text underline underline-offset-4 hover:no-underline"
                  onClick={() => setShowing(true)}
                >
                  last 3 transactions
                </button>{" "}
                for this payee were categorized. This is updated when you add or edit a transaction.
              </p>
              <div>
                <p className="text-muted-foreground">Current default category:</p>
                <p className="font-semibold">{current ?? "Not yet set"}</p>
              </div>
            </div>
          )}
        </div>
        <div className="grid gap-2">
          <div className="flex items-center gap-2 text-sm">
            <RadioGroupItem id={`${id}-always`} value="always" />
            <label htmlFor={`${id}-always`}>Always use my choice</label>
          </div>
          {mode === "always" && (
            <div className="pl-6">
              <NativeSelect
                aria-label="Category to always use"
                className="w-full"
                disabled={busy}
                value={(!choosing && payee.defaultCategoryId) || ""}
                onChange={(e) => {
                  if (!e.target.value) return;
                  setChoosing(false);
                  void onChange({ categorization: "always", defaultCategoryId: e.target.value });
                }}
              >
                <NativeSelectOption value="" disabled />
                {groups.map(([group, items]) => (
                  <NativeSelectOptGroup key={group} label={`${group}:`}>
                    {items.map((o) => (
                      <NativeSelectOption key={o.id} value={o.id}>
                        {o.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelectOptGroup>
                ))}
              </NativeSelect>
            </div>
          )}
        </div>
        <div className="grid gap-2">
          <div className="flex items-center gap-2 text-sm">
            <RadioGroupItem id={`${id}-never`} value="never" />
            <label htmlFor={`${id}-never`}>Do not auto-categorize {payee.name}</label>
          </div>
          {mode === "never" && (
            <p className="pl-6 text-muted-foreground text-sm">
              Manually select the category for each transaction from {payee.name}. This can be
              useful for multi-use payees, like Amazon or Walmart.
            </p>
          )}
        </div>
      </RadioGroup>
      {showing && <LastThree payee={payee} onClose={() => setShowing(false)} />}
    </section>
  );
}

/** The payee's latest categorized transactions, splits left out. */
function LastThree({ payee, onClose }: { payee: Payee; onClose: () => void }) {
  const { budget, formatAmount, formatDate } = useBudget();
  const query = $api.useQuery("get", "/v1/budgets/{budgetId}/payees/transactions", {
    params: { path: { budgetId: budget.id }, query: { payeeIds: payee.id } },
  });
  const rows = (query.data?.transactions ?? [])
    .filter((t) => t.kind === "transaction" && !t.splitLine && t.categoryName !== null)
    .slice(0, 3);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <DialogHeader className="px-4 py-3">
          <DialogTitle>Last 3 transactions</DialogTitle>
          <DialogDescription className="sr-only">
            The transactions {payee.name}'s default category is based on.
          </DialogDescription>
        </DialogHeader>
        {query.isPending ? (
          <Skeleton className="m-4 h-16" />
        ) : query.isError ? (
          <p className="p-4 text-muted-foreground text-sm">Couldn't load the transactions.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Date</th>
                <th className="px-2 py-2 text-left font-medium">Category</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="whitespace-nowrap px-4 py-1.5">{formatDate(t.date)}</td>
                  <td className="max-w-40 truncate px-2 py-1.5">{t.categoryName}</td>
                  <td className="whitespace-nowrap px-4 py-1.5 text-right tabular-nums">
                    {formatAmount(money(BigInt(t.amount), t.currency as CurrencyCode))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <DialogFooter className="m-0 border-t px-4 py-3">
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
