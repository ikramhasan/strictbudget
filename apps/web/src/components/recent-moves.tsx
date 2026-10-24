import type { BudgetMonth } from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@strictbudget/ui/components/popover";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { ToggleGroup, ToggleGroupItem } from "@strictbudget/ui/components/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@strictbudget/ui/components/tooltip";
import { useQuery } from "@tanstack/react-query";
import { format as formatDay } from "date-fns";
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  History,
  MinusCircle,
  PlusCircle,
  Trash2,
  Zap,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { $api } from "@/lib/api";
import type { CategoryList } from "@/lib/categories";
import { todayIso } from "@/lib/dates";
import { monthLabel } from "@/lib/months";
import {
  type MoneyMove,
  type MoveEntry,
  matchesMember,
  memberFilterOptions,
  moveEntries,
  movesQueryOptions,
} from "@/lib/moves";
import { sessionQueryOptions } from "@/lib/session";
import { autoAssignMethodLabel } from "./auto-assign";
import { MemberAvatar } from "./member-avatar";

type Filter = "all" | "moved" | "assigned";

/** Opens a category in a month: the budget screen goes there and selects it alone. */
export type OpenCategory = (categoryId: string, month: BudgetMonth) => void;

/**
 * Every change to assigned money of the last 34 days, newest first, by day. "Moved" includes what
 * deleting a category moved. A deleted category keeps its name.
 */
export function RecentMoves({
  budgetId,
  categories,
  format,
  formatDate,
  onOpenCategory,
}: {
  budgetId: string;
  categories: CategoryList;
  format: (minorUnits: string) => string;
  formatDate: (isoDate: string) => string;
  onOpenCategory: OpenCategory;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [member, setMember] = useState("");
  const moves = useQuery({ ...movesQueryOptions(budgetId), enabled: open });
  const members = $api.useQuery(
    "get",
    "/v1/budgets/{budgetId}/members",
    { params: { path: { budgetId } } },
    { enabled: open },
  );
  const session = useQuery(sessionQueryOptions);
  const all = moves.data?.moves ?? [];
  const memberOptions = memberFilterOptions(all, members.data?.members ?? []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Recent Moves">
              <History />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          Recent Moves: the previous 34 days of assigning and moving money
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(26rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <div className="grid gap-1">
            <h2 className="font-semibold">Recent Moves</h2>
            {memberOptions.length >= 2 && (
              <NativeSelect
                size="sm"
                aria-label="Member"
                value={member}
                onChange={(e) => setMember(e.target.value)}
              >
                <NativeSelectOption value="">Everyone</NativeSelectOption>
                {memberOptions.map((o) => (
                  <NativeSelectOption key={o.value} value={o.value}>
                    {o.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </div>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={filter}
            onValueChange={(v) => v && setFilter(v as Filter)}
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="moved">Moved</ToggleGroupItem>
            <ToggleGroupItem value="assigned">Assigned</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="grid max-h-96 gap-3 overflow-y-auto bg-muted/40 p-3">
          {moves.isPending ? (
            <Spinner className="mx-auto" />
          ) : (
            <RecentMovesList
              moves={member ? all.filter((m) => matchesMember(m, member)) : all}
              filter={filter}
              categories={categories}
              format={format}
              formatDate={formatDate}
              currentUserId={session.data?.user.id}
              onOpenCategory={(id, month) => {
                setOpen(false);
                onOpenCategory(id, month);
              }}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const isMovedEntry = (e: MoveEntry) =>
  e.type === "move" && (e.move.kind === "moved" || e.move.deletion);

/** The moves grouped by day ("Pat assigned $30.00 to Rent"). */
export function RecentMovesList({
  moves,
  filter,
  categories,
  format,
  formatDate,
  currentUserId,
  onOpenCategory,
}: {
  moves: readonly MoneyMove[];
  filter: Filter;
  categories: CategoryList;
  format: (minorUnits: string) => string;
  formatDate: (isoDate: string) => string;
  currentUserId: string | undefined;
  onOpenCategory: OpenCategory;
}) {
  const names = useMemo(
    () => new Map(categories.groups.flatMap((g) => g.categories.map((c) => [c.id, c.name]))),
    [categories],
  );
  const days = useMemo(() => {
    const byDay = new Map<string, MoveEntry[]>();
    for (const e of moveEntries(moves)) {
      if (filter === "moved" && !isMovedEntry(e)) continue;
      if (filter === "assigned" && isMovedEntry(e)) continue;
      const day = formatDay(new Date(e.move.movedAt), "yyyy-MM-dd");
      byDay.set(day, [...(byDay.get(day) ?? []), e]);
    }
    return [...byDay];
  }, [moves, filter]);

  if (days.length === 0) {
    return <p className="text-center text-muted-foreground text-sm">No moves yet.</p>;
  }

  /** A category with its month; a live category opens it in that month. */
  const pill = (id: string | null, deleted: string | null, month: BudgetMonth) => {
    const body = (
      <>
        {deleted ?? (id ? (names.get(id) ?? "Deleted category") : "Ready to Assign")}
        <span className="text-[0.65rem] text-muted-foreground uppercase">{monthLabel(month)}</span>
      </>
    );
    const style =
      "inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-foreground";
    return (
      <>
        {deleted && "deleted category "}
        {id && !deleted && names.has(id) ? (
          <button
            type="button"
            className={`${style} hover:bg-primary/20 focus-visible:outline-2 focus-visible:outline-ring`}
            onClick={() => onOpenCategory(id, month)}
          >
            {body}
          </button>
        ) : (
          <span className={style}>{body}</span>
        )}
      </>
    );
  };

  return days.map(([day, list]) => (
    <section key={day} className="grid gap-2">
      <h3 className="flex justify-between font-medium text-sm">
        <span>{formatDate(day)}</span>
        {day === todayIso() && <span className="font-normal text-muted-foreground">Today</span>}
      </h3>
      {list.map((e) => (
        <EntryCard
          key={e.move.id}
          entry={e}
          pill={pill}
          format={format}
          currentUserId={currentUserId}
        />
      ))}
    </section>
  ));
}

function EntryCard({
  entry,
  pill,
  format,
  currentUserId,
}: {
  entry: MoveEntry;
  pill: (id: string | null, deleted: string | null, month: BudgetMonth) => ReactNode;
  format: (minorUnits: string) => string;
  currentUserId: string | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const m = entry.move;
  /** "ihni7 assigned", or just "Assigned" when the mover's user is gone. */
  const who = (verb: string) =>
    m.userName ? `${m.userName} ${verb}` : verb.charAt(0).toUpperCase() + verb.slice(1);
  const line = (direction: "from" | "to", content: ReactNode) => (
    <span className="text-muted-foreground">
      {direction} {content}
    </span>
  );

  let icon: ReactNode;
  let body: ReactNode;
  if (entry.type === "autoAssign") {
    icon = <Zap className="mt-0.5 size-4 shrink-0" aria-label="Auto-Assign" />;
    const direction = entry.verb === "removed" ? "from" : "to";
    const [only] = entry.moves;
    body = (
      <>
        <span>
          {who(entry.verb)}{" "}
          <strong className="tabular-nums">{format(entry.total.toString())}</strong>
        </span>
        {entry.moves.length === 1 && only ? (
          // One category: named, with no method or details.
          line(
            direction,
            direction === "to"
              ? pill(only.toCategoryId, only.toDeletedCategory, only.month)
              : pill(only.fromCategoryId, only.fromDeletedCategory, only.month),
          )
        ) : (
          <>
            <span className="text-muted-foreground">
              {direction} <strong className="text-foreground">{entry.moves.length}</strong>{" "}
              categories
            </span>
            <span className="text-muted-foreground text-xs">
              Method: {autoAssignMethodLabel(entry.method)}
            </span>
            <button
              type="button"
              aria-expanded={expanded}
              className="flex w-fit items-center gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              Details
            </button>
            {expanded && (
              <ul className="grid gap-1.5" aria-label="Details">
                {entry.parts.map(({ move: part, amount }) => (
                  <li key={part.id} className="flex items-center justify-between gap-2">
                    {part.kind === "removed"
                      ? pill(part.fromCategoryId, part.fromDeletedCategory, part.month)
                      : pill(part.toCategoryId, part.toDeletedCategory, part.month)}
                    <span className="tabular-nums">{format(amount.toString())}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </>
    );
  } else {
    icon = m.deletion ? (
      <Trash2 className="mt-0.5 size-4 shrink-0" aria-label="Category deleted" />
    ) : m.kind === "moved" ? (
      <ArrowLeftRight className="mt-0.5 size-4 shrink-0" aria-label="Moved" />
    ) : m.kind === "assigned" ? (
      <PlusCircle className="mt-0.5 size-4 shrink-0" aria-label="Assigned" />
    ) : (
      <MinusCircle className="mt-0.5 size-4 shrink-0" aria-label="Removed" />
    );
    body = (
      <>
        <span>
          {who(m.kind)} <strong className="tabular-nums">{format(m.amount)}</strong>
        </span>
        {m.kind !== "assigned" &&
          line("from", pill(m.fromCategoryId, m.fromDeletedCategory, m.month))}
        {m.kind !== "removed" && line("to", pill(m.toCategoryId, m.toDeletedCategory, m.month))}
      </>
    );
  }

  return (
    <div className="flex gap-2 rounded-md border bg-card p-2 text-sm">
      {icon}
      <div className="grid min-w-0 flex-1 gap-1">{body}</div>
      <MemberAvatar
        userId={m.userId}
        userName={m.userName}
        avatarColor={m.avatarColor}
        picture={m.picture}
        currentUserId={currentUserId}
      />
    </div>
  );
}
