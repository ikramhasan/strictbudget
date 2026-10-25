import { Button } from "@strictbudget/ui/components/button";
import { Input } from "@strictbudget/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@strictbudget/ui/components/popover";
import { cn } from "@strictbudget/ui/lib/utils";
import { Bookmark, Check, Pencil } from "lucide-react";
import { type FormEvent, useState } from "react";
import { FLAG_CLASS, type Flag, type FlagColor, flagLabel } from "@/lib/flags";
import { menuKeyDown } from "@/lib/menu-keys";

/** Flag names are shared by everyone on the budget. */
export function FlagMenu({
  value,
  flags,
  onChange,
  onRename,
}: {
  value: FlagColor | null;
  flags: readonly Flag[];
  onChange: (flag: FlagColor | null) => void;
  onRename: (changes: Flag[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const current = flags.find((f) => f.color === value);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setEditing(false);
  }

  function pick(flag: FlagColor | null) {
    setOpen(false);
    if (flag !== value) onChange(flag);
  }

  function startEditing() {
    setNames(Object.fromEntries(flags.map((f) => [f.color, f.name])));
    setEditing(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const changes = flags
      .map((f) => ({ color: f.color, name: (names[f.color] ?? "").trim() }))
      .filter((f) => f.name !== flags.find((g) => g.color === f.color)?.name);
    setPending(true);
    try {
      if (changes.length > 0) await onRename(changes);
      setEditing(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={current ? `Flag: ${flagLabel(current)}` : "Add flag"}
          title={current ? flagLabel(current) : undefined}
        >
          <Bookmark
            className={cn(
              current ? [FLAG_CLASS[current.color], "fill-current"] : "text-muted-foreground/40",
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        {editing ? (
          <form onSubmit={(e) => void save(e)} className="grid gap-1.5 p-1">
            {flags.map((f) => (
              <div key={f.color} className="flex items-center gap-2">
                <Bookmark className={cn("size-4 shrink-0 fill-current", FLAG_CLASS[f.color])} />
                <Input
                  aria-label={`Name for ${flagLabel({ ...f, name: "" })}`}
                  placeholder={flagLabel({ ...f, name: "" })}
                  value={names[f.color] ?? ""}
                  onChange={(e) => setNames((n) => ({ ...n, [f.color]: e.target.value }))}
                  maxLength={50}
                  className="h-8"
                />
              </div>
            ))}
            <div className="mt-1 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                Save names
              </Button>
            </div>
          </form>
        ) : (
          // biome-ignore lint/a11y/useKeyWithClickEvents: arrow keys only; the items are buttons
          <div role="menu" aria-label="Flags" className="grid" onKeyDown={menuKeyDown}>
            {flags.map((f) => (
              <button
                key={f.color}
                type="button"
                role="menuitemradio"
                aria-checked={f.color === value}
                onClick={() => pick(f.color)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <Bookmark className={cn("size-4 shrink-0 fill-current", FLAG_CLASS[f.color])} />
                <span className="flex-1 truncate">{flagLabel(f)}</span>
                {f.color === value && <Check className="size-4" />}
              </button>
            ))}
            <div className="my-1 border-t" />
            <button
              type="button"
              role="menuitem"
              disabled={value === null}
              onClick={() => pick(null)}
              className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:text-muted-foreground disabled:hover:bg-transparent"
            >
              Clear flag
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={startEditing}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            >
              <Pencil className="size-4 text-muted-foreground" /> Edit names
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
