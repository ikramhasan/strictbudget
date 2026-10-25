import {
  type BudgetFormatSettings,
  CURRENCY_SYMBOL_POSITIONS,
  type CurrencyCode,
  type CurrencySymbolPosition,
  currencyExponent,
  DATE_FORMATS,
  type DateFormat,
  formatAmount,
  formatDate,
  type Money,
  money,
  NUMBER_FORMATS,
  type NumberFormat,
} from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { type FormEvent, useState } from "react";
import { todayIso } from "@/lib/dates";
import { CurrencyPicker, currencyName } from "./currency-picker";

export interface BudgetFormValues extends BudgetFormatSettings {
  name: string;
  currency: CurrencyCode;
}

/** -1,234,567.89 in the currency's own precision, so the preview shows grouping and decimals. */
function previewAmount(currency: CurrencyCode): Money {
  return money(-(123456789n * 10n ** BigInt(currencyExponent(currency))) / 100n, currency);
}

const SYMBOL_POSITION_LABELS: Record<CurrencySymbolPosition, string> = {
  before: "Before amount",
  after: "After amount",
  none: "Don't show",
};

export function BudgetForm({
  defaultValues,
  currencyLocked = false,
  submitLabel,
  pendingLabel,
  onSubmit,
}: {
  defaultValues: BudgetFormValues;
  /** The base currency can't change after creation. */
  currencyLocked?: boolean;
  submitLabel: string;
  pendingLabel: string;
  onSubmit: (values: BudgetFormValues) => Promise<string | null>;
}) {
  const [values, setValues] = useState(defaultValues);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = <K extends keyof BudgetFormValues>(key: K, value: BudgetFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const today = todayIso();
  const sample = previewAmount(values.currency);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const message = await onSubmit({ ...values, name: values.name.trim() });
    setPending(false);
    setError(message);
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-5">
      <Field>
        <FieldLabel htmlFor="budget-name">Budget name</FieldLabel>
        <Input
          id="budget-name"
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          maxLength={100}
          required
          autoFocus={!currencyLocked}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="budget-currency">Currency</FieldLabel>
        {currencyLocked ? (
          <>
            <Input
              id="budget-currency"
              value={`${values.currency} — ${currencyName(values.currency)}`}
              disabled
            />
            <FieldDescription>Currency can't be changed after creation.</FieldDescription>
          </>
        ) : (
          <CurrencyPicker
            id="budget-currency"
            value={values.currency}
            onChange={(code) => set("currency", code)}
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="budget-number-format">Number format</FieldLabel>
          <NativeSelect
            id="budget-number-format"
            value={values.numberFormat}
            onChange={(e) => set("numberFormat", e.target.value as NumberFormat)}
          >
            {NUMBER_FORMATS.map((f) => (
              <NativeSelectOption key={f} value={f}>
                {formatAmount(money(123456789n, "USD"), {
                  numberFormat: f,
                  currencySymbolPosition: "none",
                  dateFormat: values.dateFormat,
                })}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="budget-symbol-position">Currency symbol</FieldLabel>
          <NativeSelect
            id="budget-symbol-position"
            value={values.currencySymbolPosition}
            onChange={(e) =>
              set("currencySymbolPosition", e.target.value as CurrencySymbolPosition)
            }
          >
            {CURRENCY_SYMBOL_POSITIONS.map((p) => (
              <NativeSelectOption key={p} value={p}>
                {SYMBOL_POSITION_LABELS[p]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="budget-date-format">Date format</FieldLabel>
          <NativeSelect
            id="budget-date-format"
            value={values.dateFormat}
            onChange={(e) => set("dateFormat", e.target.value as DateFormat)}
          >
            {DATE_FORMATS.map((f) => (
              <NativeSelectOption key={f} value={f}>
                {formatDate(today, f)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
        <span className="text-muted-foreground">Preview: </span>
        <output aria-label="Preview" className="font-medium tabular-nums">
          {formatAmount(sample, values)} · {formatDate(today, values.dateFormat)}
        </output>
      </div>

      {error && <FieldError>{error}</FieldError>}
      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending && <Spinner />}
        {pending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}
