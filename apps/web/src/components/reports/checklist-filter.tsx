import { Button } from "@strictbudget/ui/components/button";
import { Checkbox } from "@strictbudget/ui/components/checkbox";
import { Input } from "@strictbudget/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@strictbudget/ui/components/popover";
import { ChevronDown, EyeOff, Search } from "lucide-react";
import { type ReactNode, useState } from "react";

export interface ChecklistItem {
  id: string;
  label: string;
  /** Hidden categories stay listed with an eye icon. */
  hidden?: boolean;
  icon?: ReactNode;
}

export interface ChecklistSection {
  id: string;
  /** A section heading with its own checkbox (a category group); none for a flat list. */
  title?: string;
  items: ChecklistItem[];
}

/** `selected` undefined means all. */
export function ChecklistFilter({
  allLabel,
  noun,
  searchPlaceholder,
  sections,
  selected,
  onChange,
}: {
  /** The button's text with everything selected ("All Categories"). */
  allLabel: string;
  /** Singular and plural for a partial selection ("1 Category", "3 Categories"). */
  noun: [string, string];
  searchPlaceholder: string;
  sections: ChecklistSection[];
  selected: readonly string[] | undefined;
  onChange: (selected: string[] | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const all = sections.flatMap((s) => s.items.map((i) => i.id));
  const count = selected?.filter((id) => all.includes(id)).length ?? all.length;
  const label =
    count === all.length
      ? allLabel
      : count === 0
        ? `No ${noun[1]} Selected`
        : `${count} ${count === 1 ? noun[0] : noun[1]}`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-1" data-partial={count < all.length || undefined}>
          {label}
          <ChevronDown className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        {open && (
          <ChecklistBody
            searchPlaceholder={searchPlaceholder}
            sections={sections}
            initial={new Set(selected ?? all)}
            onCancel={() => setOpen(false)}
            onDone={(next) => {
              setOpen(false);
              onChange(next.size === all.length ? undefined : all.filter((id) => next.has(id)));
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function ChecklistBody({
  searchPlaceholder,
  sections,
  initial,
  onCancel,
  onDone,
}: {
  searchPlaceholder: string;
  sections: ChecklistSection[];
  initial: Set<string>;
  onCancel: () => void;
  onDone: (selected: Set<string>) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = sections
    .map((s) => ({
      ...s,
      items: needle
        ? s.items.filter(
            (i) =>
              i.label.toLowerCase().includes(needle) ||
              (s.title ?? "").toLowerCase().includes(needle),
          )
        : s.items,
    }))
    .filter((s) => s.items.length);
  const set = (ids: string[], on: boolean) =>
    setDraft((d) => {
      const next = new Set(d);
      for (const id of ids) on ? next.add(id) : next.delete(id);
      return next;
    });
  const all = sections.flatMap((s) => s.items.map((i) => i.id));
  return (
    <div className="grid">
      <div className="relative border-b p-2">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          aria-label={searchPlaceholder}
          placeholder={searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8"
        />
      </div>
      <div className="max-h-72 overflow-y-auto p-2">
        {shown.length === 0 && (
          <p className="p-2 text-muted-foreground text-sm">Nothing matches.</p>
        )}
        {shown.map((s) => {
          const ids = s.items.map((i) => i.id);
          const on = ids.filter((id) => draft.has(id)).length;
          return (
            <div key={s.id} className="grid">
              {s.title && (
                // biome-ignore lint/a11y/noLabelWithoutControl: the Checkbox inside is the control
                <label className="flex items-center gap-2 rounded px-1 py-1 font-semibold text-sm hover:bg-muted">
                  <Checkbox
                    checked={on === ids.length ? true : on ? "indeterminate" : false}
                    onCheckedChange={(v) => set(ids, v === true)}
                  />
                  {s.title}
                </label>
              )}
              {s.items.map((i) => (
                // biome-ignore lint/a11y/noLabelWithoutControl: the Checkbox inside is the control
                <label
                  key={i.id}
                  className={`flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted ${s.title ? "pl-6" : ""}`}
                >
                  <Checkbox
                    checked={draft.has(i.id)}
                    onCheckedChange={(v) => set([i.id], v === true)}
                  />
                  {i.icon}
                  <span className="truncate">{i.label}</span>
                  {i.hidden && (
                    <EyeOff
                      aria-label="Hidden"
                      className="ml-auto size-3.5 text-muted-foreground"
                    />
                  )}
                </label>
              ))}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-1 border-t p-2">
        <Button variant="link" size="sm" onClick={() => set(all, true)}>
          Select All
        </Button>
        <Button variant="link" size="sm" onClick={() => set(all, false)}>
          Select None
        </Button>
        <Button variant="outline" size="sm" className="ml-auto" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onDone(draft)}>
          Done
        </Button>
      </div>
    </div>
  );
}
