import { Button } from "@strictbudget/ui/components/button";
import { Checkbox } from "@strictbudget/ui/components/checkbox";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { Plus, X } from "lucide-react";
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
  onContinue,
}: {
  data: CategoryList;
  pending: boolean;
  onContinue: (picks: CategoryPicks) => void;
}) {
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Record<string, string[]>>({});
  const groups = data.groups.filter((g) => !g.kind);

  function toggle(id: string, keep: boolean) {
    setUnticked((prev) => {
      const next = new Set(prev);
      if (keep) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {groups.map((group) => (
          <FieldSet key={group.id} className="content-start gap-2 rounded-lg border p-4">
            <FieldLegend variant="label">{group.name}</FieldLegend>
            {group.categories.map((c) => (
              <Field key={c.id} orientation="horizontal">
                <Checkbox
                  id={`pick-${c.id}`}
                  checked={!unticked.has(c.id)}
                  onCheckedChange={(checked) => toggle(c.id, checked === true)}
                />
                <FieldLabel htmlFor={`pick-${c.id}`} className="font-normal">
                  {c.name}
                </FieldLabel>
              </Field>
            ))}
            {(added[group.id] ?? []).map((name, i) => (
              <div key={`${name}-${i}`} className="flex items-center gap-2 text-sm">
                <Checkbox checked disabled aria-label={name} />
                <span className="flex-1">{name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
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
              </div>
            ))}
            <AddInline
              groupName={group.name}
              onAdd={(name) =>
                setAdded((a) => ({ ...a, [group.id]: [...(a[group.id] ?? []), name] }))
              }
            />
          </FieldSet>
        ))}
      </div>
      <Button
        className="justify-self-end"
        disabled={pending}
        onClick={() => onContinue(picksFrom(data, unticked, added))}
      >
        {pending && <Spinner />}
        {pending ? "Saving…" : "Continue"}
      </Button>
    </div>
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
    <form onSubmit={submit} className="mt-1 flex gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Add a category"
        aria-label={`New category in ${groupName}`}
        maxLength={100}
        className="h-8"
      />
      <Button type="submit" variant="outline" size="icon-sm" aria-label={`Add to ${groupName}`}>
        <Plus />
      </Button>
    </form>
  );
}
