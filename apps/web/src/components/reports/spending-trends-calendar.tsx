import { type MonthRange, money } from "@strictbudget/engine";
import { cn } from "@strictbudget/ui/lib/utils";
import { useBudget } from "@/lib/budget-context";
import { monthLabel } from "@/lib/reports";
import { type CalendarDay, calendarLevels, calendarWeeks } from "@/lib/spending-trends";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A day's fill: the muted ground, then four steps of the report blue. */
const SHADES = [
  "var(--muted)",
  "color-mix(in oklab, var(--report-1) 30%, var(--muted))",
  "color-mix(in oklab, var(--report-1) 55%, var(--muted))",
  "color-mix(in oklab, var(--report-1) 80%, var(--muted))",
  "var(--report-1)",
];

/** Every day of the range as a square, weeks across and weekdays down, shaded by what was spent. */
export function SpendingCalendar({
  range,
  days,
  today,
  onPick,
}: {
  range: MonthRange;
  days: ReadonlyMap<string, { total: bigint; count: number }>;
  today: string;
  onPick: (day: CalendarDay) => void;
}) {
  const { budget, formatAmount, formatDate } = useBudget();
  const { weeks, months } = calendarWeeks(range, days, today);
  const all = weeks.flat().filter((d): d is CalendarDay => d !== null);
  const level = calendarLevels(all);
  const describe = (d: CalendarDay) =>
    `${formatDate(d.date)}: ${formatAmount(money(d.total, budget.currency))}` +
    (d.count ? ` · ${d.count} ${d.count === 1 ? "transaction" : "transactions"}` : "");
  return (
    <div className="grid gap-2">
      <div className="overflow-x-auto pb-1">
        <div
          className="grid w-max gap-[3px]"
          style={{
            gridTemplateColumns: `auto repeat(${weeks.length}, 0.875rem)`,
            gridTemplateRows: "auto repeat(7, 0.875rem)",
          }}
        >
          <span />
          {weeks.map((_, w) => {
            const start = months.find((m) => m.week === w);
            return (
              <span key={w} className="relative h-4 text-[10px] text-muted-foreground">
                {start && (
                  <span className="absolute left-0 whitespace-nowrap">
                    {monthLabel(start.month).slice(0, 3)}
                  </span>
                )}
              </span>
            );
          })}
          {WEEKDAYS.map((name, row) => (
            <Row
              key={name}
              name={name}
              row={row}
              weeks={weeks}
              level={level}
              describe={describe}
              onPick={onPick}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1 text-muted-foreground text-xs">
        Less
        {SHADES.map((s) => (
          <span key={s} aria-hidden className="size-3 rounded-[2px]" style={{ background: s }} />
        ))}
        More
      </div>
    </div>
  );
}

function Row({
  name,
  row,
  weeks,
  level,
  describe,
  onPick,
}: {
  name: string;
  row: number;
  weeks: (CalendarDay | null)[][];
  level: (d: CalendarDay) => number;
  describe: (d: CalendarDay) => string;
  onPick: (day: CalendarDay) => void;
}) {
  return (
    <>
      <span className="pr-1 text-[10px] text-muted-foreground leading-[0.875rem]">
        {row % 2 === 1 ? name : ""}
      </span>
      {weeks.map((week, w) => {
        const day = week[row];
        if (!day) {
          return <span key={w} />;
        }
        const label = describe(day);
        return (
          <button
            key={day.date}
            type="button"
            aria-label={label}
            title={label}
            disabled={day.count === 0}
            onClick={() => onPick(day)}
            className={cn(
              "size-3.5 rounded-[2px] outline-offset-1 enabled:cursor-pointer enabled:hover:outline enabled:hover:outline-foreground focus-visible:outline-2 focus-visible:outline-ring",
              day.future && "opacity-40",
              day.total < 0n && "ring-1 ring-emerald-500 ring-inset",
            )}
            style={{ background: SHADES[level(day)] }}
          />
        );
      })}
    </>
  );
}
