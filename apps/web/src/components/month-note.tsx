import { Button } from "@strictbudget/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@strictbudget/ui/components/popover";
import { Textarea } from "@strictbudget/ui/components/textarea";
import { cn } from "@strictbudget/ui/lib/utils";
import { type FormEvent, useState } from "react";
import { useOptionalBudget } from "@/lib/budget-context";

/** An empty note removes it. Each month has its own. */
export function MonthNote({
  note,
  onSave,
}: {
  note: string;
  onSave: (note: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(note);
  const readOnly = useOptionalBudget()?.readOnly ?? false;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setOpen(false);
    if (text.trim() !== note.trim()) await onSave(text.trim());
  }

  // A viewer reads the note but can't change it.
  if (readOnly) {
    return note ? <p className="max-w-48 truncate text-xs">{note}</p> : null;
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setText(note);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "max-w-48 truncate text-left text-xs hover:underline",
            note ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {note || "Enter a note…"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <form onSubmit={submit} className="grid gap-2">
          <Textarea
            aria-label="Month note"
            placeholder="Enter a note…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={10_000}
            autoFocus
          />
          <Button type="submit" size="sm" className="justify-self-end">
            OK
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
