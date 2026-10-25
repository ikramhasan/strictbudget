import type { components } from "@strictbudget/api-client";
import { Button } from "@strictbudget/ui/components/button";
import { Checkbox } from "@strictbudget/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { ArrowLeft } from "lucide-react";
import { useId, useState } from "react";

export type CategoryTemplate = components["schemas"]["CategoryTemplate"];

const groupCount = (t: CategoryTemplate) =>
  `${t.categoryCount} ${t.categoryCount === 1 ? "category" : "categories"} · ${t.groups.length} ${
    t.groups.length === 1 ? "group" : "groups"
  }`;

/**
 * The template gallery: every template with its description, then a preview of its groups,
 * categories and example amounts ("Get Template" opens the import dialog).
 */
export function TemplateGallery({
  open,
  onOpenChange,
  templates,
  format,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Undefined while loading. */
  templates: CategoryTemplate[] | undefined;
  format: (amount: string) => string;
  onPick: (template: CategoryTemplate) => void;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = templates?.find((t) => t.id === previewId);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setPreviewId(null);
      }}
    >
      <DialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl">
        {preview ? (
          <>
            <DialogHeader>
              <DialogTitle>{preview.name}</DialogTitle>
              <DialogDescription>
                {preview.description} {groupCount(preview)}.
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 overflow-y-auto pr-1">
              <TemplatePreview template={preview} format={format} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPreviewId(null)}>
                <ArrowLeft /> All templates
              </Button>
              <Button
                onClick={() => {
                  onPick(preview);
                  setPreviewId(null);
                }}
              >
                Get Template
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Category templates</DialogTitle>
              <DialogDescription>
                Ready-made category setups. Pick one to see its categories, then choose the ones you
                want in your budget.
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 overflow-y-auto pr-1">
              {templates ? (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {templates.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => setPreviewId(t.id)}
                        className="grid h-full w-full gap-1 rounded-lg border p-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="font-medium">{t.name}</span>
                        <span className="text-muted-foreground text-sm">{t.description}</span>
                        <span className="text-muted-foreground text-xs">{groupCount(t)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-24" />
                  ))}
                </div>
              )}
            </div>
            <div />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A template's groups and categories with their example amounts, and the total. */
function TemplatePreview({
  template,
  format,
}: {
  template: CategoryTemplate;
  format: (amount: string) => string;
}) {
  const total = template.groups
    .flatMap((g) => g.categories)
    .reduce((sum, c) => sum + BigInt(c.amount), 0n);
  return (
    <div className="grid gap-4 text-sm">
      {template.groups.map((g) => (
        <section key={g.name} aria-label={g.name} className="grid gap-1">
          <h3 className="font-medium">{g.name}</h3>
          <ul className="grid gap-0.5">
            {g.categories.map((c) => (
              <li key={c.id} className="flex justify-between gap-4 pl-3">
                <span>{c.name}</span>
                {c.amount !== "0" && (
                  <span className="text-muted-foreground tabular-nums">{format(c.amount)}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {total > 0n && (
        <p className="flex justify-between gap-4 border-t pt-2 font-medium">
          <span>Total</span>
          <span className="tabular-nums">{format(total.toString())}</span>
        </p>
      )}
    </div>
  );
}

/**
 * The "Import Category Template" dialog: the template's categories under their groups, all
 * ticked; a group's box ticks or unticks its categories and shows ticked only when all of them
 * are. Import stays enabled with nothing ticked.
 */
export function ImportTemplateDialog({
  template,
  budgetName,
  onCancel,
  onChooseAnother,
  onImport,
}: {
  /** The template to import; the dialog shows while set. */
  template: CategoryTemplate | undefined;
  budgetName: string;
  onCancel: () => void;
  onChooseAnother: () => void;
  /** Imports the ticked category ids; resolves once done (or failed, having said so). */
  onImport: (categoryIds: string[]) => Promise<void>;
}) {
  return (
    <Dialog open={Boolean(template)} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto_auto] sm:max-w-md">
        {template && (
          // Keyed so reopening starts with everything ticked again.
          <ImportTemplateForm
            key={template.id}
            template={template}
            budgetName={budgetName}
            onCancel={onCancel}
            onChooseAnother={onChooseAnother}
            onImport={onImport}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImportTemplateForm({
  template,
  budgetName,
  onCancel,
  onChooseAnother,
  onImport,
}: {
  template: CategoryTemplate;
  budgetName: string;
  onCancel: () => void;
  onChooseAnother: () => void;
  onImport: (categoryIds: string[]) => Promise<void>;
}) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(
    () => new Set(template.groups.flatMap((g) => g.categories.map((c) => c.id))),
  );
  const [pending, setPending] = useState(false);
  const idPrefix = useId();

  const toggle = (ids: string[], on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  async function submit() {
    setPending(true);
    try {
      await onImport(
        template.groups
          .flatMap((g) => g.categories.map((c) => c.id))
          .filter((id) => ticked.has(id)),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Import Category Template</DialogTitle>
        <DialogDescription>
          Would you like to add these categories into your budget{" "}
          <strong className="font-semibold text-foreground">{budgetName}</strong>?
        </DialogDescription>
        <DialogDescription>
          Deselect any categories you do not want to include. You can also always delete extra
          categories later!
        </DialogDescription>
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto rounded-md border p-2">
        <ul className="grid gap-1 text-sm">
          {template.groups.map((g, gi) => {
            const ids = g.categories.map((c) => c.id);
            const all = ids.every((id) => ticked.has(id));
            const groupBox = `${idPrefix}-g${gi}`;
            return (
              <li key={g.name} className="grid gap-1">
                <label htmlFor={groupBox} className="flex items-center gap-2 font-medium">
                  <Checkbox id={groupBox} checked={all} onCheckedChange={() => toggle(ids, !all)} />
                  {g.name}
                </label>
                <ul className="grid gap-1 pl-6">
                  {g.categories.map((c) => {
                    const box = `${idPrefix}-${c.id}`;
                    return (
                      <li key={c.id}>
                        <label htmlFor={box} className="flex items-center gap-2">
                          <Checkbox
                            id={box}
                            checked={ticked.has(c.id)}
                            onCheckedChange={(on) => toggle([c.id], on === true)}
                          />
                          {c.name}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="text-muted-foreground text-sm">
        Adding this template will not overwrite anything in your budget, it will just add these new
        groups and categories at the bottom.
      </p>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button variant="outline" onClick={onChooseAnother} disabled={pending}>
          Choose Another Budget
        </Button>
        <Button onClick={() => void submit()} disabled={pending}>
          {pending ? "Importing…" : "Import Categories"}
        </Button>
      </DialogFooter>
    </>
  );
}
