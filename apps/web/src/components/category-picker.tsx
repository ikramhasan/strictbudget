import { Button } from "@strictbudget/ui/components/button";
import { FieldLegend, FieldSet } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { ToggleGroup, ToggleGroupItem } from "@strictbudget/ui/components/toggle-group";
import { cn } from "@strictbudget/ui/lib/utils";
import { ArrowLeft, ArrowRight, Check, Plus, X } from "lucide-react";
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

/**
 * Quick questions that fit the starter list to the household before it's reviewed: a "no"
 * unticks starter categories (matched by name), a "yes" adds categories to a starter group.
 */
export interface StarterQuestion {
  id: string;
  text: string;
  removes?: readonly string[];
  adds?: readonly { group: string; name: string }[];
}

export const STARTER_QUESTIONS: readonly StarterQuestion[] = [
  { id: "home", text: "Do you pay rent or a mortgage?", removes: ["🏠 Rent/Mortgage"] },
  {
    id: "car",
    text: "Do you have a car?",
    adds: [
      { group: "Bills", name: "🚗 Car insurance" },
      { group: "Needs", name: "🔧 Car maintenance" },
    ],
  },
  {
    id: "kids",
    text: "Do you have kids?",
    adds: [
      { group: "Needs", name: "🧸 Childcare" },
      { group: "Wants", name: "🎒 Kids' activities" },
    ],
  },
  { id: "pets", text: "Do you have pets?", adds: [{ group: "Needs", name: "🐾 Pet care" }] },
  {
    id: "debt",
    text: "Are you paying off a loan or other debt?",
    adds: [{ group: "Bills", name: "💸 Debt payments" }],
  },
];

type Answer = "yes" | "no";

/** A question's effect on this list: the starter categories it unticks, the ones it adds. */
function effectOf(data: CategoryList, q: StarterQuestion) {
  const groups = data.groups.filter((g) => !g.kind);
  const removes = groups.flatMap((g) =>
    g.categories.filter((c) => q.removes?.includes(c.name)).map((c) => c.id),
  );
  const adds = (q.adds ?? []).flatMap((a) => {
    const group = groups.find((g) => g.name === a.group);
    return group && !group.categories.some((c) => c.name === a.name)
      ? [{ groupId: group.id, name: a.name }]
      : [];
  });
  return { removes, adds };
}

/** "Rent/Mortgage" for "🏠 Rent/Mortgage". */
const plainName = (name: string) => name.replace(/^[^\p{L}\p{N}]+/u, "");

function listNames(names: string[]) {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
}

/**
 * Setup step: a few yes/no questions fit the starter categories to the household, then the list:
 * keep the ones you need, drop the rest, add your own.
 */
export function CategoryPicker({
  data,
  pending,
  questions = STARTER_QUESTIONS,
  onBack,
  onContinue,
}: {
  data: CategoryList;
  pending: boolean;
  questions?: readonly StarterQuestion[];
  /** Back to the step before. */
  onBack?: () => void;
  onContinue: (picks: CategoryPicks) => void;
}) {
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Record<string, string[]>>({});
  const asked = questions
    .map((q) => ({ ...q, effect: effectOf(data, q) }))
    .filter((q) => q.effect.removes.length > 0 || q.effect.adds.length > 0);
  const [phase, setPhase] = useState<"questions" | "list">(asked.length ? "questions" : "list");
  const [answers, setAnswers] = useState<Record<string, Answer | undefined>>({});
  // The answers the list reflects, so changing one undoes what the old answer did.
  const [applied, setApplied] = useState<Record<string, Answer | undefined>>({});
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

  function applyAnswers() {
    const nextUnticked = new Set(unticked);
    const nextAdded: Record<string, string[]> = { ...added };
    for (const q of asked) {
      const before = applied[q.id];
      const after = answers[q.id];
      if (before === after) continue;
      if (before === "no") for (const id of q.effect.removes) nextUnticked.delete(id);
      if (before === "yes")
        for (const a of q.effect.adds)
          nextAdded[a.groupId] = (nextAdded[a.groupId] ?? []).filter((n) => n !== a.name);
      if (after === "no") for (const id of q.effect.removes) nextUnticked.add(id);
      if (after === "yes")
        for (const a of q.effect.adds)
          if (!(nextAdded[a.groupId] ?? []).includes(a.name))
            nextAdded[a.groupId] = [...(nextAdded[a.groupId] ?? []), a.name];
    }
    setUnticked(nextUnticked);
    setAdded(nextAdded);
    setApplied(answers);
    setPhase("list");
  }

  if (phase === "questions") {
    const answered = asked.filter((q) => answers[q.id]).length;
    return (
      <div className="grid gap-6">
        <ul className="divide-y rounded-xl border" aria-label="About your household">
          {asked.map((q) => {
            const hint = [
              q.effect.adds.length > 0 &&
                `Adds ${listNames(q.effect.adds.map((a) => plainName(a.name)))} if yes`,
              q.effect.removes.length > 0 &&
                `Removes ${listNames(
                  groups
                    .flatMap((g) => g.categories)
                    .filter((c) => q.effect.removes.includes(c.id))
                    .map((c) => plainName(c.name)),
                )} if no`,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={q.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <p className="font-medium text-sm" id={`question-${q.id}`}>
                    {q.text}
                  </p>
                  <p className="text-muted-foreground text-xs">{hint}</p>
                </div>
                <ToggleGroup
                  type="single"
                  spacing={0}
                  size="sm"
                  aria-labelledby={`question-${q.id}`}
                  value={answers[q.id] ?? ""}
                  onValueChange={(value) =>
                    setAnswers((a) => ({
                      ...a,
                      [q.id]: (value || undefined) as Answer | undefined,
                    }))
                  }
                >
                  <ToggleGroupItem value="yes" className="min-w-12">
                    Yes
                  </ToggleGroupItem>
                  <ToggleGroupItem value="no" className="min-w-12">
                    No
                  </ToggleGroupItem>
                </ToggleGroup>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-5">
          {onBack && (
            <Button variant="ghost" className="mr-auto -ml-2.5" onClick={onBack}>
              <ArrowLeft /> Back
            </Button>
          )}
          <p className="text-muted-foreground text-sm">
            {answered === 0
              ? "Skip any you'd rather not answer"
              : `${answered} of ${asked.length} answered`}
          </p>
          <Button onClick={applyAnswers}>
            {answered === 0 ? "Skip to categories" : "See my categories"} <ArrowRight />
          </Button>
        </div>
      </div>
    );
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
        {(asked.length > 0 || onBack) && (
          <Button
            variant="ghost"
            className="mr-auto -ml-2.5"
            onClick={asked.length > 0 ? () => setPhase("questions") : onBack}
          >
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
