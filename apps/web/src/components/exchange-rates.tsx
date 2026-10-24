import { type CurrencyCode, formatDate } from "@strictbudget/engine";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@strictbudget/ui/components/alert-dialog";
import { Button } from "@strictbudget/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@strictbudget/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import { Input } from "@strictbudget/ui/components/input";
import { Label } from "@strictbudget/ui/components/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@strictbudget/ui/components/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";
import { $api } from "@/lib/api";
import type { Budget } from "@/lib/budgets";
import { apiErrorMessage } from "@/lib/budgets";
import { todayIso } from "@/lib/dates";
import {
  type FxRateOverride,
  fxRateOverridesQueryOptions,
  isValidRate,
  rateLabel,
} from "@/lib/fx-rates";
import { CurrencyPicker } from "./currency-picker";
import { DateField } from "./register-fields";

const firstForeign = (budget: Budget): CurrencyCode => (budget.currency === "EUR" ? "USD" : "EUR");

/** The budget's own rates per currency and day win over the market rate for that day. */
export function ExchangeRates({ budget }: { budget: Budget }) {
  const queryClient = useQueryClient();
  const overrides = useQuery(fxRateOverridesQueryOptions(budget.id));
  const remove = $api.useMutation(
    "delete",
    "/v1/budgets/{budgetId}/fx-rate-overrides/{overrideId}",
  );
  const [editing, setEditing] = useState<FxRateOverride | "new" | null>(null);
  const [deleting, setDeleting] = useState<FxRateOverride | null>(null);
  const list = overrides.data?.overrides ?? [];

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: fxRateOverridesQueryOptions(budget.id).queryKey,
    });
  }

  async function handleDelete(override: FxRateOverride) {
    try {
      await remove.mutateAsync({
        params: { path: { budgetId: budget.id, overrideId: override.id } },
      });
      toast.success("Exchange rate removed");
    } catch (error) {
      toast.error(apiErrorMessage(error, "Couldn't remove the exchange rate. Try again."));
    } finally {
      await refresh();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Exchange rates</CardTitle>
        <CardDescription>
          Amounts in other currencies are converted into {budget.currency} at the day's market rate.
          Set your own rate for a currency and day to use it instead.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-3">
          {list.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead className="w-0">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="tabular-nums">
                      {formatDate(o.date, budget.dateFormat)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {rateLabel(o.currency, o.rate, budget.currency)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit the ${o.currency} rate`}
                        onClick={() => setEditing(o)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete the ${o.currency} rate`}
                        onClick={() => setDeleting(o)}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-sm">
              {overrides.isPending ? "Loading…" : "No rates of your own yet."}
            </p>
          )}
          <div>
            <Button variant="outline" onClick={() => setEditing("new")}>
              Add rate
            </Button>
          </div>
        </div>

        <RateLookup budget={budget} />
      </CardContent>

      <OverrideDialog
        budget={budget}
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={refresh}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this exchange rate?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting &&
                `${rateLabel(deleting.currency, deleting.rate, budget.currency)} on ${formatDate(
                  deleting.date,
                  budget.dateFormat,
                )}. That day goes back to the market rate.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deleting && void handleDelete(deleting)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function OverrideDialog({
  budget,
  editing,
  onClose,
  onSaved,
}: {
  budget: Budget;
  editing: FxRateOverride | "new" | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {editing === "new" ? "Add exchange rate" : "Edit exchange rate"}
          </DialogTitle>
          <DialogDescription>
            Used instead of the market rate for this currency on this day.
          </DialogDescription>
        </DialogHeader>
        {editing !== null && (
          <OverrideForm
            budget={budget}
            existing={editing === "new" ? null : editing}
            onClose={onClose}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function OverrideForm({
  budget,
  existing,
  onClose,
  onSaved,
}: {
  budget: Budget;
  existing: FxRateOverride | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const save = $api.useMutation("put", "/v1/budgets/{budgetId}/fx-rate-overrides");
  const remove = $api.useMutation(
    "delete",
    "/v1/budgets/{budgetId}/fx-rate-overrides/{overrideId}",
  );
  const [date, setDate] = useState(existing?.date ?? todayIso());
  const [currency, setCurrency] = useState<CurrencyCode>(
    existing?.currency ?? firstForeign(budget),
  );
  const [rate, setRate] = useState(existing?.rate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const ids = { currency: useId(), rate: useId() };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = rate.trim();
    if (currency === budget.currency) {
      setError(`${budget.currency} is this budget's own currency.`);
      return;
    }
    if (!isValidRate(value)) {
      setError("Enter a rate above zero, with at most 12 decimals.");
      return;
    }
    setPending(true);
    try {
      await save.mutateAsync({
        params: { path: { budgetId: budget.id } },
        body: { date, currency, rate: value },
      });
      // Moving a rate to another day or currency replaces the one being edited.
      if (existing && (existing.date !== date || existing.currency !== currency)) {
        await remove.mutateAsync({
          params: { path: { budgetId: budget.id, overrideId: existing.id } },
        });
      }
      toast.success("Exchange rate saved");
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't save the exchange rate. Try again."));
    } finally {
      setPending(false);
      await onSaved();
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-4">
      <div className="grid gap-2">
        <Label>Date</Label>
        <DateField value={date} onChange={setDate} format={budget.dateFormat} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={ids.currency}>Currency</Label>
        <CurrencyPicker id={ids.currency} value={currency} onChange={setCurrency} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={ids.rate}>
          1 {currency} = how many {budget.currency}?
        </Label>
        <Input
          id={ids.rate}
          inputMode="decimal"
          autoComplete="off"
          placeholder="1.0842"
          value={rate}
          onChange={(e) => {
            setRate(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          className="tabular-nums"
        />
        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function RateLookup({ budget }: { budget: Budget }) {
  const [currency, setCurrency] = useState<CurrencyCode>(firstForeign(budget));
  const [date, setDate] = useState(todayIso());
  const [asked, setAsked] = useState<{ from: CurrencyCode; date: string } | null>(null);
  const currencyId = useId();
  const result = $api.useQuery(
    "get",
    "/v1/budgets/{budgetId}/fx-rates",
    {
      params: {
        path: { budgetId: budget.id },
        query: { from: asked?.from ?? currency, date: asked?.date ?? date, today: todayIso() },
      },
    },
    { enabled: asked !== null, retry: false },
  );

  let answer: string | null = null;
  if (asked && result.isPending) answer = "Looking up…";
  else if (asked && result.error) {
    answer = apiErrorMessage(result.error, "Couldn't look up the rate. Try again.");
  } else if (asked && result.data) {
    const r = result.data;
    const label = rateLabel(r.from, r.rate, r.to);
    const kind = r.source === "override" ? "your rate" : "market rate";
    const day = formatDate(r.rateDate, budget.dateFormat);
    answer = `${label} (${kind} for ${day})`;
  }

  return (
    <form
      className="grid gap-3 border-t pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        setAsked({ from: currency, date });
      }}
    >
      <h3 className="font-medium text-sm">Look up rate</h3>
      <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <div className="grid gap-2">
          <Label htmlFor={currencyId}>Currency</Label>
          <CurrencyPicker id={currencyId} value={currency} onChange={setCurrency} />
        </div>
        <div className="grid gap-2">
          <Label>Date</Label>
          <DateField value={date} onChange={setDate} format={budget.dateFormat} />
        </div>
        <Button type="submit" variant="outline">
          Look up
        </Button>
      </div>
      {answer && (
        <p className="text-sm tabular-nums" aria-live="polite">
          {answer}
        </p>
      )}
    </form>
  );
}
