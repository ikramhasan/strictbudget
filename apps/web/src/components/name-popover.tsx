import { Button } from "@strictbudget/ui/components/button";
import { Field, FieldDescription, FieldLabel } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@strictbudget/ui/components/popover";
import { Textarea } from "@strictbudget/ui/components/textarea";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { useOptionalBudget } from "@/lib/budget-context";

export interface NameValues {
  name: string;
  note: string;
}

export function NamePopover({
  trigger,
  title,
  initial = { name: "", note: "" },
  withNote = false,
  submitLabel = "OK",
  nameLockedReason,
  onSubmit,
  actions,
}: {
  trigger: ReactNode;
  title: string;
  initial?: NameValues;
  withNote?: boolean;
  submitLabel?: string;
  /** Shows the name read-only with this explanation (e.g. payment categories). */
  nameLockedReason?: string;
  onSubmit: (values: NameValues) => Promise<void> | void;
  /** Extra buttons; call `close()` when one finishes. */
  actions?: (close: () => void) => ReactNode;
}) {
  // A viewer sees the trigger, but it opens nothing to change.
  const readOnly = useOptionalBudget()?.readOnly ?? false;
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(initial);
  const [pending, setPending] = useState(false);
  const id = useId();

  function handleOpenChange(next: boolean) {
    if (next) setValues(initial);
    setOpen(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = values.name.trim();
    if (!name) return;
    setPending(true);
    try {
      await onSubmit({ name, note: values.note });
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  if (readOnly) return <>{trigger}</>;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <form onSubmit={handleSubmit} className="grid gap-3">
          <Field>
            <FieldLabel htmlFor={`${id}-name`}>{title}</FieldLabel>
            <Input
              id={`${id}-name`}
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              maxLength={100}
              autoFocus={!nameLockedReason}
              readOnly={Boolean(nameLockedReason)}
              required
            />
            {nameLockedReason && <FieldDescription>{nameLockedReason}</FieldDescription>}
          </Field>
          {withNote && (
            <Field>
              <FieldLabel htmlFor={`${id}-note`}>Note</FieldLabel>
              <Textarea
                id={`${id}-note`}
                value={values.note}
                onChange={(e) => setValues((v) => ({ ...v, note: e.target.value }))}
                rows={3}
              />
            </Field>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {actions?.(() => setOpen(false))}
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending || !values.name.trim()}>
                {submitLabel}
              </Button>
            </div>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
