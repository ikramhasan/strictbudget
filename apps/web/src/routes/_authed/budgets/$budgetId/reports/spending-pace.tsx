import { addMonths, type BudgetMonth, money, monthOf } from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@strictbudget/ui/components/native-select";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { Switch } from "@strictbudget/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@strictbudget/ui/components/table";
import { cn } from "@strictbudget/ui/lib/utils";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { ChartCard } from "@/components/reports/chart-card";
import { ReportPage } from "@/components/reports/report-page";
import { SpendingPaceChart, SpendingPaceTable } from "@/components/reports/spending-pace-chart";
import { $api } from "@/lib/api";
import { useBudget } from "@/lib/budget-context";
import { todayIso } from "@/lib/dates";
import { monthLabel } from "@/lib/reports";
import {
  type PaceCategory,
  paceCallout,
  REASON_LABELS,
  type SpendingPace,
  STATUS_LABELS,
  STATUS_TONES,
  spendingPaceOptions,
  spendingPaceSearchSchema,
} from "@/lib/spending-pace";

export const Route = createFileRoute("/_authed/budgets/$budgetId/reports/spending-pace")({
  validateSearch: spendingPaceSearchSchema,
  component: Report,
});

/**
 * This month's money left to spend, day by day, against an even pace to zero, with where the pace
 * so far ends up and each category's pace. Past months show their finished burndown; future months
 * have none.
 */
function Report() {
  const { budget, formatAmount } = useBudget();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const current = monthOf(todayIso());
  const month: BudgetMonth = search.month && search.month <= current ? search.month : current;
  const view = search.view ?? "chart";
  const query = useQuery({
    ...spendingPaceOptions(budget.id, {
      month,
      groupId: search.category ? undefined : search.group,
      categoryId: search.category,
    }),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const format = (amount: bigint) => formatAmount(money(amount, budget.currency));
  const setSearch = (next: Partial<typeof search>) =>
    navigate({ search: (s) => ({ ...s, ...next }), replace: true });

  return (
    <ReportPage
      title="Spending Pace"
      filters={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous month"
              onClick={() => setSearch({ month: addMonths(month, -1) })}
            >
              <ChevronLeft />
            </Button>
            <span className="min-w-28 text-center font-medium text-sm tabular-nums">
              {monthLabel(month, "long")}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next month"
              disabled={month >= current}
              onClick={() => {
                const next = addMonths(month, 1);
                setSearch({ month: next >= current ? undefined : next });
              }}
            >
              <ChevronRight />
            </Button>
          </div>
          <LinePicker
            data={data}
            value={
              search.category ? `c:${search.category}` : search.group ? `g:${search.group}` : ""
            }
            onChange={(v) =>
              setSearch({
                category: v.startsWith("c:") ? v.slice(2) : undefined,
                group: v.startsWith("g:") ? v.slice(2) : undefined,
              })
            }
          />
        </div>
      }
    >
      {query.isError ? (
        <p className="text-muted-foreground text-sm">Couldn't load the spending pace.</p>
      ) : !data ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <>
          <Headline data={data} format={format} />
          <ChartCard
            title={data.finished ? "How the month went" : "Left to spend"}
            view={view}
            onViewChange={(v) => setSearch({ view: v })}
            loading={query.isPending}
            empty={
              BigInt(data.line.start) === 0n && BigInt(data.line.spent) === 0n
                ? "Nothing assigned or spent here this month."
                : undefined
            }
            fileName={`spending-pace-${month}`}
            chart={
              <div className="grid gap-2">
                <SpendingPaceChart
                  line={data.line}
                  elapsed={data.elapsed}
                  finished={data.finished}
                />
                <Legend finished={data.finished} />
              </div>
            }
            table={<SpendingPaceTable line={data.line} />}
          />
          <CategoryPace data={data} format={format} />
        </>
      )}
    </ReportPage>
  );
}

/** Whole plan, a group (its categories in pace) or one category. */
function LinePicker({
  data,
  value,
  onChange,
}: {
  data: SpendingPace | undefined;
  value: string;
  onChange: (value: string) => void;
}) {
  const groups = new Map<string, { name: string; categories: PaceCategory[] }>();
  for (const c of data?.categories ?? []) {
    const g = groups.get(c.groupId) ?? { name: c.groupName, categories: [] };
    g.categories.push(c);
    groups.set(c.groupId, g);
  }
  return (
    <NativeSelect
      aria-label="Show the pace of"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="max-w-full"
    >
      <NativeSelectOption value="">Whole plan</NativeSelectOption>
      <NativeSelectOptGroup label="Groups">
        {[...groups].map(([id, g]) => (
          <NativeSelectOption key={id} value={`g:${id}`}>
            {g.name}
          </NativeSelectOption>
        ))}
      </NativeSelectOptGroup>
      {[...groups].map(([id, g]) => (
        <NativeSelectOptGroup key={id} label={g.name}>
          {g.categories.map((c) => (
            <NativeSelectOption key={c.categoryId} value={`c:${c.categoryId}`}>
              {c.name}
            </NativeSelectOption>
          ))}
        </NativeSelectOptGroup>
      ))}
    </NativeSelect>
  );
}

function Headline({ data, format }: { data: SpendingPace; format: (amount: bigint) => string }) {
  const line = data.line;
  const passed = Math.round((data.elapsed * 100) / data.days);
  const stats = [
    { label: "To spend this month", value: format(BigInt(line.start)) },
    { label: data.finished ? "Spent" : "Spent so far", value: format(BigInt(line.spent)) },
    { label: "Left", value: format(BigInt(line.remaining)) },
    ...(line.safePerDay === null
      ? []
      : [{ label: "Safe to spend per day", value: format(BigInt(line.safePerDay)) }]),
  ];
  return (
    <section aria-label="Pace" className="grid gap-3 rounded-lg border p-4">
      <p
        className={cn(
          "font-semibold text-lg",
          line.status && line.status !== "on_pace" && STATUS_TONES[line.status],
        )}
      >
        {paceCallout(line, data.finished, format)}
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="grid gap-0.5">
            <dt className="text-muted-foreground text-xs">{s.label}</dt>
            <dd className="font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>
      {!data.finished && (
        <p className="text-muted-foreground text-xs tabular-nums">
          {passed}% of the month passed,{" "}
          {line.usedPercent === null ? "–" : `${Math.round(line.usedPercent)}%`} of the money used.
        </p>
      )}
    </section>
  );
}

function Legend({ finished }: { finished: boolean }) {
  const items = [
    { label: "Left to spend", style: { background: "var(--report-1)" } },
    { label: "Even pace", style: { borderTop: "2px dashed var(--muted-foreground)" } },
    ...(finished
      ? []
      : [{ label: "At this pace", style: { borderTop: "2px dashed var(--report-4)" } }]),
  ];
  return (
    <p className="flex flex-wrap gap-3 text-muted-foreground text-xs">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1">
          <span className="h-0.5 w-4" style={i.style} />
          {i.label}
        </span>
      ))}
    </p>
  );
}

/** Each category's pace, those in pace first; a switch keeps a category in or out. */
function CategoryPace({
  data,
  format,
}: {
  data: SpendingPace;
  format: (amount: bigint) => string;
}) {
  const { budget, readOnly } = useBudget();
  const queryClient = useQueryClient();
  const setPace = $api.useMutation(
    "put",
    "/v1/budgets/{budgetId}/reports/spending-pace/categories/{categoryId}",
  );
  const toggle = async (c: PaceCategory, included: boolean) => {
    // Back to the automatic rule when it already says so; otherwise an explicit setting.
    const automatic = c.reason === null;
    const pace = included === automatic ? null : included ? "include" : "exclude";
    try {
      await setPace.mutateAsync({
        params: { path: { budgetId: budget.id, categoryId: c.categoryId } },
        body: { pace },
      });
      await queryClient.invalidateQueries({
        queryKey: ["get", "/v1/budgets/{budgetId}/reports/spending-pace"],
      });
    } catch {
      toast.error("Couldn't change the category's pace.");
    }
  };
  const sorted = [...data.categories].sort((a, b) => Number(b.included) - Number(a.included));
  const passed = (data.elapsed * 100) / data.days;
  if (sorted.length === 0) return null;
  return (
    <section aria-labelledby="pace-categories" className="grid gap-3 rounded-lg border p-4">
      <div className="grid gap-1">
        <h2 id="pace-categories" className="font-semibold">
          By category
        </h2>
        <p className="text-muted-foreground text-xs">
          Bills (a target with a due date), savings (a balance target), categories with a scheduled
          transaction and hidden ones are left out of the plan's pace by default, so a one-off
          payment doesn't read as behind all month. Switch a category to count it or not.
        </p>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Spent</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Used</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">{data.finished ? "Left" : "Per day"}</TableHead>
              <TableHead className="text-right">In pace</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((c) => (
              <TableRow key={c.categoryId} className={cn(!c.included && "text-muted-foreground")}>
                <TableCell>
                  <span className="grid">
                    <span>{c.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {c.groupName}
                      {c.reason && ` · ${REASON_LABELS[c.reason]}`}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {format(BigInt(c.pace.spent))}
                  <span className="block text-muted-foreground text-xs">
                    of {format(BigInt(c.pace.start))}
                  </span>
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">
                  {c.pace.usedPercent === null ? "–" : `${Math.round(c.pace.usedPercent)}%`}
                  {!data.finished && (
                    <span className="block text-muted-foreground text-xs">
                      {Math.round(passed)}% passed
                    </span>
                  )}
                </TableCell>
                <TableCell className={cn(c.pace.status && STATUS_TONES[c.pace.status])}>
                  {c.pace.status ? STATUS_LABELS[c.pace.status] : "–"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {format(BigInt(data.finished ? c.pace.remaining : (c.pace.safePerDay ?? "0")))}
                </TableCell>
                <TableCell className="text-right">
                  <Switch
                    aria-label={`Count ${c.name} in the plan's pace`}
                    checked={c.included}
                    disabled={readOnly || setPace.isPending}
                    onCheckedChange={(on) => toggle(c, on)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
