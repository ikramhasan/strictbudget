import { CollisionPriority } from "@dnd-kit/abstract";
import { move } from "@dnd-kit/helpers";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@strictbudget/ui/components/alert-dialog";
import { Button } from "@strictbudget/ui/components/button";
import { Checkbox } from "@strictbudget/ui/components/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@strictbudget/ui/components/empty";
import { Label } from "@strictbudget/ui/components/label";
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@strictbudget/ui/components/popover";
import { useIsMobile } from "@strictbudget/ui/hooks/use-mobile";
import { cn } from "@strictbudget/ui/lib/utils";
import { ChevronRight, GripVertical, Plus, StickyNote } from "lucide-react";
import { type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useOptionalBudget } from "@/lib/budget-context";
import {
  availableMark,
  isCaution,
  summarize,
  toTotals,
  UNCATEGORIZED as UNCATEGORIZED_ID,
} from "@/lib/budget-view";
import {
  type Category,
  type CategoryGroup,
  type CategoryList as CategoryListData,
  hiddenItems,
  locateCategory,
  nextId,
  type VisibleLayout,
  visibleLayout,
} from "@/lib/categories";
import type { BudgetMonthData, MonthTotals } from "@/lib/months";
import { stepSelection } from "@/lib/selection";
import { useShortcut } from "@/lib/shortcuts";
import { categoryRowNote } from "@/lib/targets";
import { type AssignActions, AssignedCell } from "./assigned-cell";
import { ActivityButton, type ActivityTarget, type CardSummary } from "./category-activity";
import { CategoryMovesButton, type CategoryMovesContext } from "./category-moves";
import { AvailableButton, AvailablePill, type MoveActions } from "./move-money";
import { NamePopover } from "./name-popover";
import { ProgressBar } from "./progress-bar";

export interface CategoryListActions {
  createGroup: (name: string) => Promise<void>;
  createCategory: (groupId: string, name: string) => Promise<void>;
  updateGroup: (groupId: string, patch: { name?: string; hidden?: boolean }) => Promise<void>;
  updateCategory: (
    categoryId: string,
    patch: { name?: string; note?: string; hidden?: boolean },
  ) => Promise<void>;
  /** `reassignTo` receives the history of categories that have transactions. */
  deleteGroup: (groupId: string, reassignTo?: string) => Promise<void>;
  deleteCategory: (categoryId: string, reassignTo?: string) => Promise<void>;
  moveGroup: (groupId: string, beforeGroupId: string | null) => Promise<void>;
  moveCategory: (
    categoryId: string,
    groupId: string,
    beforeCategoryId: string | null,
  ) => Promise<void>;
}

type PendingDelete = {
  kind: "group" | "category";
  id: string;
  name: string;
  /** Categories that disappear with it. */
  deletedIds: string[];
  hasTransactions: boolean;
  transactionCount: number;
} | null;

/** A month's numbers for the list, with the budget's amount formatting. */
export interface CategoryFigures {
  month: BudgetMonthData;
  /** The user's current month (payment categories warn from it on). */
  currentMonth: string;
  /** Formats an amount in minor units (an integer string) in the month's currency. */
  format: (minorUnits: string) => string;
  /** Makes the Assigned column editable. */
  assign?: AssignActions;
  /** A category whose Assigned starts out being edited (the payoff simulator's "Copy and go"). */
  editAssigned?: string;
  /** Called once that edit has opened. */
  onEditAssignedStarted?: () => void;
  /** Makes Available open the move and cover popovers. */
  move?: MoveActions;
  /** Makes Activity open the transactions behind it. */
  activity?: { budgetId: string; formatDate: (isoDate: string) => string };
  /** Row checkboxes; clicking a name selects only that category. */
  selection?: SelectionActions;
  /**
   * Ids a view (Overspent, Money Available) keeps, `UNCATEGORIZED` included; undefined shows
   * everything. A view leaves hidden categories and empty groups out and can't be reordered.
   */
  shown?: ReadonlySet<string>;
  /**
   * What to say when a view keeps nothing, with a way back to All (and, for a custom view, to
   * edit it).
   */
  emptyView?: { message: string; onViewAll: () => void; onEdit?: () => void };
  /** The Progress Bars setting: off hides the bars and the notes under category names. */
  progressBars?: boolean;
  /** The month's moves, for the history button next to Assigned (recent months only). */
  moves?: CategoryMovesContext;
  /** A category to scroll into view (a new object each time it's asked for). */
  scrollTo?: { id: string };
}

export interface SelectionActions {
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  selectOnly: (id: string) => void;
  /** Selects these, or clears the selection with an empty list. */
  setAll: (ids: string[]) => void;
}

const NO_GROUPS: ReadonlySet<string> = new Set();
/**
 * Every row shares one grid so the figures line up whatever a name's length. A list narrower
 * than the columns scrolls sideways instead of squeezing them (mobile gets its own pass).
 */
// Assigned and Activity fit "-$10,000.00"; Available keeps room for its pill and icon.
// On a phone a row is its name and Available, a thumb's height; Assigned and Activity are in the
// category's drawer.
const ROW =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1 px-2 py-1.5 max-md:min-h-12 md:grid-cols-[minmax(10rem,1fr)_6.5rem_6.5rem_7.5rem]";
/** The plan's keys also work from a category's open Assigned input. */
const inAssigned = (target: Element) => target.closest("[data-assigned-cell]") !== null;
/** Cells left off a phone's narrow rows. */
const WIDE_ONLY = "max-md:hidden";
const NAME_CELL = "flex min-w-0 items-center gap-1";
const FIGURE = "min-w-0 truncate text-right tabular-nums";
/**
 * The inset of a figure's text from its column's right edge. The Assigned input, the Activity
 * button and the Available pill all pad their text by this much, so plain figures (headers, group
 * totals, read-only cells) take the same padding to line up with them.
 */
const FIGURE_PAD = "px-2";
/** Lets a name button shrink and truncate (shadcn's Button doesn't shrink by default). */
const NAME_BUTTON = "min-w-0 shrink justify-start";
// The shared Table's look (ui.ikramhasan.com's data table): a muted tray, the header on it, the
// rows on a raised card. Group rows and the hidden-categories row take a tint a step deeper than
// a hovered row's, so the two read apart in both themes.
const TRAY =
  "overflow-x-auto rounded-xl bg-muted px-[5px] pb-[5px] ring-1 ring-border dark:bg-[color-mix(in_oklch,var(--background),black_20%)]";
const BODY =
  "overflow-hidden rounded-[10px] border bg-background shadow-[0_1px_2px_rgb(0_0_0/0.04)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.4)]";
const GROUP_ROW =
  "bg-[color-mix(in_oklch,var(--muted),var(--foreground)_6%)] dark:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_8%)]";
const HOVER_ROW =
  "hover:bg-muted dark:hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_3%)]";
const SELECTED_ROW =
  "bg-[color-mix(in_oklch,var(--primary)_6%,var(--background))] dark:bg-[color-mix(in_oklch,var(--primary)_14%,var(--background))]";
/**
 * Every row starts with the same two slots, each the width of an icon button, so the controls and
 * names line up: a group's collapse button (a category's drag handle), then the checkbox. Rows
 * without one get a spacer. A group's drag handle follows its name.
 */
const SLOT = "flex size-6 shrink-0 items-center justify-center";
/**
 * Drag handles show on the row's hover or keyboard focus (always on touch screens, which can't
 * hover), so they don't cost a column of their own.
 */
const HOVER_REVEAL =
  "opacity-0 transition-opacity duration-100 group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 max-md:invisible";

/** Draggable types: payment categories only move within the Credit Card Payments group. */
const categoryType = (c: Category) => (c.linkedAccountId ? "payment" : "category");

/**
 * The budget screen: groups and categories with the month's Assigned, Activity and Available,
 * drag to reorder, collapsible groups and the Hidden Categories row.
 */
export function CategoryList({
  data,
  actions,
  figures,
  collapsed = NO_GROUPS,
  onCollapsedChange,
  addGroupDisabled = false,
}: {
  data: CategoryListData;
  actions: CategoryListActions;
  figures?: CategoryFigures;
  collapsed?: ReadonlySet<string>;
  onCollapsedChange?: (collapsed: ReadonlySet<string>) => void;
  /** Greys out the header's "Add a category group" button (as in a custom view). */
  addGroupDisabled?: boolean;
}) {
  // A viewer can't add, rename, hide, delete or reorder.
  const readOnly = useOptionalBudget()?.readOnly ?? false;
  const serverLayout = useMemo(() => visibleLayout(data), [data]);
  const [layout, setLayout] = useState<VisibleLayout>(serverLayout);
  const beforeDrag = useRef(layout);
  const dragging = useRef(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [reassignTo, setReassignTo] = useState("");

  // Follow the server unless a drag is in progress.
  useEffect(() => {
    if (!dragging.current) setLayout(serverLayout);
  }, [serverLayout]);

  const groupsById = useMemo(() => new Map(data.groups.map((g) => [g.id, g])), [data]);
  const categoriesById = useMemo(
    () => new Map(data.groups.flatMap((g) => g.categories.map((c) => [c.id, c] as const))),
    [data],
  );
  const hidden = useMemo(() => hiddenItems(data), [data]);
  const categoryFigures = useMemo(
    () => new Map(figures?.month.categories.map((c) => [c.categoryId, c])),
    [figures],
  );
  const groupFigures = useMemo(
    () => new Map(figures?.month.groups.map((g) => [g.groupId, g])),
    [figures],
  );
  const allCollapsed =
    layout.groupOrder.length > 0 && layout.groupOrder.every((id) => collapsed.has(id));
  const selection = figures?.selection;
  const shown = figures?.shown;
  // A view keeps the groups with a category in it, and only those categories.
  const groupOrder = shown
    ? layout.groupOrder.filter((g) => (layout.items[g] ?? []).some((c) => shown.has(c)))
    : layout.groupOrder;
  const itemsOf = (groupId: string) =>
    (layout.items[groupId] ?? []).filter((c) => !shown || shown.has(c));
  const showUncategorized =
    Boolean(figures?.month.uncategorized) && (!shown || shown.has(UNCATEGORIZED_ID));
  // "Check all" checks what's on screen.
  const selectable = [
    ...(showUncategorized ? [UNCATEGORIZED_ID] : []),
    ...groupOrder.flatMap((g) => itemsOf(g)),
  ];
  const allChecked = selectable.length > 0 && selectable.every((id) => selection?.selected.has(id));

  function toggleGroupSelection(groupId: string) {
    if (!selection) return;
    const ids = itemsOf(groupId);
    const all = ids.length > 0 && ids.every((id) => selection.selected.has(id));
    const next = new Set(selection.selected);
    for (const id of ids) {
      if (all) next.delete(id);
      else next.add(id);
    }
    selection.setAll([...next]);
  }

  // Up/Down walk the categories on screen, opening each one's Assigned amount; Shift extends;
  // Cmd/Ctrl+Up/Down collapse and expand groups.
  const cursor = useRef<{ anchor: string | null; head: string | null }>({
    anchor: null,
    head: null,
  });
  const [keyEdit, setKeyEdit] = useState<string | undefined>();
  const onScreen = [
    ...(showUncategorized ? [UNCATEGORIZED_ID] : []),
    ...groupOrder.filter((g) => !collapsed.has(g)).flatMap((g) => itemsOf(g)),
  ];
  const groupOf = (id: string) => groupOrder.find((g) => (layout.items[g] ?? []).includes(id));
  /** Leaves an open Assigned input, saving it, as moving away from it does. */
  function leaveAssigned() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest("[data-assigned-cell]")) active.blur();
  }
  function stepCategories(direction: 1 | -1, extend: boolean) {
    if (!selection) return;
    const next = stepSelection(onScreen, selection.selected, cursor.current, direction, {
      extend,
      several: "none",
    });
    if (!next) return;
    cursor.current = next.cursor;
    leaveAssigned();
    selection.setAll(next.ids);
    const id = next.cursor.head;
    if (!id) return;
    if (!extend && id !== UNCATEGORIZED_ID && figures?.assign) setKeyEdit(id);
    document.querySelector(`[data-category-row="${id}"]`)?.scrollIntoView?.({ block: "nearest" });
  }
  const keys = { enabled: selection !== undefined, allowIn: inAssigned };
  useShortcut("moveRows", (e) => stepCategories(e.key === "ArrowUp" ? -1 : 1, false), keys);
  useShortcut("extendCategories", (e) => stepCategories(e.key === "ArrowUp" ? -1 : 1, true), keys);
  useShortcut(
    "collapseGroups",
    (e) => {
      const up = e.key === "ArrowUp";
      if (!selection || selection.selected.size === 0) {
        onCollapsedChange?.(up ? new Set(layout.groupOrder) : new Set());
        return;
      }
      // With categories selected, Up folds their groups and Down leaves them open; both clear the
      // selection.
      leaveAssigned();
      if (!up) {
        selection.setAll([]);
        return;
      }
      const next = new Set(collapsed);
      for (const id of selection.selected) {
        const g = groupOf(id);
        if (g) next.add(g);
      }
      leaveAssigned();
      selection.setAll([]);
      onCollapsedChange?.(next);
    },
    keys,
  );
  useShortcut("selectAll", () => selection?.setAll(selectable), {
    enabled: selection !== undefined,
  });
  useShortcut("deselectAll", () => selection?.setAll([]), {
    enabled: (selection?.selected.size ?? 0) > 0,
  });

  function toggleGroup(groupId: string) {
    const next = new Set(collapsed);
    if (!next.delete(groupId)) next.add(groupId);
    onCollapsedChange?.(next);
  }

  function requestDelete(kind: "group" | "category", id: string, name: string) {
    const deleted =
      kind === "group" ? (groupsById.get(id)?.categories ?? []) : [categoriesById.get(id)];
    const hasTransactions = deleted.some((c) => c?.hasTransactions);
    // A category with neither transactions nor assigned money is deleted straight away.
    if (kind === "category" && !hasTransactions && !deleted[0]?.hasAssignedMoney) {
      void actions.deleteCategory(id);
      return;
    }
    setReassignTo("");
    setPendingDelete({
      kind,
      id,
      name,
      deletedIds: deleted.flatMap((c) => (c ? [c.id] : [])),
      hasTransactions,
      transactionCount: deleted.reduce((n, c) => n + (c?.transactionCount ?? 0), 0),
    });
  }

  // Where a deleted category's history can go: any other regular category.
  const reassignTargets = useMemo(
    () =>
      data.groups
        .filter((g) => !g.kind)
        .map((g) => ({
          group: g.name,
          categories: g.categories.filter((c) => !pendingDelete?.deletedIds.includes(c.id)),
        }))
        .filter((g) => g.categories.length > 0),
    [data, pendingDelete],
  );

  async function confirmDelete() {
    if (!pendingDelete) return;
    const { kind, id, hasTransactions } = pendingDelete;
    const target = hasTransactions ? reassignTo : undefined;
    setPendingDelete(null);
    await (kind === "group" ? actions.deleteGroup(id, target) : actions.deleteCategory(id, target));
  }

  return (
    <div className="grid gap-4">
      <div className={TRAY}>
        <div className="min-w-fit">
          <div className={cn(ROW, "font-medium text-[13px] text-muted-foreground")}>
            <div className={NAME_CELL}>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={allCollapsed ? "Expand all groups" : "Collapse all groups"}
                onClick={() =>
                  onCollapsedChange?.(allCollapsed ? new Set() : new Set(layout.groupOrder))
                }
              >
                <ChevronRight
                  className={cn(
                    "transition-transform duration-150 ease-out-quint motion-reduce:transition-none",
                    !allCollapsed && "rotate-90",
                  )}
                />
              </Button>
              {selection && (
                <span className={cn(SLOT, WIDE_ONLY)}>
                  <Checkbox
                    aria-label={allChecked ? "Uncheck all" : "Check all"}
                    checked={allChecked}
                    onCheckedChange={() => selection.setAll(allChecked ? [] : selectable)}
                  />
                </span>
              )}
              <span className="truncate px-2">Category</span>
              {!readOnly && (
                <NamePopover
                  title="New category group"
                  withEmoji
                  submitLabel="Add"
                  onSubmit={({ name }) => actions.createGroup(name)}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Add a category group"
                      title="Add a category group"
                      disabled={addGroupDisabled}
                      className="-ml-1 text-muted-foreground"
                    >
                      <Plus />
                    </Button>
                  }
                />
              )}
            </div>
            {figures && (
              <>
                <span className={cn(FIGURE, FIGURE_PAD, WIDE_ONLY)}>Assigned</span>
                <span className={cn(FIGURE, FIGURE_PAD, WIDE_ONLY)}>Activity</span>
                <span className={cn(FIGURE, FIGURE_PAD)}>Available</span>
              </>
            )}
          </div>
          <div className={BODY}>
            {figures?.month.uncategorized && showUncategorized && (
              <div
                className={cn(
                  ROW,
                  "border-b text-sm",
                  selection?.selected.has(UNCATEGORIZED_ID) && SELECTED_ROW,
                )}
              >
                <div className={NAME_CELL}>
                  <Spacer />
                  {selection && (
                    <RowCheckbox
                      id={UNCATEGORIZED_ID}
                      name="Uncategorized Transactions"
                      selection={selection}
                    />
                  )}
                  {selection ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      className={cn(NAME_BUTTON, "font-normal text-sm")}
                      onClick={() => selection.selectOnly(UNCATEGORIZED_ID)}
                    >
                      <span className="truncate">Uncategorized Transactions</span>
                    </Button>
                  ) : (
                    <span className="truncate px-2">Uncategorized Transactions</span>
                  )}
                </div>
                {/* A dash: money can't be assigned to Uncategorized. */}
                <span className={cn(FIGURE, FIGURE_PAD, WIDE_ONLY)}>–</span>
                <span className={cn(FIGURE, "text-sm", WIDE_ONLY)}>
                  <Activity
                    figures={figures}
                    target={{ uncategorized: true }}
                    name="Uncategorized Transactions"
                    amount={figures.month.uncategorized.activity}
                  />
                </span>
                <span className={FIGURE}>
                  <AvailablePill
                    amount={figures.month.uncategorized.available}
                    format={figures.format}
                  />
                </span>
              </div>
            )}
            <DragDropProvider
              onDragStart={() => {
                dragging.current = true;
                beforeDrag.current = layout;
              }}
              onDragOver={(event) => {
                const type = event.operation.source?.type;
                if (type !== "category" && type !== "payment") return;
                setLayout((l) => ({ ...l, items: move(l.items, event) }));
              }}
              onDragEnd={(event) => {
                dragging.current = false;
                const source = event.operation.source;
                if (event.canceled || !source) {
                  setLayout(beforeDrag.current);
                  return;
                }
                const id = String(source.id);
                if (source.type === "group") {
                  const groupOrder = move(layout.groupOrder, event);
                  setLayout((l) => ({ ...l, groupOrder }));
                  // Credit Card Payments stays pinned first; order the other groups around it.
                  const movable = (order: string[]) =>
                    order.filter((g) => !groupsById.get(g)?.kind);
                  const before = nextId(movable(groupOrder), id);
                  if (before !== nextId(movable(beforeDrag.current.groupOrder), id)) {
                    void actions.moveGroup(id, before);
                  }
                  return;
                }
                const now = locateCategory(layout.items, id);
                const was = locateCategory(beforeDrag.current.items, id);
                if (
                  now &&
                  (now.groupId !== was?.groupId || now.beforeCategoryId !== was?.beforeCategoryId)
                ) {
                  void actions.moveCategory(id, now.groupId, now.beforeCategoryId);
                }
              }}
            >
              {groupOrder.map((groupId, groupIndex) => {
                const group = groupsById.get(groupId);
                if (!group) return null;
                return (
                  <GroupSection
                    key={groupId}
                    group={group}
                    index={groupIndex}
                    actions={actions}
                    totals={
                      // Under a view a group totals only its categories in view.
                      shown && figures
                        ? toTotals(summarize(figures.month, itemsOf(groupId)))
                        : groupFigures.get(groupId)
                    }
                    figures={figures}
                    reorderable={!shown && !readOnly}
                    onToggleSelection={selection && (() => toggleGroupSelection(groupId))}
                    checked={
                      selection &&
                      itemsOf(groupId).length > 0 &&
                      itemsOf(groupId).every((id) => selection.selected.has(id))
                    }
                    collapsed={collapsed.has(groupId)}
                    onToggle={() => toggleGroup(groupId)}
                    onDelete={() => requestDelete("group", group.id, group.name)}
                  >
                    {itemsOf(groupId).map((categoryId, index) => {
                      const category = categoriesById.get(categoryId);
                      if (!category) return null;
                      return (
                        <CategoryRow
                          key={categoryId}
                          category={category}
                          index={index}
                          groupId={groupId}
                          actions={actions}
                          totals={categoryFigures.get(categoryId)}
                          figures={figures}
                          reorderable={!shown && !readOnly}
                          onDelete={() => requestDelete("category", category.id, category.name)}
                          keyEdit={keyEdit === categoryId}
                          onKeyEditStarted={() => setKeyEdit(undefined)}
                        />
                      );
                    })}
                  </GroupSection>
                );
              })}
            </DragDropProvider>
            {shown && selectable.length === 0 && figures?.emptyView && (
              <Empty>
                <EmptyHeader>
                  <EmptyDescription>{figures.emptyView.message}</EmptyDescription>
                </EmptyHeader>
                <div className="flex gap-2">
                  {figures.emptyView.onEdit && (
                    <Button variant="secondary" size="sm" onClick={figures.emptyView.onEdit}>
                      Edit View
                    </Button>
                  )}
                  <Button variant="link" size="sm" onClick={figures.emptyView.onViewAll}>
                    View All
                  </Button>
                </div>
              </Empty>
            )}
            {shown && selectable.length > 0 && figures?.emptyView && (
              <p className="flex items-center justify-center gap-1 border-t px-2 py-3 text-muted-foreground text-sm">
                Some categories are hidden by your current view.
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={figures.emptyView.onViewAll}
                >
                  View All
                </Button>
              </p>
            )}
            {layout.groupOrder.length === 0 && (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No categories yet</EmptyTitle>
                  <EmptyDescription>Add a category group to get started.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {!shown && (
              <HiddenRow
                hidden={hidden}
                actions={actions}
                totals={figures?.month.hidden}
                format={figures?.format}
                withCheckboxes={Boolean(selection)}
              />
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          {pendingDelete?.kind === "category" ? (
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Category</AlertDialogTitle>
              <AlertDialogDescription className="grid gap-2">
                {pendingDelete.hasTransactions ? (
                  <span>
                    Before you can delete the category <strong>{pendingDelete.name}</strong>, you'll
                    need to reassign your past activity to a new category.
                  </span>
                ) : (
                  <>
                    <span>
                      There is money currently assigned to <strong>{pendingDelete.name}</strong>.
                    </span>
                    <span>
                      When you delete this category, all assigned amounts will be moved to{" "}
                      <strong>Ready to Assign</strong>.
                    </span>
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
          ) : (
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{pendingDelete?.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                The group and all of its categories will be deleted. If you might need it later,
                hide it instead.
              </AlertDialogDescription>
            </AlertDialogHeader>
          )}
          {pendingDelete?.hasTransactions && (
            <div className="grid gap-2">
              <Label htmlFor="reassign-to">
                {pendingDelete.kind === "category" ? "Select category" : "Move its transactions to"}
              </Label>
              <NativeSelect
                id="reassign-to"
                value={reassignTo}
                onChange={(e) => setReassignTo(e.target.value)}
              >
                <NativeSelectOption value="" disabled>
                  Select a category…
                </NativeSelectOption>
                {reassignTargets.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.categories.map((c) => (
                      <NativeSelectOption key={c.id} value={c.id}>
                        {c.name}
                      </NativeSelectOption>
                    ))}
                  </optgroup>
                ))}
              </NativeSelect>
              {pendingDelete.kind === "category" && (
                <div className="grid gap-1 text-sm">
                  <p className="font-medium">Here's what will be reassigned to the new category:</p>
                  <ul className="list-disc ps-5 text-muted-foreground">
                    <li>All transactions [{pendingDelete.transactionCount}]</li>
                    <li>All assigned amounts</li>
                    <li>Any remaining available amount</li>
                  </ul>
                </div>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmDelete}
              disabled={pendingDelete?.hasTransactions === true && !reassignTo}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function GroupSection({
  group,
  index,
  actions,
  totals,
  figures,
  reorderable,
  checked,
  onToggleSelection,
  collapsed,
  onToggle,
  onDelete,
  children,
}: {
  group: CategoryGroup;
  index: number;
  actions: CategoryListActions;
  totals: MonthTotals | undefined;
  figures: CategoryFigures | undefined;
  reorderable: boolean;
  checked: boolean | undefined;
  onToggleSelection: (() => void) | undefined;
  collapsed: boolean;
  onToggle: () => void;
  onDelete: () => void;
  children: ReactNode;
}) {
  const managed = group.kind === "credit_card_payments";
  const readOnly = useOptionalBudget()?.readOnly ?? false;
  const format = figures?.format;
  const { ref, handleRef, isDragSource } = useSortable({
    id: group.id,
    index,
    type: "group",
    // Credit Card Payments is pinned and only takes payment categories.
    disabled: managed || !reorderable,
    accept: managed ? ["payment"] : ["group", "category"],
    // Let categories win collisions so they can be dropped between rows of this group.
    collisionPriority: CollisionPriority.Low,
  });

  return (
    <section
      ref={ref}
      aria-label={group.name}
      className={cn("border-b bg-background last:border-b-0", isDragSource && "opacity-60")}
    >
      {/* An empty handle keeps dnd-kit's button role off a group that can't move. */}
      {(managed || !reorderable) && <span ref={handleRef} hidden />}
      <div className={cn(ROW, "group/row", GROUP_ROW)}>
        <div className={NAME_CELL}>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.name}`}
            aria-expanded={!collapsed}
            onClick={onToggle}
          >
            <ChevronRight
              className={cn(
                "transition-transform duration-150 ease-out-quint motion-reduce:transition-none",
                !collapsed && "rotate-90",
              )}
            />
          </Button>
          {onToggleSelection && (
            <span className={cn(SLOT, WIDE_ONLY)}>
              <Checkbox
                aria-label={`Select ${group.name}`}
                checked={checked ?? false}
                onCheckedChange={onToggleSelection}
              />
            </span>
          )}
          {managed ? (
            // px-2 like the name buttons, so every group name starts at the same x.
            <span className="truncate px-2 font-semibold text-sm">{group.name}</span>
          ) : (
            <>
              <NamePopover
                title="Category group name"
                withEmoji
                initial={{ name: group.name, note: "" }}
                onSubmit={({ name }) => actions.updateGroup(group.id, { name })}
                actions={(close) => (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        close();
                        await actions.updateGroup(group.id, { hidden: true });
                      }}
                    >
                      Hide
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-destructive"
                      onClick={() => {
                        close();
                        onDelete();
                      }}
                    >
                      Delete
                    </Button>
                  </>
                )}
                trigger={
                  <Button
                    variant="ghost"
                    size="xs"
                    className={cn(NAME_BUTTON, "font-semibold text-sm")}
                  >
                    <span className="truncate">{group.name}</span>
                  </Button>
                }
              />
              {!readOnly && (
                <NamePopover
                  title={`New category in ${group.name}`}
                  withEmoji
                  submitLabel="Add"
                  onSubmit={({ name }) => actions.createCategory(group.id, name)}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Add a category to ${group.name}`}
                    >
                      <Plus />
                    </Button>
                  }
                />
              )}
              {reorderable && (
                <DragHandle
                  ref={handleRef}
                  label={`Reorder ${group.name}`}
                  className={HOVER_REVEAL}
                />
              )}
            </>
          )}
        </div>
        {totals && format && (
          <TotalCells
            totals={totals}
            format={format}
            activity={
              figures && (
                <Activity
                  figures={figures}
                  target={{ groupId: group.id }}
                  name={group.name}
                  amount={totals.activity}
                />
              )
            }
          />
        )}
      </div>
      {!collapsed && <div className="min-h-2">{children}</div>}
    </section>
  );
}

/**
 * Scroll requests already handled, so a row remounting (its group expanded again, a view
 * switched) doesn't jump back to it. Each `setScrollTo` makes a new request object.
 */
const scrolledTo = new WeakSet<object>();

function CategoryRow({
  category,
  index,
  groupId,
  actions,
  totals,
  figures,
  reorderable,
  onDelete,
  keyEdit = false,
  onKeyEditStarted,
}: {
  category: Category;
  index: number;
  groupId: string;
  actions: CategoryListActions;
  totals: BudgetMonthData["categories"][number] | undefined;
  figures: CategoryFigures | undefined;
  reorderable: boolean;
  onDelete: () => void;
  /** Up/Down arrived here: open the Assigned amount for typing. */
  keyEdit?: boolean;
  onKeyEditStarted?: () => void;
}) {
  const { format, assign, move, selection } = figures ?? {};
  const isPayment = Boolean(category.linkedAccountId);
  const caution =
    totals && figures ? isCaution(totals, figures.month.month, figures.currentMonth) : false;
  const { ref, handleRef, isDragSource } = useSortable({
    id: category.id,
    index,
    group: groupId,
    type: categoryType(category),
    accept: [categoryType(category)],
    disabled: !reorderable,
  });
  const selected = selection?.selected.has(category.id) ?? false;
  // Clicking a name selects that category alone; clicking it again opens its editor.
  const onlySelected = selected && selection?.selected.size === 1;
  // Set by a click on the row: opens its Assigned amount for typing.
  const [editAssigned, setEditAssigned] = useState(false);
  // A phone has no Assigned cell in the row: the tap opens the category's drawer instead.
  const phone = useIsMobile();
  function selectAndEdit() {
    selection?.selectOnly(category.id);
    if (assign && !phone) setEditAssigned(true);
  }
  /**
   * A click anywhere on the row selects it alone and starts editing its Assigned amount, as does
   * checking the first box of a selection. Other controls in the row (drag handle, Activity,
   * Available) keep their own click, and clicks inside their popovers, which React bubbles here
   * through the portal, are skipped.
   */
  function onRowClick(e: MouseEvent<HTMLDivElement>) {
    if (!selection || !e.currentTarget.contains(e.target as Node)) return;
    const target = e.target as Element;
    if (target.closest("[data-assigned-cell]")) {
      if (!onlySelected) selection.selectOnly(category.id);
      return;
    }
    if (target.closest("[role=checkbox]")) {
      // The checkbox has already toggled; this row is now the only one selected when nothing was.
      if (!selected && selection.selected.size === 0 && assign) setEditAssigned(true);
      return;
    }
    if (target.closest("button, a, input, label")) return;
    selectAndEdit();
  }
  const scrollTo = figures?.scrollTo;
  useEffect(() => {
    if (scrollTo?.id !== category.id || scrolledTo.has(scrollTo)) return;
    scrolledTo.add(scrollTo);
    document
      .querySelector(`[data-category-row="${category.id}"]`)
      ?.scrollIntoView?.({ block: "center" });
  }, [scrollTo, category.id]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a larger mouse target for the name and Assigned buttons
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users reach the same actions through those buttons
    <div
      data-category-row={category.id}
      ref={ref}
      className={cn(
        ROW,
        // The whole row selects on click, so it lights up on hover; selection wins over hover.
        "group/row border-t transition-colors duration-100 first:border-t-0",
        isDragSource && "opacity-60",
        selected ? SELECTED_ROW : HOVER_ROW,
      )}
      onClick={onRowClick}
    >
      <div className="grid min-w-0 gap-1">
        <div className={NAME_CELL}>
          {/* The handle takes the slot a group's chevron uses, shown when the row is hovered. */}
          {reorderable ? (
            <DragHandle
              ref={handleRef}
              label={`Reorder ${category.name}`}
              className={HOVER_REVEAL}
            />
          ) : (
            <>
              <Spacer />
              {/* An empty handle keeps dnd-kit's button role off the row. */}
              <span ref={handleRef} hidden />
            </>
          )}
          {selection && <RowCheckbox id={category.id} name={category.name} selection={selection} />}
          <NamePopover
            title="Category name"
            withEmoji
            withNote
            nameLockedReason={
              isPayment ? "Named after its credit account. Rename the account instead." : undefined
            }
            initial={{ name: category.name, note: category.note }}
            onSubmit={({ name, note }) => actions.updateCategory(category.id, { name, note })}
            actions={(close) => (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    close();
                    await actions.updateCategory(category.id, { hidden: true });
                  }}
                >
                  Hide
                </Button>
                {!isPayment && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    onClick={() => {
                      close();
                      onDelete();
                    }}
                  >
                    Delete
                  </Button>
                )}
              </>
            )}
            trigger={
              <Button
                variant="ghost"
                size="xs"
                className={cn(NAME_BUTTON, "font-normal text-sm")}
                onClick={(e) => {
                  if (!selection || onlySelected) return;
                  // Selecting comes first; Radix skips opening the editor on a prevented click.
                  e.preventDefault();
                  selectAndEdit();
                }}
              >
                <span className="truncate">{category.name}</span>
              </Button>
            }
          />
          {category.note && (
            <StickyNote
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-label="Has a note"
            />
          )}
          {totals &&
            format &&
            figures &&
            figures.progressBars !== false &&
            // No note under a payment category, target or not.
            !isPayment &&
            (totals.available.startsWith("-") ? (
              <OverspentNote totals={totals} format={format} />
            ) : (
              <RowNote
                note={categoryRowNote(
                  category.target,
                  totals.target,
                  totals.bar,
                  figures.month.month,
                  format,
                )}
              />
            ))}
        </div>
        {totals?.bar && figures?.progressBars !== false && (
          // Lined up with the name, past the two slots and the name button's padding.
          <ProgressBar bar={totals.bar} className="mr-1 ml-16" />
        )}
      </div>
      {totals && format && (
        <>
          <div data-assigned-cell className={cn("group/assigned relative min-w-0", WIDE_ONLY)}>
            {assign ? (
              <AssignedCell
                categoryId={category.id}
                categoryName={category.name}
                amount={totals.assigned}
                format={format}
                actions={assign}
                startEditing={editAssigned || keyEdit || figures?.editAssigned === category.id}
                onStartedEditing={() => {
                  setEditAssigned(false);
                  onKeyEditStarted?.();
                  figures?.onEditAssignedStarted?.();
                }}
              />
            ) : (
              <span className={cn(FIGURE, FIGURE_PAD, "block text-sm")}>
                {format(totals.assigned)}
              </span>
            )}
            {figures?.moves?.withMoves.has(category.id) && (
              // Just past the amount, in the gap before Activity's right-aligned figure.
              <span className="absolute top-1/2 left-full -translate-y-1/2">
                <CategoryMovesButton
                  categoryId={category.id}
                  categoryName={category.name}
                  context={figures.moves}
                  format={format}
                  visible={selected}
                />
              </span>
            )}
          </div>
          <span className={cn(FIGURE, "text-sm", WIDE_ONLY)}>
            {figures && (
              <Activity
                figures={figures}
                target={{ categoryId: category.id }}
                name={category.name}
                amount={totals.activity}
                card={isPayment ? totals.payment : undefined}
              />
            )}
          </span>
          <span className={FIGURE}>
            {move ? (
              <AvailableButton
                categoryId={category.id}
                categoryName={category.name}
                amount={totals.available}
                format={format}
                actions={move}
                caution={caution}
                target={availableMark(totals)}
              />
            ) : (
              <AvailablePill
                amount={totals.available}
                format={format}
                caution={caution}
                target={availableMark(totals)}
              />
            )}
          </span>
        </>
      )}
    </div>
  );
}

/** The note under a category's name: its target's status, or what was spent. */
function RowNote({ note }: { note: { strong: string; rest: string } | null }) {
  if (!note) return null;
  return (
    <span className="min-w-0 flex-1 basis-0 truncate pl-2 text-right text-muted-foreground text-xs">
      {note.strong && <span className="font-medium text-foreground">{note.strong}</span>}
      {note.rest}
    </span>
  );
}

/**
 * The note on an overspent category: what was spent of what it had (carried in plus assigned),
 * e.g. "Overspent. $25.00 of $10.00".
 */
function OverspentNote({
  totals,
  format,
}: {
  totals: MonthTotals;
  format: CategoryFigures["format"];
}) {
  const spent = -BigInt(totals.activity);
  const had = BigInt(totals.available) - BigInt(totals.activity);
  return (
    <span className="min-w-0 flex-1 basis-0 truncate pl-2 text-right text-destructive text-xs">
      Overspent. {format(spent.toString())} of {format(had.toString())}
    </span>
  );
}

/** A group's or the hidden row's totals: plain numbers, lined up with the pills above them. */
function TotalCells({
  totals,
  format,
  activity,
}: {
  totals: MonthTotals;
  format: CategoryFigures["format"];
  /** Activity as a drill-down button instead of a plain number. */
  activity?: ReactNode;
}) {
  return (
    <>
      <span className={cn(FIGURE, FIGURE_PAD, "font-medium text-sm", WIDE_ONLY)}>
        {format(totals.assigned)}
      </span>
      <span className={cn(FIGURE, "font-medium text-sm", WIDE_ONLY)}>
        {activity ?? <span className={FIGURE_PAD}>{format(totals.activity)}</span>}
      </span>
      <span className={cn(FIGURE, FIGURE_PAD, "font-medium text-sm")}>
        {format(totals.available)}
      </span>
    </>
  );
}

/** Activity: a drill-down button when the list has a budget to load it from, else the number. */
function Activity({
  figures,
  target,
  name,
  amount,
  card,
}: {
  figures: CategoryFigures;
  target: ActivityTarget;
  name: string;
  amount: string;
  /** A payment category's card figures: the popover adds the card summary. */
  card?: CardSummary | null;
}) {
  if (!figures.activity) return <span className={FIGURE_PAD}>{figures.format(amount)}</span>;
  return (
    <ActivityButton
      className={FIGURE_PAD}
      budgetId={figures.activity.budgetId}
      month={figures.month.month}
      target={target}
      name={name}
      amount={amount}
      card={card ?? undefined}
      format={figures.format}
      formatDate={figures.activity.formatDate}
    />
  );
}

function RowCheckbox({
  id,
  name,
  selection,
}: {
  id: string;
  name: string;
  selection: SelectionActions;
}) {
  return (
    <span className={cn(SLOT, WIDE_ONLY)}>
      <Checkbox
        aria-label={`Select ${name}`}
        checked={selection.selected.has(id)}
        onCheckedChange={() => selection.toggle(id)}
      />
    </span>
  );
}

/** An empty slot, so a row without a control still lines up with the rows that have one. */
function Spacer() {
  return <span className={SLOT} aria-hidden />;
}

function DragHandle({
  ref,
  label,
  className,
}: {
  ref: (el: Element | null) => void;
  label: string;
  className?: string;
}) {
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      className={cn(
        "cursor-grab touch-none text-muted-foreground active:cursor-grabbing",
        className,
      )}
    >
      <GripVertical />
    </Button>
  );
}

/**
 * The "Hidden Categories" row at the bottom of the list, with the hidden categories' totals.
 * Clicking it lists them to unhide one, or all of them.
 */
function HiddenRow({
  hidden,
  actions,
  totals,
  format,
  withCheckboxes,
}: {
  hidden: ReturnType<typeof hiddenItems>;
  actions: CategoryListActions;
  totals: MonthTotals | undefined;
  format: CategoryFigures["format"] | undefined;
  /** Leaves room for the checkbox column so the name lines up. */
  withCheckboxes: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (hidden.groups.length + hidden.categories.length === 0) return null;

  // Hidden categories under their (visible) group's name.
  const byGroup = new Map<string, typeof hidden.categories>();
  for (const c of hidden.categories)
    byGroup.set(c.groupName, [...(byGroup.get(c.groupName) ?? []), c]);

  async function showAll() {
    setOpen(false);
    await Promise.all([
      ...hidden.groups.map((g) => actions.updateGroup(g.id, { hidden: false })),
      ...hidden.categories.map((c) => actions.updateCategory(c.id, { hidden: false })),
    ]);
  }

  return (
    <div className={cn(ROW, "border-t", GROUP_ROW)}>
      <div className={NAME_CELL}>
        <Spacer />
        {withCheckboxes && <Spacer />}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="xs" className={cn(NAME_BUTTON, "font-semibold text-sm")}>
              <span className="truncate">Hidden Categories</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72">
            <PopoverHeader>
              <PopoverTitle>Click to unhide a category</PopoverTitle>
            </PopoverHeader>
            <div className="grid max-h-72 gap-2 overflow-y-auto">
              {hidden.groups.map((g) => (
                <div key={g.id} className="grid">
                  <Button
                    variant="link"
                    size="xs"
                    className="justify-start px-0 font-semibold"
                    onClick={() => {
                      setOpen(false);
                      void actions.updateGroup(g.id, { hidden: false });
                    }}
                  >
                    {g.name}
                  </Button>
                  {g.categories.map((c) => (
                    <span key={c.id} className="pl-3 text-muted-foreground text-xs">
                      {c.name}
                    </span>
                  ))}
                </div>
              ))}
              {[...byGroup].map(([groupName, categories]) => (
                <div key={groupName} className="grid">
                  <span className="font-semibold text-xs">{groupName}:</span>
                  {categories.map((c) => (
                    <Button
                      key={c.id}
                      variant="link"
                      size="xs"
                      className="justify-start pl-3"
                      onClick={() => {
                        setOpen(false);
                        void actions.updateCategory(c.id, { hidden: false });
                      }}
                    >
                      {c.name}
                    </Button>
                  ))}
                </div>
              ))}
            </div>
            <Button size="sm" onClick={showAll}>
              Show all hidden categories
            </Button>
          </PopoverContent>
        </Popover>
      </div>
      {totals && format && <TotalCells totals={totals} format={format} />}
    </div>
  );
}
