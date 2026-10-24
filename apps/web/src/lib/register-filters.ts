import { z } from "zod";
import { formatSort } from "./register-sort";
import { type RegisterView, rangeDates } from "./register-view";

/**
 * The register's search (see `parseSearch`), kept in the page address so it survives a reload. The
 * View menu's options and the sort are per register instead (see `useRegisterView`). Bad values are
 * dropped rather than failing the page.
 */
export const registerSearchSchema = z.object({
  q: z.string().optional().catch(undefined),
});

export type RegisterSearch = z.infer<typeof registerSearchSchema>;

/** The search text without its trailing comma. */
export function searchText(search: RegisterSearch) {
  return (search.q ?? "").trim().replace(/,\s*$/, "").trim();
}

export function registerQuery(
  accountId: string | undefined,
  search: RegisterSearch,
  view: RegisterView,
) {
  const q = searchText(search);
  return {
    ...(accountId ? { accountId } : {}),
    ...(q ? { q } : {}),
    ...rangeDates(view),
    ...(view.showReconciled ? {} : { hideReconciled: "true" as const }),
    sort: formatSort(view.sort),
  };
}
