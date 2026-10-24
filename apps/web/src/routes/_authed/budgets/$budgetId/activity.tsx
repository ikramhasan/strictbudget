import { Button } from "@strictbudget/ui/components/button";
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { format as formatDay } from "date-fns";
import { useMemo, useState } from "react";
import { ActivityList } from "@/components/activity-list";
import { PageHeader } from "@/components/page-header";
import { PageTitle } from "@/components/page-title";
import { ACTIVITY_ENTITIES, type ActivityEvent, activityQueryPrefix } from "@/lib/activity";
import { $api, apiClient } from "@/lib/api";
import { useBudget } from "@/lib/budget-context";

export const Route = createFileRoute("/_authed/budgets/$budgetId/activity")({
  component: ActivityPage,
});

/**
 * Everything that changed in the budget, who changed it and when: newest first by day, filtered by
 * member and by what changed.
 */
function ActivityPage() {
  const { budget, formatDate } = useBudget();
  const [member, setMember] = useState("");
  const [entity, setEntity] = useState("");
  const members = $api.useQuery("get", "/v1/budgets/{budgetId}/members", {
    params: { path: { budgetId: budget.id } },
  });
  const filter = { ...(member ? { member } : {}), ...(entity ? { entity } : {}) };
  const activity = useInfiniteQuery({
    queryKey: [...activityQueryPrefix, budget.id, filter],
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await apiClient.GET("/v1/budgets/{budgetId}/activity", {
        params: {
          path: { budgetId: budget.id },
          query: { ...filter, limit: 50, ...(pageParam ? { cursor: pageParam } : {}) },
        },
        signal,
      });
      if (error) throw error;
      return data;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const days = useMemo(() => {
    const byDay = new Map<string, ActivityEvent[]>();
    for (const e of activity.data?.pages.flatMap((p) => p.events) ?? []) {
      const day = formatDay(new Date(e.at), "yyyy-MM-dd");
      byDay.set(day, [...(byDay.get(day) ?? []), e]);
    }
    return [...byDay];
  }, [activity.data]);

  return (
    // The app shell pads the page; the page width matches the others, the feed stays readable.
    <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,48rem)] content-start gap-4">
      <PageTitle name="Activity" />
      <PageHeader
        title="Activity"
        meta={
          <span className="hidden truncate text-muted-foreground text-sm md:inline">
            Every change to {budget.name}, who made it and when.
          </span>
        }
      />
      <div className="flex flex-wrap gap-2">
        <NativeSelect
          size="sm"
          aria-label="Member"
          value={member}
          onChange={(e) => setMember(e.target.value)}
        >
          <NativeSelectOption value="">Everyone</NativeSelectOption>
          {members.data?.members.map((m) => (
            <NativeSelectOption key={m.userId} value={m.userId}>
              {m.name}
            </NativeSelectOption>
          ))}
          <NativeSelectOption value="none">Scheduled and automatic</NativeSelectOption>
        </NativeSelect>
        <NativeSelect
          size="sm"
          aria-label="What changed"
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
        >
          <NativeSelectOption value="">All changes</NativeSelectOption>
          {ACTIVITY_ENTITIES.map((o) => (
            <NativeSelectOption key={o.value} value={o.value}>
              {o.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {activity.isPending ? (
        <Spinner className="mx-auto" />
      ) : days.length === 0 ? (
        <ActivityList events={[]} />
      ) : (
        days.map(([day, events]) => (
          <section key={day} className="grid gap-2" aria-label={formatDate(day)}>
            <h2 className="font-medium text-sm">{formatDate(day)}</h2>
            <ActivityList events={events} />
          </section>
        ))
      )}
      {activity.hasNextPage && (
        <Button
          variant="outline"
          className="justify-self-center"
          disabled={activity.isFetchingNextPage}
          onClick={() => activity.fetchNextPage()}
        >
          {activity.isFetchingNextPage && <Spinner />} Load more
        </Button>
      )}
    </div>
  );
}
