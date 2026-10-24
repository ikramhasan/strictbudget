import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { NewAccountValues } from "@/components/account-forms";
import { accountsQueryOptions } from "./accounts";
import { $api } from "./api";
import { apiErrorMessage } from "./budgets";
import { categoriesQueryOptions } from "./categories";
import { todayIso } from "./dates";
import { invalidateMonths } from "./months";
import { uploadAccountLogo } from "./pictures";

/**
 * Creates an account dated the user's today and refreshes what it touches (the account list and,
 * for credit accounts, the categories). Resolves to the new account's id, or an error message.
 */
export function useCreateAccount(budgetId: string) {
  const queryClient = useQueryClient();
  const create = $api.useMutation("post", "/v1/budgets/{budgetId}/accounts");
  const createCategory = $api.useMutation("post", "/v1/budgets/{budgetId}/categories");
  return async ({
    pairing,
    logo,
    ...values
  }: NewAccountValues): Promise<{ id: string } | { error: string }> => {
    try {
      // A loan paired with a new category ("Create a new category") gets it first.
      const pairedCategoryId = !pairing
        ? undefined
        : "categoryId" in pairing
          ? pairing.categoryId
          : (
              await createCategory.mutateAsync({
                params: { path: { budgetId } },
                body: { name: pairing.name.trim(), groupId: pairing.groupId },
              })
            ).id;
      const created = await create.mutateAsync({
        params: { path: { budgetId } },
        body: { ...values, date: todayIso(), pairedCategoryId },
      });
      if (logo) {
        // The account stays either way; its logo can be added again from Edit account.
        await uploadAccountLogo(budgetId, created.id, logo).catch((e: unknown) =>
          toast.error(
            `The account was added, but its logo wasn't: ${e instanceof Error ? e.message : "try again from Edit account."}`,
          ),
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: accountsQueryOptions(budgetId).queryKey }),
        queryClient.invalidateQueries({ queryKey: categoriesQueryOptions(budgetId).queryKey }),
        invalidateMonths(queryClient),
      ]);
      return { id: created.id };
    } catch (error) {
      return { error: apiErrorMessage(error, "Couldn't add the account.") };
    }
  };
}
