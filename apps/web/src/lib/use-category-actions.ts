import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";
import type { CategoryListActions } from "@/components/category-list";
import { $api } from "./api";
import { apiErrorMessage } from "./budgets";
import { type CategoryList, categoriesQueryOptions } from "./categories";
import { invalidateMonths } from "./months";

/** API-backed actions for <CategoryList>. Failures show a toast and resync with the server. */
export function useCategoryActions(budgetId: string): CategoryListActions {
  const queryClient = useQueryClient();
  const createGroup = $api.useMutation("post", "/v1/budgets/{budgetId}/category-groups");
  const updateGroup = $api.useMutation("patch", "/v1/budgets/{budgetId}/category-groups/{groupId}");
  const deleteGroup = $api.useMutation(
    "delete",
    "/v1/budgets/{budgetId}/category-groups/{groupId}",
  );
  const moveGroup = $api.useMutation(
    "post",
    "/v1/budgets/{budgetId}/category-groups/{groupId}/move",
  );
  const createCategory = $api.useMutation("post", "/v1/budgets/{budgetId}/categories");
  const updateCategory = $api.useMutation(
    "patch",
    "/v1/budgets/{budgetId}/categories/{categoryId}",
  );
  const deleteCategory = $api.useMutation(
    "delete",
    "/v1/budgets/{budgetId}/categories/{categoryId}",
  );
  const moveCategory = $api.useMutation(
    "post",
    "/v1/budgets/{budgetId}/categories/{categoryId}/move",
  );

  return useMemo(() => {
    const { queryKey } = categoriesQueryOptions(budgetId);
    const refresh = () => queryClient.invalidateQueries({ queryKey });

    async function run(work: () => Promise<unknown>, failure: string) {
      try {
        const result = await work();
        // Hiding, deleting (history moves) and moving between groups change the month's totals.
        void invalidateMonths(queryClient);
        // Move endpoints answer with the whole list; everything else just refetches it.
        if (result && typeof result === "object" && "groups" in result) {
          queryClient.setQueryData(queryKey, result as CategoryList);
        } else {
          await refresh();
        }
      } catch (error) {
        toast.error(apiErrorMessage(error, failure));
        await refresh();
      }
    }

    const budget = { budgetId };
    return {
      createGroup: (name) =>
        run(
          () => createGroup.mutateAsync({ params: { path: budget }, body: { name } }),
          "Couldn't add the category group.",
        ),
      updateGroup: (groupId, body) =>
        run(
          () => updateGroup.mutateAsync({ params: { path: { ...budget, groupId } }, body }),
          "Couldn't update the category group.",
        ),
      deleteGroup: (groupId, reassignTo) =>
        run(
          () =>
            deleteGroup.mutateAsync({
              params: {
                path: { ...budget, groupId },
                query: reassignTo ? { reassignToCategoryId: reassignTo } : {},
              },
            }),
          "Couldn't delete the category group.",
        ),
      moveGroup: (groupId, beforeGroupId) =>
        run(
          () =>
            moveGroup.mutateAsync({
              params: { path: { ...budget, groupId } },
              body: { beforeGroupId },
            }),
          "Couldn't move the category group.",
        ),
      createCategory: (groupId, name, savings = false) =>
        run(
          () =>
            createCategory.mutateAsync({
              params: { path: budget },
              body: { groupId, name, savings },
            }),
          "Couldn't add the category.",
        ),
      updateCategory: (categoryId, body) =>
        run(
          () => updateCategory.mutateAsync({ params: { path: { ...budget, categoryId } }, body }),
          "Couldn't update the category.",
        ),
      deleteCategory: (categoryId, reassignTo) =>
        run(
          () =>
            deleteCategory.mutateAsync({
              params: {
                path: { ...budget, categoryId },
                query: reassignTo ? { reassignToCategoryId: reassignTo } : {},
              },
            }),
          "Couldn't delete the category.",
        ),
      moveCategory: (categoryId, groupId, beforeCategoryId) =>
        run(
          () =>
            moveCategory.mutateAsync({
              params: { path: { ...budget, categoryId } },
              body: { groupId, beforeCategoryId },
            }),
          "Couldn't move the category.",
        ),
    } satisfies CategoryListActions;
    // The mutation objects are recreated each render but their mutateAsync is stable.
  }, [budgetId, queryClient]);
}
