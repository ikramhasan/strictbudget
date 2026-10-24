import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { $api } from "./api";
import { apiErrorMessage } from "./budgets";
import { categoriesQueryOptions } from "./categories";
import { currentMonth, invalidateMonths } from "./months";

export const categoryTemplatesQueryOptions = (budgetId: string) =>
  $api.queryOptions("get", "/v1/budgets/{budgetId}/category-templates", {
    params: { path: { budgetId } },
  });

export function useCategoryTemplates(budgetId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const list = useQuery({
    ...categoryTemplatesQueryOptions(budgetId),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const mutation = $api.useMutation(
    "post",
    "/v1/budgets/{budgetId}/category-templates/{templateId}/import",
  );

  /** Imports the ticked categories; false when it failed (having said so). */
  async function importTemplate(templateId: string, categoryIds: string[]) {
    try {
      const { categories } = await mutation.mutateAsync({
        params: { path: { budgetId, templateId } },
        body: { categoryIds, month: currentMonth() },
      });
      queryClient.setQueryData(categoriesQueryOptions(budgetId).queryKey, categories);
      return true;
    } catch (error) {
      toast.error(apiErrorMessage(error, "Couldn't import the template. Try again."));
      return false;
    } finally {
      await queryClient.invalidateQueries({ queryKey: categoriesQueryOptions(budgetId).queryKey });
      await invalidateMonths(queryClient);
    }
  }

  return { templates: list.data?.templates, importTemplate };
}
