import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { accountsQueryOptions } from "@/lib/accounts";
import { type ActivityEvent, type ActivityLookups, actorName, describeEvent } from "@/lib/activity";
import { $api } from "@/lib/api";
import { useBudget } from "@/lib/budget-context";
import { categoriesQueryOptions } from "@/lib/categories";
import { sessionQueryOptions } from "@/lib/session";
import { MemberAvatar } from "./member-avatar";

/** Names for an event's ids, from the budget's accounts, categories, payees and members. */
export function useActivityLookups(): ActivityLookups {
  const { budget, formatAmount, formatDate } = useBudget();
  const accounts = useQuery(accountsQueryOptions(budget.id));
  const categories = useQuery(categoriesQueryOptions(budget.id));
  // Every payee, transfer and built-in ones too, so a transfer reads "Transfer : Savings".
  const payees = $api.useQuery("get", "/v1/budgets/{budgetId}/payees", {
    params: { path: { budgetId: budget.id }, query: { include: "all" } },
  });
  const members = $api.useQuery("get", "/v1/budgets/{budgetId}/members", {
    params: { path: { budgetId: budget.id } },
  });
  return useMemo(() => {
    const byId = <T extends { id: string; name: string }>(rows: readonly T[] | undefined) =>
      new Map((rows ?? []).map((r) => [r.id, r.name]));
    const groups = categories.data?.groups ?? [];
    const accountNames = byId(accounts.data?.accounts);
    const categoryNames = byId(groups.flatMap((g) => g.categories));
    // The built-in categories aren't in any group; a transaction that needs one has Uncategorized.
    if (categories.data) {
      categoryNames.set(categories.data.uncategorizedCategoryId, "Uncategorized");
      categoryNames.set(categories.data.readyToAssignCategoryId, "Inflow: Ready to Assign");
    }
    const groupNames = byId(groups);
    const payeeNames = byId(payees.data?.payees);
    const memberNames = new Map((members.data?.members ?? []).map((m) => [m.userId, m.name]));
    return {
      account: (id) => accountNames.get(id),
      category: (id) => categoryNames.get(id),
      group: (id) => groupNames.get(id),
      payee: (id) => payeeNames.get(id),
      member: (id) => memberNames.get(id),
      formatAmount,
      formatDate,
      currency: budget.currency,
    } satisfies ActivityLookups;
  }, [accounts.data, categories.data, payees.data, members.data, formatAmount, formatDate, budget]);
}

export function ActivityList({
  events,
  dateOf,
}: {
  events: readonly ActivityEvent[];
  /** Shows each change's date before its time (lists that aren't grouped by day). */
  dateOf?: (at: string) => string;
}) {
  const lookups = useActivityLookups();
  const session = useQuery(sessionQueryOptions);
  if (events.length === 0) {
    return <p className="py-6 text-center text-muted-foreground text-sm">No changes yet.</p>;
  }
  return (
    // One bordered list with dividers, like the register and category list, not a stack of cards.
    <ol className="divide-y rounded-lg border">
      {events.map((event) => {
        const line = describeEvent(event, lookups);
        return (
          <li key={event.id} className="flex gap-3 px-4 py-3 text-sm">
            <MemberAvatar
              userId={event.actor?.userId ?? null}
              userName={event.actor ? (event.actor.name ?? "A deleted user") : null}
              avatarColor={event.actor?.avatarColor ?? null}
              removed={event.actor?.removed}
              picture={event.actor?.picture}
              agentName={event.actor?.agent?.name}
              currentUserId={session.data?.user.id}
            />
            <div className="grid min-w-0 flex-1 gap-1">
              <p>
                <strong>{actorName(event)}</strong> {line.action}
                {line.subject && <span className="text-muted-foreground"> · {line.subject}</span>}
              </p>
              {line.changes.length > 0 && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted-foreground text-xs">
                  {line.changes.map((c) => (
                    <div key={c.label} className="contents">
                      <dt>{c.label}</dt>
                      <dd className="min-w-0 break-words">
                        {c.before !== null && c.after !== null ? (
                          <>
                            <span className="line-through">{c.before}</span> →{" "}
                            <span className="text-foreground">{c.after}</span>
                          </>
                        ) : (
                          <span className="text-foreground">{c.after ?? c.before}</span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
            <time
              dateTime={event.at}
              className="shrink-0 text-muted-foreground text-xs tabular-nums"
            >
              {dateOf && `${dateOf(event.at)} `}
              {new Date(event.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
