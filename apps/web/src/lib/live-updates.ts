import { type Query, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/**
 * This browser tab, sent with every request (`X-Client-Id`) so the budget's event stream can
 * tell the tab which changes were its own. `getRandomValues`, not `randomUUID`: the latter only
 * exists on https or localhost, and the app is also opened over plain http (e.g. on a tailnet).
 */
export const CLIENT_ID = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
  b.toString(16).padStart(2, "0"),
).join("");

/** How long to gather a burst of changes (a bulk edit, a partner typing) into one refetch. */
const SETTLE_MS = 300;

/** Whether a query shows this budget's data: its key names the budget (or lists budgets). */
export function isBudgetQuery(query: Pick<Query, "queryKey">, budgetId: string): boolean {
  const [method, path] = query.queryKey;
  if (method === "get" && path === "/v1/budgets") return true;
  return JSON.stringify(query.queryKey).includes(budgetId);
}

/**
 * Listens to the budget's event stream and refetches what's on screen when someone else changes
 * the budget. Changes this tab made are skipped (it already refreshes after its own). EventSource
 * reconnects by itself; a reconnect refetches too, in case something was missed while offline.
 */
export function useBudgetEvents(budgetId: string, baseUrl: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refetch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ predicate: (q) => isBudgetQuery(q, budgetId) });
      }, SETTLE_MS);
    };
    const source = new EventSource(`${baseUrl}/v1/budgets/${budgetId}/events`, {
      withCredentials: true,
    });
    let opened = false;
    source.addEventListener("open", () => {
      if (opened) refetch();
      opened = true;
    });
    // Closed for good (the budget was deleted or the user removed from it, so reconnecting got a
    // 404): refetch, so the page shows that instead of a budget that isn't there any more.
    source.addEventListener("error", () => {
      if (source.readyState === EventSource.CLOSED) refetch();
    });
    source.addEventListener("change", (event) => {
      try {
        const { clientId } = JSON.parse((event as MessageEvent<string>).data) as {
          clientId: string | null;
        };
        if (clientId === CLIENT_ID) return;
      } catch {
        // An unreadable event still means something changed.
      }
      refetch();
    });
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [budgetId, baseUrl, queryClient]);
}
