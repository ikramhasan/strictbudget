import { Button } from "@strictbudget/ui/components/button";
import { Checkbox } from "@strictbudget/ui/components/checkbox";
import { Label } from "@strictbudget/ui/components/label";
import { useQueryClient } from "@tanstack/react-query";
import { PiggyBank } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { $api } from "@/lib/api";
import { apiErrorMessage } from "@/lib/budgets";
import { type CategoryList, categoriesQueryOptions } from "@/lib/categories";
import { savingsSuggestions } from "@/lib/savings";

/**
 * The plan's one-time suggestion for an existing budget: "These look like savings", the
 * categories `savingsSuggestions` finds, all ticked. Marking them makes them savings categories;
 * either answer puts the suggestion away for everyone on the budget. Nothing changes without a
 * click.
 */
export function SavingsSuggestion({
  categories,
  onMark,
  onDismiss,
}: {
  categories: readonly { id: string; name: string }[];
  /** Marks the ticked categories as savings, then puts the suggestion away. */
  onMark: (ids: string[]) => Promise<void>;
  onDismiss: () => Promise<void>;
}) {
  const [picked, setPicked] = useState(() => new Set(categories.map((c) => c.id)));
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-labelledby="savings-suggestion"
      className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-lg border p-4"
    >
      <div className="flex items-start gap-2">
        <PiggyBank className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="grid gap-1">
          <h2 id="savings-suggestion" className="font-semibold text-sm">
            These look like savings
          </h2>
          <p className="text-muted-foreground text-xs">
            Savings categories are shown apart from what you can spend, can have savings goals, and
            warn you before money leaves them.
          </p>
        </div>
      </div>
      <ul className="grid gap-2">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center gap-2">
            <Checkbox
              id={`suggest-${c.id}`}
              checked={picked.has(c.id)}
              onCheckedChange={(on) =>
                setPicked((current) => {
                  const next = new Set(current);
                  if (on === true) next.add(c.id);
                  else next.delete(c.id);
                  return next;
                })
              }
            />
            <Label htmlFor={`suggest-${c.id}`} className="min-w-0 truncate font-normal text-sm">
              {c.name}
            </Label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void run(onDismiss)}
        >
          Not now
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy || picked.size === 0}
          onClick={() =>
            void run(() => onMark(categories.flatMap((c) => (picked.has(c.id) ? [c.id] : []))))
          }
        >
          Mark as Savings
        </Button>
      </div>
    </section>
  );
}

/**
 * The suggestion in the plan's inspector column, while it's unanswered and anything looks like
 * savings; nothing otherwise.
 */
export function SavingsSuggestionPanel({
  budgetId,
  list,
  updateCategory,
}: {
  budgetId: string;
  list: CategoryList;
  updateCategory: (categoryId: string, patch: { savings: boolean }) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const answer = $api.useMutation("put", "/v1/budgets/{budgetId}/savings-suggestion");
  if (list.savingsSuggestionDismissed) return null;
  const categories = savingsSuggestions(list);
  if (categories.length === 0) return null;
  const dismiss = async () => {
    try {
      await answer.mutateAsync({ params: { path: { budgetId } }, body: { dismissed: true } });
    } catch (error) {
      toast.error(apiErrorMessage(error, "Couldn't save your answer."));
    } finally {
      await queryClient.invalidateQueries({ queryKey: categoriesQueryOptions(budgetId).queryKey });
    }
  };
  return (
    <SavingsSuggestion
      key={categories.map((c) => c.id).join()}
      categories={categories}
      onMark={async (ids) => {
        for (const id of ids) await updateCategory(id, { savings: true });
        await dismiss();
      }}
      onDismiss={dismiss}
    />
  );
}
