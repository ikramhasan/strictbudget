import { move } from "@dnd-kit/helpers";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@strictbudget/ui/components/dropdown-menu";
import { Input } from "@strictbudget/ui/components/input";
import { Label } from "@strictbudget/ui/components/label";
import { cn } from "@strictbudget/ui/lib/utils";
import { ChevronDown, GripVertical, ListPlus, Pencil, PlusCircle, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { type CustomView, MAX_CUSTOM_VIEWS, type ViewActions } from "@/lib/budget-views";
import { apiErrorMessage } from "@/lib/budgets";
import type { CategoryList } from "@/lib/categories";
import { type OverflowView, TAB } from "./budget-filter-bar";

const PRESET_LABELS: Record<string, string> = {
  underfunded: "Underfunded",
  overfunded: "Overfunded",
  available: "Money Available",
  snoozed: "Snoozed",
};

const LIMIT_MESSAGE = "You have reached the maximum number of custom views available.";

/** Which views dialog is open: Manage Views, or the editor for a new view or an existing one. */
export type ViewDialog =
  | null
  | { kind: "manage" }
  | { kind: "edit"; view: CustomView | null; preselected?: readonly string[] };

/**
 * The Views Menu after the views: the views that didn't fit the bar, then Manage Views and New
 * View (disabled at the limit).
 */
export function ViewsMenu({
  full,
  overflow = [],
  onPick,
  onManage,
  onNew,
}: {
  /** The budget has as many custom views as allowed. */
  full: boolean;
  overflow?: readonly OverflowView[];
  onPick?: (key: string) => void;
  onManage: () => void;
  onNew: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            TAB,
            "gap-1 aria-expanded:bg-transparent aria-expanded:text-foreground dark:hover:bg-transparent",
          )}
        >
          More <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {overflow.map((view) => (
          <DropdownMenuItem key={view.key} onSelect={() => onPick?.(view.key)}>
            <span className="truncate">{view.label}</span>
          </DropdownMenuItem>
        ))}
        {overflow.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onSelect={onManage}>
          <ListPlus /> Manage Views
        </DropdownMenuItem>
        <DropdownMenuItem disabled={full} onSelect={onNew}>
          <PlusCircle /> New View
        </DropdownMenuItem>
        {full && (
          <>
            <DropdownMenuSeparator />
            <p className="px-2 py-1.5 text-muted-foreground text-xs">{LIMIT_MESSAGE}</p>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ViewDialogs({
  dialog,
  onDialogChange,
  order,
  views,
  categories,
  actions,
  onCreated,
  onDeleted,
}: {
  dialog: ViewDialog;
  onDialogChange: (dialog: ViewDialog) => void;
  order: readonly string[];
  views: readonly CustomView[];
  categories: CategoryList;
  actions: ViewActions;
  /** A new view was saved (the budget switches to it). */
  onCreated: (view: CustomView) => void;
  onDeleted: (viewId: string) => void;
}) {
  const close = () => onDialogChange(null);
  return (
    <>
      <ManageViewsDialog
        open={dialog?.kind === "manage"}
        onClose={close}
        order={order}
        views={views}
        actions={actions}
        onEdit={(view) => onDialogChange({ kind: "edit", view })}
        onNew={() => onDialogChange({ kind: "edit", view: null })}
        onDeleted={onDeleted}
      />
      <ViewEditorDialog
        key={dialog?.kind === "edit" ? (dialog.view?.id ?? "new") : "closed"}
        open={dialog?.kind === "edit"}
        view={dialog?.kind === "edit" ? dialog.view : null}
        preselected={dialog?.kind === "edit" ? dialog.preselected : undefined}
        categories={categories}
        onClose={close}
        onSave={async (body) => {
          if (dialog?.kind !== "edit") return;
          if (dialog.view) {
            await actions.update(dialog.view.id, body);
          } else {
            onCreated(await actions.create(body));
          }
          close();
        }}
      />
    </>
  );
}

/**
 * "New Custom View" / "Edit Custom View": a name and the categories to include, listed by
 * group. Hidden categories aren't offered (so saving drops any the view had); categories selected
 * on the budget screen start checked in a new view.
 */
export function ViewEditorDialog({
  open,
  view,
  preselected,
  categories,
  onClose,
  onSave,
}: {
  open: boolean;
  view: CustomView | null;
  preselected?: readonly string[];
  categories: CategoryList;
  onClose: () => void;
  onSave: (body: { name: string; categoryIds: string[] }) => Promise<void>;
}) {
  const id = useId();
  const [name, setName] = useState(view?.name ?? "");
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () => new Set(view?.categoryIds ?? preselected ?? []),
  );
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const groups = categories.groups
    .filter((g) => !g.hidden)
    .map((g) => ({ ...g, categories: g.categories.filter((c) => !c.hidden) }))
    .filter((g) => g.categories.length > 0);
  const offered = new Set(groups.flatMap((g) => g.categories.map((c) => c.id)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === "") {
      setError("The view name is required.");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        categoryIds: [...checked].filter((c) => offered.has(c)),
      });
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't save the view."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{view ? "Edit Custom View" : "New Custom View"}</DialogTitle>
            <DialogDescription>
              Choose a set of categories to include in this custom view.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-name`}>View Name</Label>
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={50}
              placeholder="Keep 'em short & sweet!"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(e) => setName(e.target.value)}
            />
            {error && (
              <p
                id={`${id}-error`}
                role="alert"
                className="rounded-sm bg-destructive/15 px-2 py-1 text-destructive text-xs"
              >
                {error}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <p className="text-sm">Select the categories below to include.</p>
            <div className="grid max-h-64 gap-3 overflow-y-auto rounded-md border p-2">
              {groups.map((g) => (
                <fieldset key={g.id} className="grid gap-1">
                  <legend className="mb-1 font-semibold text-sm">{g.name}</legend>
                  {g.categories.map((c) => (
                    <div key={c.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`${id}-${c.id}`}
                        checked={checked.has(c.id)}
                        onCheckedChange={(on) => {
                          const next = new Set(checked);
                          if (on === true) next.add(c.id);
                          else next.delete(c.id);
                          setChecked(next);
                        }}
                      />
                      <Label htmlFor={`${id}-${c.id}`} className="font-normal">
                        {c.name}
                      </Label>
                    </div>
                  ))}
                </fieldset>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Manage Views: Underfunded, Overfunded, Money Available, Snoozed and the custom views in
 * one list to drag into order (All and Overspent stay first); custom views can be edited and
 * deleted (asked on the row), presets can't.
 */
export function ManageViewsDialog({
  open,
  onClose,
  order,
  views,
  actions,
  onEdit,
  onNew,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  order: readonly string[];
  views: readonly CustomView[];
  actions: ViewActions;
  onEdit: (view: CustomView) => void;
  onNew: () => void;
  onDeleted: (viewId: string) => void;
}) {
  const [items, setItems] = useState<string[]>(() => [...order]);
  const [confirming, setConfirming] = useState<string>();
  useEffect(() => setItems([...order]), [order]);
  useEffect(() => {
    if (!open) setConfirming(undefined);
  }, [open]);
  const byId = new Map(views.map((v) => [v.id, v]));
  const full = views.length >= MAX_CUSTOM_VIEWS;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Views</DialogTitle>
          <DialogDescription className="sr-only">
            Drag the views into order, or edit and delete custom views.
          </DialogDescription>
        </DialogHeader>
        <DragDropProvider
          onDragOver={(event) => setItems((current) => move(current, event))}
          onDragEnd={(event) => {
            if (event.canceled) {
              setItems([...order]);
              return;
            }
            if (items.join() !== order.join()) void actions.reorder(items);
          }}
        >
          <ul className="grid max-h-[60vh] gap-1.5 overflow-y-auto" aria-label="Views">
            {items.map((key, index) => {
              const view = byId.get(key);
              const label = view?.name ?? PRESET_LABELS[key];
              if (!label) return null;
              return (
                <ViewRow
                  key={key}
                  id={key}
                  index={index}
                  label={label}
                  confirming={confirming === key}
                  onEdit={view && (() => onEdit(view))}
                  onDelete={view && (() => setConfirming(key))}
                  onCancelDelete={() => setConfirming(undefined)}
                  onConfirmDelete={async () => {
                    setConfirming(undefined);
                    await actions.remove(key);
                    onDeleted(key);
                  }}
                />
              );
            })}
          </ul>
        </DragDropProvider>
        <DialogFooter className="items-center">
          {full && <p className="mr-auto text-muted-foreground text-xs">{LIMIT_MESSAGE}</p>}
          <Button variant="outline" disabled={full} onClick={onNew}>
            New View
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ViewRow({
  id,
  index,
  label,
  confirming,
  onEdit,
  onDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  id: string;
  index: number;
  label: string;
  confirming: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => Promise<void>;
}) {
  const { ref, handleRef, isDragSource } = useSortable({ id, index, type: "view", accept: "view" });
  return (
    <li
      ref={ref}
      className={cn(
        "flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-sm",
        isDragSource && "opacity-60",
      )}
    >
      {confirming ? (
        <span className="size-6" />
      ) : (
        <button
          ref={handleRef}
          type="button"
          aria-label={`Drag ${label}`}
          className="flex size-6 cursor-grab items-center justify-center text-muted-foreground"
        >
          <GripVertical className="size-4" />
        </button>
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {confirming ? (
        <>
          <Button size="sm" variant="outline" onClick={onCancelDelete}>
            Cancel
          </Button>
          <Button size="sm" variant="destructive" onClick={() => void onConfirmDelete()}>
            Delete
          </Button>
        </>
      ) : (
        <>
          {onEdit && (
            <Button variant="ghost" size="icon-xs" aria-label={`Edit ${label}`} onClick={onEdit}>
              <Pencil />
            </Button>
          )}
          {onDelete && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Delete ${label}`}
              onClick={onDelete}
            >
              <Trash2 />
            </Button>
          )}
        </>
      )}
    </li>
  );
}
