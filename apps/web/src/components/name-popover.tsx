import { Button } from "@strictbudget/ui/components/button";
import { Field, FieldDescription, FieldLabel } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@strictbudget/ui/components/popover";
import { Textarea } from "@strictbudget/ui/components/textarea";
import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";
import { useOptionalBudget } from "@/lib/budget-context";
import { EmojiButton } from "./emoji-button";

/** One grapheme that is an emoji (pictographs, flags, keycaps), not a bare digit or symbol. */
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;

/**
 * Splits a leading emoji off a name ("🏠 Rent" → "🏠", "Rent"). Only an emoji followed by one
 * space and more text is split, so joining the parts back gives the name unchanged.
 */
export function splitEmoji(name: string): { emoji: string; text: string } {
  const first = new Intl.Segmenter().segment(name)[Symbol.iterator]().next().value?.segment;
  if (!first || !EMOJI.test(first)) return { emoji: "", text: name };
  const rest = name.slice(first.length);
  if (!/^ \S/.test(rest)) return { emoji: "", text: name };
  return { emoji: first, text: rest.slice(1) };
}

export interface NameValues {
  name: string;
  note: string;
}

/**
 * Inline editor: a popover with a name field (and optionally a note), OK/Cancel, and
 * any extra actions (Hide, Delete) the caller passes in.
 */
export function NamePopover({
  trigger,
  title,
  initial = { name: "", note: "" },
  withNote = false,
  withEmoji = false,
  submitLabel = "OK",
  nameLockedReason,
  onSubmit,
  actions,
}: {
  trigger: ReactNode;
  title: string;
  initial?: NameValues;
  withNote?: boolean;
  /**
   * An emoji box in front of the name: a leading emoji in `initial.name` moves into it, and a
   * picked one is put back at the start of the name. Not shown while the name is locked.
   */
  withEmoji?: boolean;
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
  const emojiBox = withEmoji && !nameLockedReason;
  const [values, setValues] = useState(initial);
  const [emoji, setEmoji] = useState("");
  const [pending, setPending] = useState(false);
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  function handleOpenChange(next: boolean) {
    if (next) {
      const split = emojiBox ? splitEmoji(initial.name) : { emoji: "", text: initial.name };
      setValues({ ...initial, name: split.text });
      setEmoji(split.emoji);
    }
    setOpen(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = values.name.trim();
    if (!trimmed) return;
    const name = emoji ? `${emoji} ${trimmed}` : trimmed;
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
            <div className="flex gap-2">
              {emojiBox && (
                <EmojiButton
                  value={emoji}
                  onChange={setEmoji}
                  onClose={() => nameRef.current?.focus()}
                />
              )}
              <Input
                ref={nameRef}
                id={`${id}-name`}
                value={values.name}
                onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
                // The emoji and its space count toward the 100 the API allows.
                maxLength={emoji ? 100 - emoji.length - 1 : 100}
                autoFocus={!nameLockedReason}
                readOnly={Boolean(nameLockedReason)}
                required
              />
            </div>
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
