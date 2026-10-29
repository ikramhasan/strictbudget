import {
  addMonths,
  type BudgetMonth,
  type CurrencyCode,
  isBudgetMonth,
} from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@strictbudget/ui/components/drawer";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useDefaultLayout,
} from "@strictbudget/ui/components/resizable";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PanelRight, Pencil, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { AddAccountDialog } from "@/components/add-account-dialog";
import { AssignedCell } from "@/components/assigned-cell";
import { AutoAssignPanel } from "@/components/auto-assign";
import { BudgetFilterBar } from "@/components/budget-filter-bar";
import { BudgetOptionsMenu } from "@/components/budget-options-menu";
import { type ViewDialog, ViewDialogs, ViewsMenu } from "@/components/budget-views";
import { CategoryHistoryPanel } from "@/components/category-history-panel";
import {
  CategoryInspector,
  MonthSummary,
  PaymentAlert,
  PaymentInspector,
} from "@/components/category-inspector";
import { type CategoryFigures, CategoryList } from "@/components/category-list";
import { ImportTemplateDialog, TemplateGallery } from "@/components/category-templates";
import { PairedLoanSection, PairedWith, usePairedLoan } from "@/components/loan-inspector";
import { useLoanPlan } from "@/components/loan-page";
import { MonthNav } from "@/components/month-nav";
import { MonthNote } from "@/components/month-note";
import {
  AssignButton,
  AvailableButton,
  AvailablePill,
  FixThisButton,
} from "@/components/move-money";
import { PageHeader } from "@/components/page-header";
import { PageTitle } from "@/components/page-title";
import { FutureMonthsPanel, ReadyToAssignBanner } from "@/components/ready-to-assign";
import { RecentMoves } from "@/components/recent-moves";
import { SpendingPacePanel } from "@/components/spending-pace-panel";
import {
  type MoneyIO,
  paymentAlertShows,
  ReadOnlyTarget,
  TargetSection,
} from "@/components/target-inspector";
import { UndoRedoButtons } from "@/components/undo-redo-buttons";
import { UpcomingTransactions } from "@/components/upcoming-transactions";
import { accountsQueryOptions } from "@/lib/accounts";
import { $api } from "@/lib/api";
import { useBudget } from "@/lib/budget-context";
import {
  availableMark,
  breakdown,
  EMPTY_VIEW,
  filteredIds,
  isCaution,
  isPresetFilter,
  overspentCount,
  overspentOnlyCredit,
  summarize,
  UNCATEGORIZED,
  useBudgetFilter,
  useProgressBars,
} from "@/lib/budget-view";
import { MAX_CUSTOM_VIEWS, useViewActions, viewsQueryOptions } from "@/lib/budget-views";
import { apiErrorMessage } from "@/lib/budgets";
import { categoriesQueryOptions } from "@/lib/categories";
import { useCategoryTemplates } from "@/lib/category-templates";
import { todayIso } from "@/lib/dates";
import { useFixThisMonths } from "@/lib/fix-this";
import { inCurrency, parseMoneyInput, toMoneyInput } from "@/lib/money-input";
import {
  type BudgetMonthData,
  currentMonth,
  invalidateMonths,
  moneyOptions,
  monthQueryOptions,
  rememberMonth,
  toMoney,
  useCollapsedGroups,
} from "@/lib/months";
import {
  categoriesWithMoves,
  HISTORY_MONTHS_BACK,
  invalidateMoves,
  monthMovesQueryOptions,
} from "@/lib/moves";
import { sessionQueryOptions } from "@/lib/session";
import { useShortcut } from "@/lib/shortcuts";
import { type CategoryTarget, useTargetActions } from "@/lib/targets";
import { useUndo } from "@/lib/undo";
import { useCategoryActions } from "@/lib/use-category-actions";
import { useViewportWidth } from "@/lib/use-viewport-width";

/** Shift+Z also works from a category's Assigned input. */
const inAssignedCell = (target: Element) => target.closest("[data-assigned-cell]") !== null;

const layoutStorage = {
  getItem: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage can be unavailable (private windows); the width holds for this visit.
    }
  },
};

/** The inspector's width, in percent of the list and inspector together. */
const INSPECTOR_SHARE = { min: 25, max: 50, default: 33 };

export const Route = createFileRoute("/_authed/budgets/$budgetId/")({
  validateSearch: z.object({
    month: z.string().refine(isBudgetMonth).optional().catch(undefined),
    // A category to select on arrival, its Assigned being edited with `assign` (the payoff
    // simulator's "Copy and go to my plan").
    category: z.string().optional().catch(undefined),
    assign: z.boolean().optional().catch(undefined),
    // A category template to import, its dialog open on arrival (where "Choose Another Budget"
    // and a new budget started from a template lead).
    template: z.string().optional().catch(undefined),
  }),
  component: BudgetPage,
});

function BudgetPage() {
  const { budget, formatAmount, formatDate, readOnly } = useBudget();
  const navigate = Route.useNavigate();
  const today = currentMonth();
  const search = Route.useSearch();
  const month: BudgetMonth = search.month ?? today;
  useEffect(() => rememberMonth(budget.id, month), [budget.id, month]);
  const categories = useQuery(categoriesQueryOptions(budget.id));
  const figures = useQuery({
    ...monthQueryOptions(budget.id, month),
    placeholderData: keepPreviousData,
  });
  const actions = useCategoryActions(budget.id);
  const history = useUndo();
  const targetActions = useTargetActions(budget.id, history.record);
  const accounts = useQuery(accountsQueryOptions(budget.id));
  const [addingAccount, setAddingAccount] = useState(false);
  const { collapsed, setCollapsed } = useCollapsedGroups(budget.id);
  const { filter, setFilter } = useBudgetFilter(budget.id);
  const views = useQuery(viewsQueryOptions(budget.id));
  const viewportWidth = useViewportWidth();
  const phone = viewportWidth < 768;
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const inspectorLayout = useDefaultLayout({
    id: "strictbudget:budget-inspector",
    storage: layoutStorage,
  });
  const [inspectorWidth, setInspectorWidth] = useState<number | null>(null);
  const viewActions = useViewActions(budget.id);
  const [viewDialog, setViewDialog] = useState<ViewDialog>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const templates = useCategoryTemplates(budget.id, galleryOpen || Boolean(search.template));
  const importing = templates.templates?.find((t) => t.id === search.template);
  const setTemplate = (template: string | undefined) =>
    void navigate({ search: (s) => ({ ...s, template }), replace: true });
  // An unknown view id (a deleted view) shows All.
  const customView = isPresetFilter(filter)
    ? undefined
    : views.data?.views.find((v) => v.id === filter);
  const preset = isPresetFilter(filter) ? filter : "all";
  const { progressBars, setProgressBars } = useProgressBars();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [editAssigned, setEditAssigned] = useState<string | undefined>();
  const [scrollTo, setScrollTo] = useState<{ id: string } | undefined>();
  useEffect(() => {
    if (!search.category) return;
    setSelected(new Set([search.category]));
    setEditAssigned(search.assign ? search.category : undefined);
    setScrollTo({ id: search.category });
    void navigate({ search: { month: search.month }, replace: true });
  }, [search.category, search.assign]);
  // Per-category history covers the current and later months and three months back.
  const monthMoves = useQuery({
    ...monthMovesQueryOptions(budget.id, month),
    enabled: month >= addMonths(today, -HISTORY_MONTHS_BACK),
  });
  const session = useQuery(sessionQueryOptions);
  const queryClient = useQueryClient();
  const assignMutation = $api.useMutation(
    "put",
    "/v1/budgets/{budgetId}/months/{month}/categories/{categoryId}",
  );
  const moveMutation = $api.useMutation("post", "/v1/budgets/{budgetId}/months/{month}/moves");
  const noteMutation = $api.useMutation("put", "/v1/budgets/{budgetId}/months/{month}/note");
  /** Saves `month`'s note; Undo covers month notes. */
  const saveMonthNote = async (m: BudgetMonth, before: string, after: string) => {
    const put = async (note: string) => {
      try {
        await noteMutation.mutateAsync({
          params: { path: { budgetId: budget.id, month: m } },
          body: { note },
        });
      } catch (error) {
        toast.error(apiErrorMessage(error, "Couldn't save the note."));
        throw error;
      } finally {
        await invalidateMonths(queryClient);
      }
    };
    try {
      await put(after);
    } catch {
      return;
    }
    history.record({
      label: "month note",
      undo: () => put(before),
      redo: () => put(after),
    });
  };
  const autoAssignMutation = $api.useMutation(
    "post",
    "/v1/budgets/{budgetId}/months/{month}/auto-assign",
  );

  const goTo = (m: BudgetMonth) =>
    navigate({ search: { month: m === today ? undefined : m }, replace: false });

  // A month out of the budget's range (a stale link) shows the nearest one instead.
  const range = figures.data && { first: figures.data.firstMonth, last: figures.data.lastMonth };
  useEffect(() => {
    if (!range || figures.isPlaceholderData) return;
    const nearest = month < range.first ? range.first : month > range.last ? range.last : month;
    if (nearest !== month) {
      void navigate({ search: { month: nearest === today ? undefined : nearest }, replace: true });
    }
  }, [range?.first, range?.last, month, today, navigate, figures.isPlaceholderData]);

  const listed = useMemo(() => {
    const map = new Map<string, ListedCategory>();
    for (const g of categories.data?.groups ?? []) {
      if (g.hidden) continue;
      for (const c of g.categories) {
        if (!c.hidden) {
          map.set(c.id, { name: c.name, note: c.note, group: g.name, target: c.target });
        }
      }
    }
    return map;
  }, [categories.data]);
  const visible = useMemo(() => new Set(listed.keys()), [listed]);
  const names = useMemo(
    () =>
      new Map(
        (categories.data?.groups ?? []).flatMap((g) => g.categories.map((c) => [c.id, c.name])),
      ),
    [categories.data],
  );
  const shown = useMemo(
    () =>
      customView
        ? new Set(customView.categoryIds.filter((id) => visible.has(id)))
        : figures.data && preset !== "all"
          ? filteredIds(preset, figures.data, visible)
          : undefined,
    [figures.data, preset, customView, visible],
  );
  // A category that leaves the view (or the list) leaves the selection too.
  const selection = useMemo<ReadonlySet<string>>(
    () =>
      new Set(
        [...selected].filter(
          (id) => (id === UNCATEGORIZED || visible.has(id)) && (!shown || shown.has(id)),
        ),
      ),
    [selected, visible, shown],
  );

  // Shift+Z snoozes every selected category with a target, or wakes them when all are snoozed
  // already; it works from the Assigned input too. This month only.
  useShortcut(
    "snooze",
    () => {
      const data = figures.data;
      if (!data) return;
      const withTarget = [...selection].filter((id) => listed.get(id)?.target);
      if (withTarget.length === 0) return;
      const snoozedNow = (id: string) =>
        data.categories.find((c) => c.categoryId === id)?.target?.snoozed ?? false;
      const on = !withTarget.every(snoozedNow);
      const changing = withTarget.filter((id) => snoozedNow(id) !== on);
      const apply = async (snoozed: boolean) => {
        for (const id of changing) await targetActions.snooze(id, month, snoozed);
      };
      void (async () => {
        const done = await Promise.all(changing.map((id) => targetActions.snooze(id, month, on)));
        if (!done.some(Boolean)) return;
        history.record({
          label: on ? "snooze target" : "wake target",
          undo: () => apply(!on),
          redo: () => apply(on),
        });
      })();
    },
    {
      enabled: month === today && !readOnly && selection.size > 0,
      allowIn: inAssignedCell,
    },
  );

  const listFigures = useMemo<CategoryFigures | undefined>(() => {
    const data = figures.data;
    if (!data) return undefined;
    const settings = { ...budget, currency: data.currency };
    const onScreen = data.month;
    const parse = (text: string) => parseMoneyInput(text, settings);
    const toInput = (amount: string) => toMoneyInput(amount, settings);

    async function save(
      work: () => Promise<BudgetMonthData>,
      inverse: () => Promise<BudgetMonthData>,
      label: string,
      failure: string,
      replay = work,
    ) {
      try {
        const updated = await work();
        if (updated.month === onScreen) {
          queryClient.setQueryData(monthQueryOptions(budget.id, onScreen).queryKey, updated);
        }
        history.record({
          label,
          undo: () => saveHistory(inverse),
          redo: () => saveHistory(replay),
        });
      } catch (error) {
        toast.error(apiErrorMessage(error, failure));
      } finally {
        await refreshBudget();
      }
    }

    async function saveHistory(work: () => Promise<BudgetMonthData>) {
      const updated = await work();
      if (updated.month === onScreen) {
        queryClient.setQueryData(monthQueryOptions(budget.id, onScreen).queryKey, updated);
      }
      await refreshBudget();
    }

    async function refreshBudget() {
      await Promise.all([invalidateMonths(queryClient), invalidateMoves(queryClient)]);
    }

    return {
      month: data,
      currentMonth: today,
      format: (amount) => formatAmount(toMoney(amount, data.currency)),
      activity: { budgetId: budget.id, formatDate },
      shown,
      progressBars,
      editAssigned,
      onEditAssignedStarted: () => setEditAssigned(undefined),
      scrollTo,
      moves: monthMoves.data && {
        moves: monthMoves.data.moves,
        withMoves: categoriesWithMoves(monthMoves.data.moves),
        name: (id, deleted) =>
          deleted ??
          (id ? (listed.get(id)?.name ?? names.get(id) ?? "Deleted category") : "Ready to Assign"),
        formatDate,
        currentUserId: session.data?.user.id,
      },
      emptyView: customView
        ? {
            message: `There are no categories selected for ${customView.name}.`,
            onViewAll: () => setFilter("all"),
            onEdit: () => setViewDialog({ kind: "edit", view: customView }),
          }
        : {
            message: preset === "all" ? "" : EMPTY_VIEW[preset],
            onViewAll: () => setFilter("all"),
          },
      selection: {
        selected: selection,
        toggle: (id) => {
          const next = new Set(selection);
          if (!next.delete(id)) next.add(id);
          setSelected(next);
        },
        selectOnly: (id) => setSelected(new Set([id])),
        setAll: (ids) => setSelected(new Set(ids)),
      },
      assign: readOnly
        ? undefined
        : {
            parse,
            toInput,
            assign: (categoryId, amount) => {
              const before =
                data.categories.find((c) => c.categoryId === categoryId)?.assigned ?? "0";
              const delta = amount - BigInt(before);
              const readyToAssignId = categories.data?.readyToAssignCategoryId;
              const assign = () =>
                assignMutation.mutateAsync({
                  params: { path: { budgetId: budget.id, month: data.month, categoryId } },
                  body: { assigned: amount.toString(), today: todayIso() },
                });
              const moveDelta = (reverse: boolean) => {
                if (!readyToAssignId || delta === 0n) return assign();
                const positive = delta > 0n !== reverse;
                return moveMutation.mutateAsync({
                  params: { path: { budgetId: budget.id, month: data.month } },
                  body: {
                    fromCategoryId: positive ? readyToAssignId : categoryId,
                    toCategoryId: positive ? categoryId : readyToAssignId,
                    amount: (delta > 0n ? delta : -delta).toString(),
                    today: todayIso(),
                  },
                });
              };
              return save(
                assign,
                () => moveDelta(true),
                "assigned amount",
                "Couldn't assign the money.",
                () => moveDelta(false),
              );
            },
          },
      move: readOnly
        ? undefined
        : categories.data && {
            options: moneyOptions(categories.data, data),
            readyToAssignId: categories.data.readyToAssignCategoryId,
            parse,
            toInput,
            move: (fromCategoryId, toCategoryId, amount) =>
              moveIn(data.month, fromCategoryId, toCategoryId, amount),
            moveIn,
            moveFrom: (fromMonth, fromCategoryId, toCategoryId, amount) => {
              // To the month on screen from `fromMonth`; undone the other way round.
              const mutate = (to: BudgetMonth, from: BudgetMonth, fromId: string, toId: string) =>
                moveMutation.mutateAsync({
                  params: { path: { budgetId: budget.id, month: to } },
                  body: {
                    fromCategoryId: fromId,
                    toCategoryId: toId,
                    amount: amount.toString(),
                    fromMonth: from,
                    today: todayIso(),
                  },
                });
              return save(
                () => mutate(data.month, fromMonth, fromCategoryId, toCategoryId),
                () => mutate(fromMonth, data.month, toCategoryId, fromCategoryId),
                "money move",
                "Couldn't move the money.",
              );
            },
          },
    };

    function moveIn(m: BudgetMonth, fromCategoryId: string, toCategoryId: string, amount: bigint) {
      const mutate = (from: string, to: string) =>
        moveMutation.mutateAsync({
          params: { path: { budgetId: budget.id, month: m } },
          body: {
            fromCategoryId: from,
            toCategoryId: to,
            amount: amount.toString(),
            today: todayIso(),
          },
        });
      return save(
        () => mutate(fromCategoryId, toCategoryId),
        () => mutate(toCategoryId, fromCategoryId),
        "money move",
        "Couldn't move the money.",
      );
    }
    // mutateAsync is stable; the mutation objects themselves change every render.
  }, [
    readOnly,
    figures.data,
    categories.data,
    formatAmount,
    formatDate,
    budget,
    queryClient,
    shown,
    preset,
    customView,
    setFilter,
    selection,
    history,
    today,
    progressBars,
    editAssigned,
    scrollTo,
    monthMoves.data,
    session.data,
    listed,
    names,
  ]);

  // "Cover overspending from" offers the months Fix This does.
  const coverMonths = useFixThisMonths({
    budgetId: budget.id,
    month,
    current: today,
    data: figures.data,
    categories: categories.data,
    // Only fetched when something is overspent: covering is the only use.
    always: Boolean(figures.data?.categories.some((c) => c.available.startsWith("-"))),
    unassign: async (m, categoryId, amount) => {
      const move = listFigures?.move;
      if (move) await move.moveIn(m, categoryId, move.readyToAssignId, amount);
    },
  });
  const coverFigures = useMemo(
    () =>
      listFigures?.move && coverMonths
        ? { ...listFigures, move: { ...listFigures.move, coverMonths } }
        : listFigures,
    [listFigures, coverMonths],
  );

  const fixThisMonths = useFixThisMonths({
    budgetId: budget.id,
    month,
    current: today,
    data: figures.data,
    categories: categories.data,
    unassign: async (m, categoryId, amount) => {
      const move = listFigures?.move;
      if (move) await move.moveIn(m, categoryId, move.readyToAssignId, amount);
    },
  });

  /**
   * The Auto-Assign options for `selection` (the inspector's), or for the rows in view with an
   * empty one (the Ready to Assign banner's Assign pop-up, its "Auto" tab).
   */
  const autoAssignPanel = (selection: ReadonlySet<string>, bare = false) =>
    listFigures &&
    !readOnly && (
      <AutoAssignPanel
        bare={bare}
        categories={listFigures.month.categories.filter((c) =>
          selection.size > 0 ? selection.has(c.categoryId) : (shown ?? visible).has(c.categoryId),
        )}
        onViewAll={() => setFilter("all")}
        names={listed}
        selection={selection.size > 0}
        readyToAssign={BigInt(listFigures.month.readyToAssign)}
        format={listFigures.format}
        onApply={async (option) => {
          // Selected, or the rows in view; the server takes no list as every visible one.
          const categoryIds =
            selection.size > 0
              ? [...selection].filter((id) => id !== UNCATEGORIZED)
              : shown
                ? [...shown].filter((id) => id !== UNCATEGORIZED)
                : [];
          if ((selection.size > 0 || shown) && categoryIds.length === 0) return;
          const before = Object.fromEntries(
            listFigures.month.categories
              .filter((category) =>
                categoryIds.length ? categoryIds.includes(category.categoryId) : true,
              )
              .map((category) => [category.categoryId, category.assigned]),
          );
          const apply = () =>
            autoAssignMutation.mutateAsync({
              params: { path: { budgetId: budget.id, month } },
              body: {
                option,
                ...(categoryIds.length ? { categoryIds } : {}),
                // A view's rows share Ready to Assign, as the whole plan does.
                ...(selection.size === 0 && shown ? { scope: "view" as const } : {}),
                today: todayIso(),
              },
            });
          const readyToAssignId = listFigures.move?.readyToAssignId;
          if (!readyToAssignId) return;
          let deltas: Record<string, bigint> = {};
          const moveDeltas = async (reverse: boolean) => {
            let updated = listFigures.month;
            for (const [categoryId, delta] of Object.entries(deltas)) {
              if (delta === 0n) continue;
              const positive = delta > 0n !== reverse;
              updated = await moveMutation.mutateAsync({
                params: { path: { budgetId: budget.id, month } },
                body: {
                  fromCategoryId: positive ? readyToAssignId : categoryId,
                  toCategoryId: positive ? categoryId : readyToAssignId,
                  amount: (delta > 0n ? delta : -delta).toString(),
                  today: todayIso(),
                },
              });
            }
            return updated;
          };
          const refresh = async () => {
            await Promise.all([invalidateMonths(queryClient), invalidateMoves(queryClient)]);
          };
          try {
            const updated = await apply();
            deltas = Object.fromEntries(
              updated.categories
                .filter((category) => category.categoryId in before)
                .map((category) => [
                  category.categoryId,
                  BigInt(category.assigned) - BigInt(before[category.categoryId] ?? "0"),
                ]),
            );
            queryClient.setQueryData(monthQueryOptions(budget.id, month).queryKey, updated);
            history.record({
              label: "auto-assign",
              undo: async () => {
                queryClient.setQueryData(
                  monthQueryOptions(budget.id, month).queryKey,
                  await moveDeltas(true),
                );
                await refresh();
              },
              redo: async () => {
                queryClient.setQueryData(
                  monthQueryOptions(budget.id, month).queryKey,
                  await moveDeltas(false),
                );
                await refresh();
              },
            });
          } catch (error) {
            toast.error(apiErrorMessage(error, "Couldn't assign the money."));
          } finally {
            void refresh();
          }
        }}
      />
    );

  // Below lg the inspector is a drawer; from there it's beside the list, as wide as the user drags
  // it (25–50% of the area, a third to start, kept in this browser).
  const wide = viewportWidth >= 1024;
  // On a phone, picking one category opens the inspector drawer for it. A tablet shows the
  // Assigned column, so a tap there edits it in place, as on a desktop; Summary opens the drawer.
  const pickedOne = selection.size === 1 ? [...selection][0] : undefined;
  useEffect(() => {
    if (phone && pickedOne !== undefined) setInspectorOpen(true);
  }, [pickedOne, phone]);
  const listColumn = (
    <>
      {categories.isPending ? (
        <Skeleton className="h-64" />
      ) : categories.isError ? (
        <p className="text-muted-foreground">Couldn't load categories.</p>
      ) : (
        <div className="grid gap-3">
          {/* The divider is an inset shadow the selected tab's underline paints over. */}
          <div className="flex flex-wrap items-end gap-x-2 gap-y-1 shadow-[inset_0_-1px_0_var(--border)]">
            {listFigures && (
              <BudgetFilterBar
                filter={customView ? filter : preset}
                overspent={overspentCount(listFigures.month, visible)}
                onlyCredit={overspentOnlyCredit(listFigures.month, visible)}
                onChange={setFilter}
                order={views.data?.order}
                custom={views.data?.views}
                viewportWidth={viewportWidth}
                menu={(overflow) =>
                  views.data && (
                    <ViewsMenu
                      full={views.data.views.length >= MAX_CUSTOM_VIEWS}
                      overflow={overflow}
                      onPick={setFilter}
                      onManage={() => setViewDialog({ kind: "manage" })}
                      onNew={() =>
                        setViewDialog({
                          kind: "edit",
                          view: null,
                          preselected: [...selection].filter((id) => id !== UNCATEGORIZED),
                        })
                      }
                    />
                  )
                }
              />
            )}
            <div className="ml-auto flex items-center gap-1 pb-1">
              {customView && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setViewDialog({ kind: "edit", view: customView })}
                >
                  <Pencil /> Edit View
                </Button>
              )}
              {listFigures && (
                <RecentMoves
                  budgetId={budget.id}
                  categories={categories.data}
                  format={listFigures.format}
                  formatDate={formatDate}
                  onOpenCategory={(categoryId, m) =>
                    void navigate({
                      search: { month: m === today ? undefined : m, category: categoryId },
                    })
                  }
                />
              )}
              {!readOnly && <UndoRedoButtons />}
              <BudgetOptionsMenu
                onTemplates={readOnly ? undefined : () => setGalleryOpen(true)}
                progressBars={progressBars}
                onProgressBarsChange={setProgressBars}
              />
            </div>
          </div>
          {views.data && (
            <ViewDialogs
              dialog={viewDialog}
              onDialogChange={setViewDialog}
              order={views.data.order}
              views={views.data.views}
              categories={categories.data}
              actions={viewActions}
              onCreated={(view) => {
                setFilter(view.id);
                setSelected(new Set());
              }}
              onDeleted={(viewId) => {
                if (filter === viewId) setFilter("all");
              }}
            />
          )}
          <CategoryList
            data={categories.data}
            actions={actions}
            figures={coverFigures}
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
            addGroupDisabled={Boolean(customView)}
          />
        </div>
      )}
    </>
  );
  const onlySelected = selection.size === 1 ? [...selection][0] : undefined;
  const inspectorTitle =
    onlySelected === undefined
      ? "Month summary"
      : onlySelected === UNCATEGORIZED
        ? "Uncategorized Transactions"
        : (listed.get(onlySelected)?.name ?? "Category");
  // A phone's rows have no Assigned cell, so the drawer leads with one.
  const onlyFigures =
    onlySelected && listFigures?.month.categories.find((c) => c.categoryId === onlySelected);
  const drawerAssigned = phone && onlySelected && onlyFigures && listFigures?.assign && (
    <div className="grid gap-1.5">
      <span className="text-muted-foreground text-sm">Assigned this month</span>
      <AssignedCell
        categoryId={onlySelected}
        categoryName={inspectorTitle}
        amount={onlyFigures.assigned}
        format={listFigures.format}
        actions={listFigures.assign}
        className="h-11 border text-left text-base"
      />
    </div>
  );
  const inspectorColumn = listFigures && (
    <aside className="grid grid-cols-[minmax(0,1fr)] gap-4" aria-label="Inspector">
      <Inspector
        figures={listFigures}
        selection={selection}
        shown={shown}
        listed={listed}
        onNoteChange={(categoryId, note) => actions.updateCategory(categoryId, { note })}
        targetActions={targetActions}
        onShowOverspent={() => setFilter("overspent")}
      />
      {selection.size === 0 && month <= today && <SpendingPacePanel month={month} />}
      {/* Uncategorized alone has no Auto-Assign: money can't be assigned to it. */}
      {!(selection.size === 1 && selection.has(UNCATEGORIZED)) && autoAssignPanel(selection)}
      {month === today && (
        <FutureMonthsPanel data={listFigures.month} format={listFigures.format} />
      )}
    </aside>
  );

  return (
    <div className="grid gap-4">
      <TemplateGallery
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        templates={templates.templates}
        format={(amount) => formatAmount(toMoney(amount, budget.currency))}
        onPick={(t) => {
          setGalleryOpen(false);
          setTemplate(t.id);
        }}
      />
      <ImportTemplateDialog
        template={importing}
        budgetName={budget.name}
        onCancel={() => setTemplate(undefined)}
        onChooseAnother={() =>
          void navigate({ to: "/budgets", search: { template: search.template } })
        }
        onImport={async (categoryIds) => {
          if (!importing) return;
          if (await templates.importTemplate(importing.id, categoryIds)) setTemplate(undefined);
        }}
      />
      <div
        className="flex flex-wrap items-center justify-between gap-4 lg:grid"
        style={
          wide && inspectorWidth !== null
            ? { gridTemplateColumns: `minmax(0,1fr) ${inspectorWidth}px` }
            : undefined
        }
      >
        <div className="grid gap-1">
          <PageTitle name={budget.name} />
          <PageHeader
            title={budget.name}
            actions={
              !wide &&
              listFigures && (
                <Button
                  variant="outline"
                  size="sm"
                  className="max-md:min-h-11"
                  onClick={() => setInspectorOpen(true)}
                >
                  <PanelRight /> Summary
                </Button>
              )
            }
          />
          <MonthNav
            month={month}
            current={today}
            first={range?.first ?? month}
            last={range?.last ?? month}
            onChange={goTo}
          />
          {figures.data && (
            <MonthNote
              key={month}
              note={figures.data.note}
              onSave={(note) => saveMonthNote(month, figures.data?.note ?? "", note)}
            />
          )}
        </div>
        {listFigures && (
          <ReadyToAssignBanner
            amount={listFigures.month.readyToAssign}
            overdraft={listFigures.month.overdraft}
            format={listFigures.format}
            breakdown={{
              lines: listFigures.month.readyToAssignBreakdown,
              month: listFigures.month.month,
            }}
            assign={
              listFigures.move && (
                <AssignButton
                  readyToAssign={listFigures.month.readyToAssign}
                  format={listFigures.format}
                  actions={listFigures.move}
                  auto={autoAssignPanel(new Set(), true)}
                />
              )
            }
            action={
              listFigures.move && (
                <FixThisButton
                  readyToAssign={listFigures.month.readyToAssign}
                  format={listFigures.format}
                  actions={listFigures.move}
                  months={fixThisMonths}
                />
              )
            }
          />
        )}
      </div>
      {budget.archivedAt && (
        <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          This budget was archived by a fresh start on {formatDate(budget.archivedAt.slice(0, 10))}.
          Its history is kept here; new budgeting happens in the budget that replaced it.
        </p>
      )}
      {accounts.data && accounts.data.accounts.length === 0 && !budget.archivedAt && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3">
          <div className="grid gap-0.5">
            <p className="font-medium text-sm">Add your first account</p>
            <p className="text-muted-foreground text-sm">
              Its balance today becomes money you can give a job.
            </p>
          </div>
          <Button size="sm" onClick={() => setAddingAccount(true)}>
            <Plus /> Add Account
          </Button>
          <AddAccountDialog budget={budget} open={addingAccount} onOpenChange={setAddingAccount} />
        </div>
      )}
      {wide ? (
        <ResizablePanelGroup
          id="budget-inspector"
          defaultLayout={inspectorLayout.defaultLayout}
          onLayoutChanged={inspectorLayout.onLayoutChanged}
          className="items-start"
        >
          <ResizablePanel id="list" minSize="50" className="min-w-0">
            {listColumn}
          </ResizablePanel>
          <ResizableHandle
            aria-label="Resize the inspector"
            className="mx-2 self-stretch bg-transparent after:w-3 hover:bg-border"
          />
          <ResizablePanel
            id="inspector"
            defaultSize={String(INSPECTOR_SHARE.default)}
            minSize={String(INSPECTOR_SHARE.min)}
            maxSize={String(INSPECTOR_SHARE.max)}
            onResize={(size) => setInspectorWidth(size.inPixels)}
          >
            {inspectorColumn}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <>
          {listColumn}
          <Drawer
            open={inspectorOpen}
            onOpenChange={(open) => {
              setInspectorOpen(open);
              if (!open && selection.size === 1) setSelected(new Set());
            }}
            direction={phone ? "bottom" : "right"}
          >
            <DrawerContent className="data-[vaul-drawer-direction=bottom]:max-h-[90svh] data-[vaul-drawer-direction=right]:w-[min(26rem,92vw)] data-[vaul-drawer-direction=right]:sm:max-w-none">
              <DrawerHeader className="text-left">
                <DrawerTitle>{inspectorTitle}</DrawerTitle>
                <DrawerDescription className="sr-only">
                  The category's numbers, target and note, or the month's summary.
                </DrawerDescription>
              </DrawerHeader>
              <div className="grid gap-4 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                {drawerAssigned}
                {inspectorColumn}
              </div>
            </DrawerContent>
          </Drawer>
        </>
      )}
    </div>
  );
}

const paymentFigures = (p: NonNullable<BudgetMonthData["categories"][number]["payment"]>) =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, BigInt(v)])) as Record<
    keyof typeof p,
    bigint
  >;

interface ListedCategory {
  name: string;
  note: string;
  group: string;
  target: CategoryTarget | null;
}

/**
 * One selected category's breakdown, target and note, or the month's summary over the selection
 * (two or more) or over the rows in view (nothing selected).
 */
function Inspector({
  figures,
  selection,
  shown,
  listed,
  onNoteChange,
  targetActions,
  onShowOverspent,
}: {
  figures: CategoryFigures;
  selection: ReadonlySet<string>;
  shown: ReadonlySet<string> | undefined;
  listed: ReadonlyMap<string, ListedCategory>;
  onNoteChange: (categoryId: string, note: string) => Promise<void>;
  targetActions: ReturnType<typeof useTargetActions>;
  onShowOverspent: () => void;
}) {
  const { budget, formatAmount, formatDate } = useBudget();
  const navigate = useNavigate();
  const history = useUndo();
  const { month, format, assign } = figures;
  /** Amounts in a target's own currency, in the budget's number format. */
  const moneyIn = (currency: CurrencyCode): MoneyIO => {
    const settings = inCurrency({ ...budget, currency: month.currency }, currency);
    return {
      format: (amount) => formatAmount(toMoney(amount, settings.currency)),
      parse: (text) => parseMoneyInput(text, settings),
      toInput: (amount) => toMoneyInput(amount, settings),
    };
  };
  const only = selection.size === 1 ? [...selection][0] : undefined;
  const pairedLoan = usePairedLoan(only);
  const loanPlan = useLoanPlan(pairedLoan);
  const accounts = useQuery(accountsQueryOptions(budget.id));
  const categoryList = useQuery(categoriesQueryOptions(budget.id));
  /** Uncategorized goes to reports by its category id. */
  const reportCategories = (ids: Iterable<string>) => {
    const uncategorized = categoryList.data?.uncategorizedCategoryId;
    return [...ids].flatMap((id) =>
      id !== UNCATEGORIZED ? [id] : uncategorized ? [uncategorized] : [],
    );
  };
  const paidCard = accounts.data?.accounts.find(
    (a) => only !== undefined && a.paymentCategoryId === only && !a.closed,
  );
  if (only === UNCATEGORIZED && month.uncategorized) {
    return (
      <CategoryInspector
        name="Uncategorized Transactions"
        uncategorized
        totals={breakdown({ assigned: "0", ...month.uncategorized })}
        format={format}
        available={<AvailablePill amount={month.uncategorized.available} format={format} />}
        note=""
        onNoteChange={async () => {}}
      />
    );
  }
  const category = only ? listed.get(only) : undefined;
  const totals = only ? month.categories.find((c) => c.categoryId === only) : undefined;
  if (only && category && totals) {
    const caution = isCaution(totals, month.month, figures.currentMonth);
    const available = figures.move ? (
      <AvailableButton
        categoryId={only}
        categoryName={category.name}
        amount={totals.available}
        format={format}
        actions={figures.move}
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
    );
    const upcoming = totals.upcoming && (
      <UpcomingTransactions
        name={category.name}
        available={BigInt(totals.available)}
        upcoming={totals.upcoming}
        format={format}
        formatDate={formatDate}
        onOpen={(accountId, scheduleId) =>
          void navigate({
            to: "/budgets/$budgetId/accounts/$accountId",
            params: { budgetId: budget.id, accountId },
            search: { transaction: scheduleId },
          })
        }
      />
    );
    const targetCurrency = {
      budgetCurrency: month.currency,
      moneyIn,
      conversion: totals.targetConversion,
      rateMissing: totals.targetRateMissing,
    };
    if (totals.payment) {
      const payment = paymentFigures(totals.payment);
      const alertProps = {
        name: category.name,
        totals: breakdown(totals),
        payment,
        format,
        warn: month.month >= figures.currentMonth,
        onCoverOverspent: onShowOverspent,
        onRecordPayment: paidCard
          ? () =>
              void navigate({
                to: "/budgets/$budgetId/accounts/$accountId",
                params: { budgetId: budget.id, accountId: paidCard.id },
                search: { recordPayment: true },
              })
          : undefined,
      };
      const past = month.month < figures.currentMonth;
      return (
        <PaymentInspector
          {...alertProps}
          past={past}
          available={available}
          upcoming={upcoming}
          note={category.note}
          onNoteChange={(note) => onNoteChange(only, note)}
          target={
            !assign ? (
              // Where an editor gets the Payment alert in place of a target, so does a viewer:
              // undefined lets PaymentInspector show it.
              paymentAlertShows({
                target: category.target,
                need: totals.target,
                overpaid: totals.available.startsWith("-"),
                past,
              }) ? undefined : (
                <ReadOnlyTarget
                  target={category.target}
                  need={totals.target}
                  format={format}
                  currency={targetCurrency}
                  payment={{
                    month: month.month,
                    fundedSpending: totals.payment.fundedSpending,
                    paymentsMade: totals.payment.paymentsMade,
                  }}
                />
              )
            ) : (
              <TargetSection
                key={only}
                name={category.name}
                target={category.target}
                need={totals.target}
                format={format}
                parse={assign.parse}
                toInput={assign.toInput}
                dateFormat={budget.dateFormat}
                currency={targetCurrency}
                onSave={(input) => targetActions.save(only, month.month, input, category.target)}
                onDelete={() => targetActions.remove(only, category.target)}
                onAssign={
                  month.month < figures.currentMonth
                    ? undefined
                    : (amount) => assign.assign(only, BigInt(totals.assigned) + amount)
                }
                payment={{
                  month: month.month,
                  fundedSpending: totals.payment.fundedSpending,
                  paymentsMade: totals.payment.paymentsMade,
                  overpaid: totals.available.startsWith("-"),
                  past,
                  alert: (createTarget) => (
                    <PaymentAlert {...alertProps} onCreateTarget={createTarget} />
                  ),
                }}
              />
            )
          }
        />
      );
    }
    return (
      <CategoryInspector
        name={category.name}
        totals={breakdown(totals)}
        format={format}
        pairedWith={pairedLoan && <PairedWith loan={pairedLoan} />}
        loan={
          pairedLoan &&
          month.month === figures.currentMonth && (
            <PairedLoanSection
              loan={pairedLoan}
              categoryId={only}
              categoryName={category.name}
              available={totals.available}
              move={figures.move}
            />
          )
        }
        available={available}
        upcoming={upcoming}
        history={<CategoryHistoryPanel categoryId={only} month={month.month} />}
        note={category.note}
        onNoteChange={(note) => onNoteChange(only, note)}
        target={
          !assign ? (
            <ReadOnlyTarget
              target={category.target}
              need={totals.target}
              format={format}
              currency={targetCurrency}
              debt={pairedLoan !== undefined || category.target?.cadence === "debt_monthly"}
            />
          ) : (
            <TargetSection
              key={only}
              name={category.name}
              target={category.target}
              need={totals.target}
              format={format}
              parse={assign.parse}
              toInput={assign.toInput}
              dateFormat={budget.dateFormat}
              currency={targetCurrency}
              onSave={(input) => targetActions.save(only, month.month, input, category.target)}
              onDelete={() => targetActions.remove(only, category.target)}
              onAssign={
                month.month < figures.currentMonth
                  ? undefined
                  : (amount) => assign.assign(only, BigInt(totals.assigned) + amount)
              }
              snoozeLocked={month.month !== figures.currentMonth}
              debt={
                pairedLoan
                  ? { plan: loanPlan }
                  : // A loan unpaired or closed leaves its debt target.
                    category.target?.cadence === "debt_monthly"
                    ? { plan: null, unpairedCategoryId: only }
                    : undefined
              }
              onSnooze={
                month.month === figures.currentMonth
                  ? async (snoozed) => {
                      const snooze = (on: boolean) =>
                        targetActions.snooze(only, month.month, on).then(() => undefined);
                      if (!(await targetActions.snooze(only, month.month, snoozed))) return;
                      history.record({
                        label: snoozed ? "snooze target" : "wake target",
                        undo: () => snooze(!snoozed),
                        redo: () => snooze(snoozed),
                      });
                    }
                  : undefined
              }
            />
          )
        }
      />
    );
  }
  if (selection.size > 1) {
    const names = [...selection].map((id) =>
      id === UNCATEGORIZED ? "Uncategorized Transactions" : (listed.get(id)?.name ?? ""),
    );
    return (
      <MonthSummary
        month={month.month}
        totals={summarize(month, selection)}
        format={format}
        selectedNames={names}
        reportCategories={reportCategories(selection)}
      />
    );
  }
  // Under All, the summary covers every category, hidden ones included.
  const ids = shown ?? [
    ...month.categories.map((c) => c.categoryId),
    ...(month.uncategorized ? [UNCATEGORIZED] : []),
  ];
  return (
    <MonthSummary
      month={month.month}
      totals={summarize(month, ids)}
      format={format}
      reportCategories={shown ? reportCategories(shown) : undefined}
      // The whole plan's targets, whatever the view, in the current month only.
      targets={
        month.month === figures.currentMonth
          ? {
              month: BigInt(month.targets.month),
              nextMonth: BigInt(month.targets.nextMonth),
              expectedIncome:
                month.targets.expectedIncome === null ? null : BigInt(month.targets.expectedIncome),
              onSetIncome: assign && targetActions.setExpectedIncome,
              parse: assign?.parse,
              toInput: assign?.toInput,
            }
          : undefined
      }
    />
  );
}
