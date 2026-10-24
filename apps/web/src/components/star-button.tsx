import { Button } from "@strictbudget/ui/components/button";
import { cn } from "@strictbudget/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { type Account, accountsQueryOptions, canStar, isStarred } from "@/lib/accounts";
import { $api } from "@/lib/api";
import { apiErrorMessage } from "@/lib/budgets";
import { useUndo } from "@/lib/undo";

/**
 * Open cash and credit accounts only. Starring adds the account to the end of the sidebar's
 * Starred group, for everyone on the budget.
 */
export function StarButton({
  budgetId,
  account,
  accounts,
}: {
  budgetId: string;
  account: Account;
  accounts: readonly Account[];
}) {
  const queryClient = useQueryClient();
  const history = useUndo();
  const update = $api.useMutation("patch", "/v1/budgets/{budgetId}/accounts/{accountId}");
  const move = $api.useMutation("post", "/v1/budgets/{budgetId}/accounts/{accountId}/move");
  if (!canStar(account)) return null;
  const starred = isStarred(account);
  const path = { budgetId, accountId: account.id };

  async function setStarred(value: boolean, beforeAccountId: string | null = null) {
    await update.mutateAsync({ params: { path }, body: { starred: value } });
    // Unstarring, then undoing, puts it back in its old place rather than at the end.
    if (value && beforeAccountId) {
      await move.mutateAsync({ params: { path }, body: { beforeAccountId, starred: true } });
    }
    await queryClient.invalidateQueries({ queryKey: accountsQueryOptions(budgetId).queryKey });
  }

  async function toggle() {
    const next = accounts
      .filter((a) => isStarred(a) && (a.starredOrder ?? 0) > (account.starredOrder ?? 0))
      .sort((a, b) => (a.starredOrder ?? 0) - (b.starredOrder ?? 0))[0];
    const before = starred ? (next?.id ?? null) : null;
    try {
      await setStarred(!starred);
      history.record({
        label: starred ? "Unstar account" : "Star account",
        undo: () => setStarred(starred, before),
        redo: () => setStarred(!starred),
      });
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't change the star."));
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Toggle Starred"
      aria-pressed={starred}
      title={starred ? "Starred" : "Star this account"}
      disabled={update.isPending || move.isPending}
      onClick={() => void toggle()}
    >
      <Star className={cn(starred ? "fill-current text-amber-500" : "text-muted-foreground")} />
    </Button>
  );
}
