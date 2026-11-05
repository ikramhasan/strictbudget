import { addMonths, type BudgetMonth } from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@strictbudget/ui/components/popover";
import { cn } from "@strictbudget/ui/lib/utils";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { monthLabel } from "@/lib/months";

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function MonthNav({
  month,
  current,
  first,
  last,
  onChange,
}: {
  month: BudgetMonth;
  current: BudgetMonth;
  first: BudgetMonth;
  last: BudgetMonth;
  onChange: (month: BudgetMonth) => void;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number(month.slice(0, 4)));
  const inRange = (m: BudgetMonth) => m >= first && m <= last;
  const previous = addMonths(month, -1);
  const next = addMonths(month, 1);

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon-sm"
        className="rounded-full"
        aria-label="Previous month"
        disabled={!inRange(previous)}
        onClick={() => onChange(previous)}
      >
        <ChevronLeft />
      </Button>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) setYear(Number(month.slice(0, 4)));
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="ghost" className="px-2 text-title tabular-nums">
            {monthLabel(month)}
            <ChevronDown />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous year"
              disabled={`${year - 1}-12` < first}
              onClick={() => setYear((y) => y - 1)}
            >
              <ChevronLeft />
            </Button>
            <span className="font-semibold tabular-nums">{year}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next year"
              disabled={`${year + 1}-01` > last}
              onClick={() => setYear((y) => y + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
          <div className="grid grid-cols-4 gap-1 border-t pt-2">
            {MONTH_NAMES.map((name, i) => {
              const m = `${year}-${String(i + 1).padStart(2, "0")}`;
              return (
                <Button
                  key={m}
                  variant={m === month ? "default" : "ghost"}
                  size="sm"
                  disabled={!inRange(m)}
                  aria-label={monthLabel(m)}
                  aria-current={m === month ? "date" : undefined}
                  onClick={() => {
                    setOpen(false);
                    onChange(m);
                  }}
                >
                  {name}
                </Button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      <Button
        variant="outline"
        size="icon-sm"
        className="rounded-full"
        aria-label="Next month"
        disabled={!inRange(next)}
        onClick={() => onChange(next)}
      >
        <ChevronRight />
      </Button>
      {/* Always there, hidden on the current month, so the controls never shift. */}
      <Button
        variant="secondary"
        size="sm"
        // On a phone's crowded bar it takes no room on the current month.
        className={cn("ml-1", month === current && "invisible max-md:hidden")}
        aria-hidden={month === current || undefined}
        tabIndex={month === current ? -1 : undefined}
        onClick={() => onChange(current)}
      >
        Today
      </Button>
    </div>
  );
}
