import {
  type BudgetMonth,
  type MonthRange,
  monthsIn,
  presetRange,
  REPORT_PRESETS,
  type ReportPreset,
  shiftRange,
} from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import { Label } from "@strictbudget/ui/components/label";
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import { RadioGroup, RadioGroupItem } from "@strictbudget/ui/components/radio-group";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { monthLabel, PRESET_LABELS, rangeLabel } from "@/lib/reports";

export type RangeChange = { range: ReportPreset } | { from: BudgetMonth; to: BudgetMonth };

/** The arrows move the whole range by its length; Next stops at the current month. */
export function RangePicker({
  range,
  preset,
  current,
  earliest,
  onChange,
}: {
  range: MonthRange;
  preset: ReportPreset | undefined;
  current: BudgetMonth;
  earliest: BudgetMonth | null;
  onChange: (change: RangeChange) => void;
}) {
  const [open, setOpen] = useState(false);
  const length = monthsIn(range).length;
  const move = (count: number) => {
    const next = shiftRange(range, count);
    onChange({ from: next.from, to: next.to });
  };
  return (
    <div className="flex items-center rounded-md border">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Previous date range"
        disabled={earliest !== null && range.from <= earliest}
        onClick={() => move(-length)}
      >
        <ChevronLeft />
      </Button>
      <Button variant="ghost" className="gap-2 px-2" onClick={() => setOpen(true)}>
        <CalendarDays className="size-4" />
        <span className="tabular-nums">{rangeLabel(range)}</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Next date range"
        disabled={range.to >= current}
        onClick={() => move(length)}
      >
        <ChevronRight />
      </Button>
      {open && (
        <RangeDialog
          range={range}
          preset={preset}
          current={current}
          earliest={earliest}
          onClose={() => setOpen(false)}
          onApply={(change) => {
            setOpen(false);
            onChange(change);
          }}
        />
      )}
    </div>
  );
}

function RangeDialog({
  range,
  preset,
  current,
  earliest,
  onClose,
  onApply,
}: {
  range: MonthRange;
  preset: ReportPreset | undefined;
  current: BudgetMonth;
  earliest: BudgetMonth | null;
  onClose: () => void;
  onApply: (change: RangeChange) => void;
}) {
  const [choice, setChoice] = useState<ReportPreset | "custom">(preset ?? "custom");
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  // Custom months run from the budget's first month with a transaction (or a year back) to now.
  const months = monthsIn({
    from: earliest && earliest < current ? earliest : presetRange("last_12_months", current).from,
    to: current,
  }).reverse();
  const pick = (value: string) => {
    const next = value as ReportPreset | "custom";
    setChoice(next);
    if (next !== "custom") {
      const r = presetRange(next, current, earliest);
      setFrom(r.from);
      setTo(r.to);
    }
  };
  const valid = from <= to;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Date range</DialogTitle>
        </DialogHeader>
        <RadioGroup value={choice} onValueChange={pick} className="grid gap-2">
          {[...REPORT_PRESETS, "custom" as const].map((p) => (
            <Label key={p} className="flex items-center gap-2 font-normal">
              <RadioGroupItem value={p} />
              {p === "custom" ? "Custom" : PRESET_LABELS[p]}
            </Label>
          ))}
        </RadioGroup>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ["Start Date", from, setFrom],
              ["End Date", to, setTo],
            ] as const
          ).map(([label, value, set]) => (
            <Label key={label} className="grid gap-1 font-normal">
              <span className="text-muted-foreground text-xs">{label}</span>
              <NativeSelect
                value={value}
                onChange={(e) => {
                  set(e.target.value as BudgetMonth);
                  setChoice("custom");
                }}
              >
                {months.map((m) => (
                  <NativeSelectOption key={m} value={m}>
                    {monthLabel(m)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Label>
          ))}
        </div>
        {!valid && (
          <p className="text-destructive text-sm">The start date must be before the end date.</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() => onApply(choice === "custom" ? { from, to } : { range: choice })}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
