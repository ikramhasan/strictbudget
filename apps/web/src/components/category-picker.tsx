import { Button } from "@strictbudget/ui/components/button";
import { FieldLegend, FieldSet } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { cn } from "@strictbudget/ui/lib/utils";
import { ArrowLeft, Check, Plus, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { CategoryList } from "@/lib/categories";

export interface CategoryPicks {
  removeCategoryIds: string[];
  /** Groups left with nothing in them, to delete as well. */
  removeGroupIds: string[];
  add: Array<{ groupId: string; name: string }>;
}

/** Turns the ticked/unticked state into the changes to make. */
export function picksFrom(
  data: CategoryList,
  unticked: ReadonlySet<string>,
  added: Readonly<Record<string, string[]>>,
): CategoryPicks {
  const groups = data.groups.filter((g) => !g.kind);
  return {
    removeCategoryIds: groups.flatMap((g) =>
      g.categories.filter((c) => unticked.has(c.id)).map((c) => c.id),
    ),
    removeGroupIds: groups
      .filter(
        (g) => g.categories.every((c) => unticked.has(c.id)) && (added[g.id] ?? []).length === 0,
      )
      .map((g) => g.id),
    add: groups.flatMap((g) => (added[g.id] ?? []).map((name) => ({ groupId: g.id, name }))),
  };
}

/** Setup step: keep the starter categories you need, drop the rest, add your own. */
export function CategoryPicker({
  data,
  pending,
  onBack,
  onContinue,
}: {
  data: CategoryList;
  pending: boolean;
  /** Back to the step before. */
  onBack?: () => void;
  onContinue: (picks: CategoryPicks) => void;
}) {
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Record<string, string[]>>({});
  const groups = data.groups.filter((g) => !g.kind);
  const kept =
    groups.reduce((n, g) => n + g.categories.filter((c) => !unticked.has(c.id)).length, 0) +
    Object.values(added).reduce((n, names) => n + names.length, 0);

  function toggle(id: string, keep: boolean) {
    setUnticked((prev) => {
      const next = new Set(prev);
      if (keep) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-2">
        {groups.map((group) => (
          // The border is on a wrapper: on the fieldset it would run through the legend.
          <div key={group.id} className="rounded-xl border p-4">
            <FieldSet className="gap-3">
              <FieldLegend variant="label" className="mb-0 font-semibold">
                {group.name}
              </FieldLegend>
              <div className="flex flex-wrap gap-1.5">
                {group.categories.map((c) => (
                  <Chip
                    key={c.id}
                    label={c.name}
                    checked={!unticked.has(c.id)}
                    onCheckedChange={(checked) => toggle(c.id, checked)}
                  />
                ))}
                {(added[group.id] ?? []).map((name, i) => (
                  <span
                    key={`${name}-${i}`}
                    className="inline-flex h-8 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 ps-3 pe-1 text-sm"
                  >
                    <Check className="size-3.5 text-primary-text" aria-hidden />
                    {name}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="rounded-full"
                      aria-label={`Remove ${name}`}
                      onClick={() =>
                        setAdded((a) => ({
                          ...a,
                          [group.id]: (a[group.id] ?? []).filter((_, j) => j !== i),
                        }))
                      }
                    >
                      <X />
                    </Button>
                  </span>
                ))}
              </div>
              <AddInline
                groupName={group.name}
                onAdd={(name) =>
                  setAdded((a) => ({ ...a, [group.id]: [...(a[group.id] ?? []), name] }))
                }
              />
            </FieldSet>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-5">
        {onBack && (
          <Button variant="ghost" className="mr-auto -ml-2.5" onClick={onBack}>
            <ArrowLeft /> Back
          </Button>
        )}
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {kept === 1 ? "1 category" : `${kept} categories`} · you can change them any time
        </p>
        <Button disabled={pending} onClick={() => onContinue(picksFrom(data, unticked, added))}>
          {pending && <Spinner />}
          {pending ? "Saving…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}

/** A category as a pill: ticked ones are tinted, unticked ones fade back. */
function Chip({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "inline-flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-full border px-3 text-sm transition-colors duration-150 has-focus-visible:ring-2 has-focus-visible:ring-ring",
        checked
          ? "border-primary/30 bg-primary/10 text-foreground hover:bg-primary/15"
          : "border-input border-dashed text-muted-foreground line-through decoration-muted-foreground/50 hover:bg-muted",
      )}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
      />
      {checked ? (
        <Check className="size-3.5 text-primary-text" aria-hidden />
      ) : (
        <Plus className="size-3.5" aria-hidden />
      )}
      {label}
    </label>
  );
}

function AddInline({ groupName, onAdd }: { groupName: string; onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setName("");
  }
  return (
    <form onSubmit={submit} className="flex gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Add a category"
        aria-label={`New category in ${groupName}`}
        maxLength={100}
        className="h-8"
      />
      <Button
        type="submit"
        variant="outline"
        size="icon-sm"
        aria-label={`Add to ${groupName}`}
        disabled={!name.trim()}
      >
        <Plus />
      </Button>
    </form>
  );
}
