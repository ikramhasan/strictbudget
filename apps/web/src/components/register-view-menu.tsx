import { Button } from "@strictbudget/ui/components/button";
import { Checkbox } from "@strictbudget/ui/components/checkbox";
import { Label } from "@strictbudget/ui/components/label";
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@strictbudget/ui/components/popover";
import { cn } from "@strictbudget/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { todayIso } from "@/lib/dates";
import {
  addMonths,
  DATE_RANGE_LABELS,
  DATE_RANGES,
  type RegisterView,
  rangeMonths,
} from "@/lib/register-view";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** A preset date range applies at once; picking months waits for Apply. */
export function RegisterViewMenu({
  view,
  onChange,
  runningBalance,
  oldestMonth,
}: {
  view: RegisterView;
  onChange: (patch: Partial<RegisterView>) => void;
  /** Offer "Show Running Balance" (account registers; All Accounts has none). */
  runningBalance: boolean;
  /** The month of the budget's oldest transaction (YYYY-MM), where All Dates starts. */
  oldestMonth?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(view);
  const id = useId();
  const thisMonth = todayIso().slice(0, 7);
  // All Dates runs from the month of the budget's oldest transaction (any account) to ten years
  // past this month.
  const months = rangeMonths(draft);
  const from = months.from ?? oldestMonth ?? thisMonth;
  const to = months.to ?? addMonths(thisMonth, 120);
  const thisYear = Number(thisMonth.slice(0, 4));
  const years = Array.from({ length: 26 }, (_, i) => thisYear - 15 + i);

  function setMonth(which: "from" | "to", part: "month" | "year", value: string) {
    const current = which === "from" ? from : to;
    const [y, m] = current.split("-");
    const next = part === "month" ? `${y}-${value}` : `${value}-${m}`;
    setDraft((d) => ({ ...d, range: "custom", from, to, [which]: next }));
  }

  function monthPicker(which: "from" | "to") {
    const value = which === "from" ? from : to;
    const label = which === "from" ? "From" : "To";
    return (
      <>
        <NativeSelect
          aria-label={`${label} month`}
          value={value.slice(5, 7)}
          onChange={(e) => setMonth(which, "month", e.target.value)}
          className="h-8"
        >
          {MONTHS.map((name, i) => (
            <NativeSelectOption key={name} value={String(i + 1).padStart(2, "0")}>
              {name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={`${label} year`}
          value={value.slice(0, 4)}
          onChange={(e) => setMonth(which, "year", e.target.value)}
          className="h-8"
        >
          {years.map((y) => (
            <NativeSelectOption key={y} value={String(y)}>
              {y}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </>
    );
  }

  function checkbox(
    key:
      | "showReconciled"
      | "showRunningBalance"
      | "showFlags"
      | "showAttachments"
      | "showEnteredBy",
    label: string,
  ) {
    return (
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${id}-${key}`}
          checked={draft[key]}
          onCheckedChange={(checked) => setDraft((d) => ({ ...d, [key]: checked === true }))}
        />
        <Label htmlFor={`${id}-${key}`} className="font-normal">
          {label}
        </Label>
      </div>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(view);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title="Set view options like date range, reconciliation status, and more."
        >
          View <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-[36rem] max-w-[calc(100vw-2rem)] gap-4">
        <h2 className="font-medium">View Options</h2>
        <fieldset className="flex flex-wrap gap-1" aria-label="Date range">
          {DATE_RANGES.map((range) => (
            <Button
              key={range}
              type="button"
              size="xs"
              variant={draft.range === range ? "default" : "ghost"}
              aria-pressed={draft.range === range}
              className={cn("rounded-full")}
              onClick={() => {
                onChange({ range, from: undefined, to: undefined });
                setOpen(false);
              }}
            >
              {DATE_RANGE_LABELS[range]}
            </Button>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>From:</span>
          {monthPicker("from")}
          <span>To:</span>
          {monthPicker("to")}
        </div>
        <div className="grid gap-2 border-t pt-3 text-sm">
          {checkbox("showReconciled", "Show Reconciled Transactions")}
          {runningBalance && checkbox("showRunningBalance", "Show Running Balance")}
          {checkbox("showFlags", "Show Flags")}
          {checkbox("showAttachments", "Show Attachments")}
          {checkbox("showEnteredBy", "Show Entered By")}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onChange(draft);
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
