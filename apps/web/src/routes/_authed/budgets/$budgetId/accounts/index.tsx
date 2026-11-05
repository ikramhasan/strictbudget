import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { PageTitle } from "@/components/page-title";
import { PhoneAccountList } from "@/components/phone-account-list";
import { Register } from "@/components/register";
import { REVIEW_SEARCH, ReviewBanner } from "@/components/review-banner";
import { accountsQueryOptions } from "@/lib/accounts";
import { useBudget } from "@/lib/budget-context";
import { type RegisterSearch, registerSearchSchema } from "@/lib/register-filters";
import { useViewportWidth } from "@/lib/use-viewport-width";

export const Route = createFileRoute("/_authed/budgets/$budgetId/accounts/")({
  /** `all`: a phone's All Accounts register, rather than its list of accounts. */
  validateSearch: registerSearchSchema.extend({
    all: z.boolean().optional().catch(undefined),
  }),
  component: AllAccountsPage,
});

/**
 * "All Accounts": every account's transactions in one register. A phone, which has no sidebar
 * beside it, first lists the accounts (as the sidebar does), with All Accounts at the top; a
 * search (a review banner's, say) goes straight to the register.
 */
function AllAccountsPage() {
  const { all, ...search } = Route.useSearch();
  const phone = useViewportWidth() < 768;
  if (phone && !all && !search.q) return <PhoneAccountList />;
  return <AllAccountsRegister search={search} />;
}

function AllAccountsRegister({ search }: { search: RegisterSearch }) {
  const { budget } = useBudget();
  const accounts = useQuery(accountsQueryOptions(budget.id));
  const navigate = useNavigate({ from: Route.fullPath });
  const onSearchChange = useCallback(
    (patch: Partial<RegisterSearch>, replace?: boolean) =>
      void navigate({ search: (prev) => ({ ...prev, ...patch }), replace }),
    [navigate],
  );
  const toReview = (accounts.data?.accounts ?? []).reduce((sum, a) => sum + a.toReview, 0);
  return (
    <div className="grid gap-6">
      <ReviewBanner count={toReview} onView={() => onSearchChange({ q: REVIEW_SEARCH })} />
      <PageTitle name="All accounts" />
      <PageHeader title="All Accounts" />
      <Register search={search} onSearchChange={onSearchChange} />
    </div>
  );
}
