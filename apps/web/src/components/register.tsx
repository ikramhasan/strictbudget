import type { components } from "@strictbudget/api-client";
import { money, usesCategory } from "@strictbudget/engine";
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
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@strictbudget/ui/components/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@strictbudget/ui/components/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@strictbudget/ui/components/empty";
import { Popover, PopoverContent, PopoverTrigger } from "@strictbudget/ui/components/popover";
import { ScrollArea } from "@strictbudget/ui/components/scroll-area";
import { Table, TableHeader } from "@strictbudget/ui/components/table";
import { cn } from "@strictbudget/ui/lib/utils";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUp,
  Bookmark,
  Check,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  CircleX,
  CreditCard,
  History,
  Image as ImageIcon,
  Landmark,
  MoreHorizontal,
  Paperclip,
  Plus,
  ReceiptText,
  Repeat,
  Split,
  Trash2,
} from "lucide-react";
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import { type Account, accountsQueryOptions } from "@/lib/accounts";
import { agentFor } from "@/lib/activity";
import { useAiSettings } from "@/lib/ai";
import { $api, apiClient } from "@/lib/api";
import { useBudget } from "@/lib/budget-context";
import { apiErrorMessage } from "@/lib/budgets";
import { categoriesQueryOptions } from "@/lib/categories";
import { categoryNotNeeded } from "@/lib/category-cell";
import { todayIso } from "@/lib/dates";
import { useExpandedSplits } from "@/lib/expanded-splits";
import { exportSelected } from "@/lib/exports";
import { FLAG_CLASS, type Flag, type FlagColor, flagLabel, flagsQueryOptions } from "@/lib/flags";
import { inCurrency } from "@/lib/money-input";
import { currentMonth, monthQueryOptions } from "@/lib/months";
import { useShortcutsEnabled } from "@/lib/preferences";
import {
  deleteWarning,
  editWarning,
  type ReconciledWarning,
  rowDeleteScope,
} from "@/lib/reconciled-warnings";
import { dayHeading, shortDate } from "@/lib/register-dates";
import { type RegisterSearch, registerQuery, searchText } from "@/lib/register-filters";
import { useRemainingHeight } from "@/lib/register-height";
import {
  balanceChange,
  isPendingId,
  type PendingCreate,
  type PendingEdit,
  type PendingKind,
  patchedTransaction,
  pendingId,
  pendingTransaction,
  type RowContext,
  withBalanceChange,
  withPending,
} from "@/lib/register-optimistic";
import {
  DEFAULT_SORT,
  enteredOrder,
  nextSort,
  type SortColumn,
  type SortField,
} from "@/lib/register-sort";
import { bulkDoneMessage, bulkLabel, bulkRemoves } from "@/lib/register-undo";
import {
  addMonths,
  rangeDates,
  savedSearch,
  saveSearch,
  useRegisterView,
} from "@/lib/register-view";
import {
  isScheduled,
  makeRepeatingDraft,
  rescheduleBody,
  type ScheduledTransaction,
  scheduleCreateBody,
  scheduledQueryPrefix,
  scheduledSplits,
  scheduleRestoreBody,
} from "@/lib/scheduled";
import {
  isEmpty,
  isSelected,
  NOTHING,
  rangeTo,
  type Selection,
  selectionBody,
  setSelected,
  stepSelection,
} from "@/lib/selection";
import { sessionQueryOptions } from "@/lib/session";
import { useShortcut } from "@/lib/shortcuts";
import {
  type CreateTransactionBody,
  createBodyFromTransaction,
  isIdUnavailable,
  updateBodyFromTransaction,
  withoutIds,
} from "@/lib/transaction-history";
import {
  type CategoryOption,
  type CellColumn,
  categoryOptions,
  cellUpdate,
  createBody,
  type Draft,
  draftFrom,
  emptyDraft,
  movableAccounts,
  payeesQueryOptions,
  paymentCategoryCard,
  REGISTER_PAGE_SIZE,
  refreshTransactions,
  type SubTransaction,
  startSplit,
  type Transaction,
  transactionsQueryPrefix,
  transferRowLabel,
  updateBody,
} from "@/lib/transactions";
import { type UndoCommand, useUndo } from "@/lib/undo";
import { useViewportWidth } from "@/lib/use-viewport-width";
import { AddAccountDialog } from "./add-account-dialog";
import { CategoryLabel } from "./category-label";
import { CellEditor, type CellExit } from "./cell-editor";
import { ChangeHistoryDialog } from "./change-history-dialog";
import { FileImportButton } from "./file-import";
import { FlagMenu } from "./flag-menu";
import { MemberAvatar } from "./member-avatar";
import {
  type CellText,
  COLUMN_SPECS,
  type ColumnId,
  isEditable,
  layoutColumns,
  MIN_COLUMN_PX,
  type MoneyColumn,
  measureContent,
  PINNED_BG,
  pinned,
  pinnedWidth,
  RESIZABLE,
  registerColumns,
  useColumnWidths,
} from "./register-columns";
import { CategoryBalancesContext } from "./register-fields";
import { RegisterSearchBox } from "./register-search-box";
import { RegisterSkeleton } from "./register-skeleton";
import {
  AccountMark,
  ClearedMark,
  DATE_EDITOR_FIT,
  EDITOR_CELL,
  ICON_CELL,
  PendingMark,
  REGISTER_TRAY,
  REVEAL_ON_ROW,
  RegisterBody,
  RegisterCell,
  RegisterHead,
  RegisterRow,
} from "./register-table";
import { RegisterViewMenu } from "./register-view-menu";
import { NeedsCategoryPill, ReviewCell } from "./review-cell";
import { ScheduledSection } from "./scheduled-section";
import { type BulkAction, SelectionBar } from "./selection-bar";
import { AttachmentCell, AttachmentField } from "./transaction-attachment";
import { type EditorFocus, TransactionEditor } from "./transaction-editor";
import { UndoRedoButtons } from "./undo-redo-buttons";
import { signedAmount } from "./unrealized-gain";

/** Columns a header click sorts by (Outflow and Inflow apart, the flag too). */
const SORTABLE: Partial<Record<ColumnId, SortColumn>> = {
  flag: "flag",
  account: "account",
  date: "date",
  payee: "payee",
  category: "category",
  memo: "memo",
  outflow: "outflow",
  inflow: "inflow",
  // Largest outflows first, as the Outflow header would.
  amount: "outflow",
  cleared: "cleared",
};

const features = tableFeatures({});
const column = createColumnHelper<typeof features, Transaction>();
const EMPTY: Transaction[] = [];
const EMPTY_ACCOUNTS: Account[] = [];
const NO_SAVED: ReadonlyMap<string, Transaction> = new Map();
const NO_ROWS: ReadonlySet<string> = new Set();
/** The transactions' part of the bar when only scheduled rows are selected. */
const NO_SUMMARY = {
  count: 0,
  total: "0",
  currency: null,
  uncleared: 0,
  cleared: 0,
  reconciled: 0,
  reconciledTransfers: 0,
  categorizable: 0,
  unapproved: 0,
  splits: 0,
  splitsWithTransfers: 0,
  deletable: 0,
};
/** A transaction row's height: 36px, or 44px for a finger (see the row's classes). */
const rowHeight = () =>
  typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches ? 44 : 36;
/**
 * A cell edited in place inside a 36px row: its field a step shorter than the editors' usual
 * 32px, so the row keeps its height. A finger's taller rows keep the usual height.
 */
/** A phone's ticked card. */
const SELECTED_CARD =
  "data-[state=selected]:bg-[color-mix(in_oklch,var(--primary)_8%,var(--background))] dark:data-[state=selected]:bg-[color-mix(in_oklch,var(--primary)_16%,var(--background))]";

/** A row whose save hasn't come back reads quieter: a new one at once, an edit after a moment. */
/**
 * An editable cell: a text cursor once its row is the only one selected, when a click edits it;
 * before that a click selects the row.
 */
const SOLE_ROW_EDITS = "group-data-[sole]/row:cursor-text";
const PENDING_ROW =
  "data-pending:text-muted-foreground data-[pending=cell]:*:delay-300 data-[pending=row]:*:delay-300";

const IN_ROW_EDITOR =
  "pointer-fine:[&_[data-slot=input-group]]:h-7! pointer-fine:[&_[data-slot=input]]:h-7! pointer-fine:[&_[data-slot=native-select]]:h-7!";

interface EditingCell {
  id: string;
  column: CellColumn;
}

/** A register row: a transaction, or one line of a split under it. */
type Item =
  | { kind: "transaction"; key: string; t: Transaction }
  | { kind: "line"; key: string; t: Transaction; line: SubTransaction };

/** The whole-transaction editor open on an existing row (splits are edited all at once). */
interface EditingSplit {
  id: string;
  draft: Draft;
  /** Opened with the S key, which starts in the memo. */
  fromKey?: boolean;
  /** Just split from its category or the Actions menu: starts in the first line's amount. */
  splitting?: boolean;
  /** Opened by a click on one of its cells: starts in that field. */
  focus?: EditorFocus;
}

/**
 * An account's register, or all accounts' (`accountId` left out), newest first unless sorted.
 * New transactions get a full row; existing ones are edited a cell at a time.
 * The server filters, sorts and pages (`search`, kept in the address by the page); more pages
 * load as you scroll, and rows are virtualized so long histories stay fast. `focusId` scrolls to
 * that transaction and highlights it (the other side of a transfer, when jumping to it).
 */
/** A saved transaction's version, and its transfer's other side's, by id. */
type PayeeRuleSnapshot = components["schemas"]["PayeeRuleSnapshot"];
type UpdateTransactionBody = components["schemas"]["UpdateTransaction"];
type AccountList = components["schemas"]["AccountList"];

/**
 * The side a folded Amount edits: the transaction's own (an FX revaluation, which has no native
 * amount, by its base amount's sign).
 */
function amountSide(t: Transaction): "outflow" | "inflow" {
  const amount = BigInt(t.amount);
  const sign = amount === 0n ? BigInt(t.baseAmount) : amount;
  return sign > 0n ? "inflow" : "outflow";
}

function versionsOf(row: Transaction): Record<string, number> {
  return {
    [row.id]: row.version,
    ...(row.transferSide ? { [row.transferSide.id]: row.transferSide.version } : {}),
  };
}

export function Register({
  accountId,
  focusId,
  search,
  onSearchChange,
  recordPayment,
  openRecordPayment = false,
  onRecordPaymentOpened,
}: {
  accountId?: string;
  focusId?: string;
  search: RegisterSearch;
  onSearchChange: (patch: Partial<RegisterSearch>, replace?: boolean) => void;
  /** A credit card's Record Payment: the new row it opens (the toolbar button). */
  recordPayment?: () => Draft;
  /** Open Record Payment's row now (the payment inspector's button). */
  openRecordPayment?: boolean;
  onRecordPaymentOpened?: () => void;
}) {
  const { budget, formatAmount, formatDate, readOnly } = useBudget();
  const history = useUndo();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [view, setView] = useRegisterView(budget.id, accountId ?? "all");
  // Coming back to a register brings back its last search, unless we came to show one
  // transaction (the other side of a transfer opens unfiltered).
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the register opens
  useEffect(() => {
    if (search.q !== undefined || focusId) return;
    const saved = savedSearch(budget.id, accountId ?? "all");
    if (saved) onSearchChange({ q: saved }, true);
  }, [budget.id, accountId]);
  const query = registerQuery(accountId, search, view);
  const today = todayIso();
  const transactions = useInfiniteQuery({
    queryKey: [...transactionsQueryPrefix, budget.id, query],
    queryFn: async ({ pageParam, signal }) => {
      // Not `$api.useInfiniteQuery`: it sends `cursor=0` for the first page.
      const { data, error } = await apiClient.GET("/v1/budgets/{budgetId}/transactions", {
        params: {
          path: { budgetId: budget.id },
          query: {
            ...query,
            // Entering what's come due first keeps the register current.
            today,
            limit: REGISTER_PAGE_SIZE,
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        },
        signal,
      });
      if (error) throw error;
      return data;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    // Keeps the old rows on screen while a new search or filter loads.
    placeholderData: keepPreviousData,
  });
  // The Scheduled Transactions section: the same search and date range, by next date.
  const scheduledFilter = {
    ...(accountId ? { accountId } : {}),
    ...(query.q ? { q: query.q } : {}),
    ...rangeDates(view),
  };
  const scheduled = useQuery({
    queryKey: [...scheduledQueryPrefix, budget.id, scheduledFilter],
    queryFn: async ({ signal }) => {
      const { data, error } = await apiClient.GET("/v1/budgets/{budgetId}/scheduled-transactions", {
        params: { path: { budgetId: budget.id }, query: { ...scheduledFilter, today } },
        signal,
      });
      if (error) throw error;
      return data.scheduledTransactions;
    },
    placeholderData: keepPreviousData,
  });
  const scheduledRows: readonly ScheduledTransaction[] = scheduled.data ?? [];
  const createScheduled = $api.useMutation("post", "/v1/budgets/{budgetId}/scheduled-transactions");
  const removeScheduled = $api.useMutation(
    "delete",
    "/v1/budgets/{budgetId}/scheduled-transactions/{scheduledTransactionId}",
  );
  // The section sits above the virtualized rows, so their offsets start below it.
  const [scheduledHeight, setScheduledHeight] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const measureScheduled = useCallback((node: HTMLTableSectionElement | null) => {
    observer.current?.disconnect();
    if (!node) return;
    setScheduledHeight(node.offsetHeight);
    if (typeof ResizeObserver === "undefined") return;
    observer.current = new ResizeObserver(() => setScheduledHeight(node.offsetHeight));
    observer.current.observe(node);
  }, []);
  const accounts = useQuery(accountsQueryOptions(budget.id));
  const categories = useQuery(categoriesQueryOptions(budget.id));
  const accountList = accounts.data?.accounts ?? EMPTY_ACCOUNTS;
  const accountById = useMemo(() => new Map(accountList.map((a) => [a.id, a])), [accountList]);
  /** How a row not saved yet names its account and category, as a saved one would. */
  const rowContext = useMemo((): RowContext => {
    const names = new Map(
      (categories.data?.groups ?? []).flatMap((g) => g.categories.map((c) => [c.id, c.name])),
    );
    return {
      account: (id) => accountById.get(id),
      categoryName: (id) => names.get(id) ?? null,
      usesCategory: (id, to) =>
        usesCategory(
          accountById.get(id)?.type ?? "checking",
          to ? accountById.get(to)?.type : null,
        ),
      budgetCurrency: budget.currency,
    };
  }, [accountById, categories.data, budget.currency]);
  // Saves show at once: new rows and edits wait here, over the loaded rows, until they're in.
  const [pendingCreates, setPendingCreates] = useState<readonly PendingCreate[]>([]);
  const [pendingEdits, setPendingEdits] = useState<readonly PendingEdit[]>([]);
  /** Rows a save returned, shown until the refreshed list catches up with them. */
  const [savedRows, setSavedRows] = useState<ReadonlyMap<string, Transaction>>(NO_SAVED);
  const merged = useMemo(
    () =>
      withPending(
        transactions.data?.pages.flatMap((p) => p.transactions) ?? EMPTY,
        { creates: pendingCreates, edits: pendingEdits, known: savedRows },
        rowContext,
        view.sort,
        accountId,
      ),
    [transactions.data, pendingCreates, pendingEdits, savedRows, rowContext, view.sort, accountId],
  );
  /** Rows whose save hasn't come back: new ones (a local id) and edited ones. */
  const pendingRows = merged.pending;
  // A day's transactions newest entry first, so a new one shows at the top of its day.
  const loaded = useMemo(() => enteredOrder(merged.rows, view.sort), [merged.rows, view.sort]);
  const someHidden = transactions.data?.pages[0]?.someHidden ?? false;
  // The info column hides when no row in view needs approval or a category.
  const needsReview = useMemo(() => loaded.some((t) => !t.approved || t.needsCategory), [loaded]);
  // Rows read in the running balance's order only when the date comes first.
  const dateOrder = view.sort[0]?.column === "date";
  // The budget starts the month before its oldest transaction (or before this month).
  const monthData = useQuery(monthQueryOptions(budget.id, currentMonth()));
  const oldestMonth = monthData.data ? addMonths(monthData.data.firstMonth, 1) : undefined;
  const payees = useQuery(payeesQueryOptions(budget.id));
  const flagList = useQuery(flagsQueryOptions(budget.id));
  const renameFlagMutation = $api.useMutation("put", "/v1/budgets/{budgetId}/flags/{color}");
  const create = $api.useMutation("post", "/v1/budgets/{budgetId}/transactions");
  // Every edit's own version steps go into the undo history.
  const update = $api.useMutation("patch", "/v1/budgets/{budgetId}/transactions/{transactionId}", {
    onSuccess: (row) => history.noteSave(row.previousVersions, versionsOf(row)),
  });
  const remove = $api.useMutation("delete", "/v1/budgets/{budgetId}/transactions/{transactionId}");
  const matchTx = $api.useMutation("post", "/v1/budgets/{budgetId}/transactions/match");
  const dontRenameTx = $api.useMutation(
    "post",
    "/v1/budgets/{budgetId}/transactions/{transactionId}/dont-rename",
  );
  const undoDontRenameTx = $api.useMutation(
    "post",
    "/v1/budgets/{budgetId}/transactions/{transactionId}/dont-rename/undo",
  );
  const unmatchTx = $api.useMutation(
    "post",
    "/v1/budgets/{budgetId}/transactions/{transactionId}/unmatch",
  );
  const [adding, setAdding] = useState(false);
  // A new transaction can take an attachment as it's entered; with AI on, a receipt fills it in.
  const aiEnabled = useAiSettings(budget.id).data?.enabled ?? false;
  const newAttachment = useMemo(() => ({ budgetId: budget.id, aiEnabled }), [budget.id, aiEnabled]);
  // What the new-transaction row starts with: empty, or Make Repeating's copy.
  const [addingDraft, setAddingDraft] = useState<Draft | null>(null);
  // Make Repeating opens the date picker on its row; Record Payment doesn't.
  const [addingPicker, setAddingPicker] = useState(false);
  const [addingKey, setAddingKey] = useState(0);
  const [newError, setNewError] = useState<string | null>(null);
  /** The transaction whose History dialog is open. */
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const session = useQuery(sessionQueryOptions);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  // The row whose Matched Transactions popover is open.
  const [matchFor, setMatchFor] = useState<string | null>(null);
  // The info column also shows while a matched row is edited: its link icon.
  const reviewing =
    needsReview || loaded.some((t) => t.matched && (t.id === editing?.id || t.id === matchFor));
  const [editingSplit, setEditingSplit] = useState<EditingSplit | null>(null);
  const [splitError, setSplitError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(NOTHING);
  /**
   * A phone's cards show their checkboxes only while selecting: started by a long press on one or
   * the toolbar's Select, ended by Done or by clearing the selection.
   */
  const [selecting, setSelecting] = useState(false);
  /** A change waiting on the reconciled-transaction warning. */
  const [warning, setWarning] = useState<{
    warning: ReconciledWarning;
    proceed: () => void;
    cancel?: () => void;
  } | null>(null);
  const proceeding = useRef(false);
  const anchor = useRef<string | null>(null);
  // Where a Shift+Up/Down range has reached (its other end is `anchor`).
  const head = useRef<string | null>(null);
  const bulk = $api.useMutation("post", "/v1/budgets/{budgetId}/transactions/bulk", {
    onSuccess: (result) => history.noteSave(result.previousVersions, result.versions),
  });
  const scheduledBulk = $api.useMutation(
    "post",
    "/v1/budgets/{budgetId}/scheduled-transactions/bulk",
  );
  const updateScheduled = $api.useMutation(
    "patch",
    "/v1/budgets/{budgetId}/scheduled-transactions/{scheduledTransactionId}",
  );
  // Ticked scheduled rows (by row id); they join the action bar's selection.
  const [scheduledSelection, setScheduledSelection] = useState<ReadonlySet<string>>(NO_ROWS);
  const scheduledAnchor = useRef<string | null>(null);
  // A new search or filter is a new set of rows, so the selection starts over.
  const queryKey = JSON.stringify(query);
  const [selectionKey, setSelectionKey] = useState(queryKey);
  if (selectionKey !== queryKey) {
    setSelectionKey(queryKey);
    setSelection(NOTHING);
    setScheduledSelection(NO_ROWS);
    anchor.current = null;
  }

  const allAccounts = accountId === undefined;
  const { widths, setWidth, resetWidths } = useColumnWidths(accountId ?? "all");
  // Narrower than lg (a phone, a tablet upright) the register is cards, edited in a drawer: the
  // table's columns don't fit and the amounts would scroll out of sight.
  const phone = useViewportWidth() < 1024;
  const shownColumns = useMemo(
    () =>
      registerColumns(allAccounts).filter(
        (c) =>
          (c !== "balance" || view.showRunningBalance) &&
          (c !== "flag" || view.showFlags) &&
          (c !== "attachment" || view.showAttachments) &&
          (c !== "enteredBy" || view.showEnteredBy) &&
          // A viewer can't select, approve or change rows.
          (c !== "select" || !readOnly) &&
          (c !== "review" || (reviewing && !readOnly)),
      ),
    [
      allAccounts,
      view.showRunningBalance,
      view.showFlags,
      view.showAttachments,
      view.showEnteredBy,
      reviewing,
      readOnly,
    ],
  );
  /** The register's width (px), measured once it's on screen; null before (and in tests). */
  const [registerWidth, setRegisterWidth] = useState<number | null>(null);
  /** The rows' scroll area, once it's on screen. */
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  /** An amount in `currency` (a row's, or its account's): the budget's by default. */
  const show = (amount: bigint, currency?: string) =>
    formatAmount(money(amount, inCurrency(budget, currency).currency));
  /** The budget's number format with account `id`'s currency, for its amounts. */
  const settingsOf = (id: string | undefined) =>
    inCurrency(budget, id ? accountById.get(id)?.currency : undefined);
  /** A transfer to an account in another currency: the money settings in that one's currency. */
  const otherSettingsOf = (draft: Pick<Draft, "accountId" | "transferAccountId">) => {
    const own = accountById.get(draft.accountId)?.currency;
    const other = draft.transferAccountId
      ? accountById.get(draft.transferAccountId)?.currency
      : undefined;
    return own && other && own !== other
      ? settingsOf(draft.transferAccountId ?? undefined)
      : undefined;
  };
  /**
   * A foreign-currency amount with what the plan counts under it, in the budget's currency,
   * and its rate on hover.
   */
  const withBase = (
    native: string,
    t: { currency: string; baseAmount: string; fxRate: string | null },
  ) => {
    if (t.currency === budget.currency) return native;
    const base = BigInt(t.baseAmount);
    return (
      <span
        className="inline-flex flex-col items-end leading-tight"
        title={t.fxRate ? `1 ${t.currency} = ${t.fxRate} ${budget.currency}` : undefined}
      >
        <span>
          {native}
          {/* All accounts mixes currencies: name the row's, which a symbol may not. */}
          {!accountId && <span className="ml-1 text-muted-foreground text-xs">{t.currency}</span>}
        </span>
        <span className="text-muted-foreground text-xs">{show(base < 0n ? -base : base)}</span>
      </span>
    );
  };
  /**
   * Each money column's figures as the rows show them, for the columns to fit the widest: a
   * foreign amount names its currency in All Accounts.
   */
  const cellTexts = useMemo(() => {
    const texts: Record<MoneyColumn | "payee" | "category" | "date", CellText[]> = {
      // A repeating schedule's date has its icon beside it.
      date: scheduledRows.map((row) => ({
        text: shortDate(row.dateNext, budget.dateFormat, today),
        extra: row.frequency !== "never" ? 18 : 0,
      })),
      outflow: [],
      inflow: [],
      amount: [],
      balance: [],
      payee: [],
      category: [],
    };
    for (const t of loaded) {
      texts.date.push(shortDate(t.date, budget.dateFormat, today));
      // A transfer's payee has its Go to button before it; a split or income its icon.
      texts.payee.push(
        t.transferAccountId
          ? {
              text: rowPayee(t.accountId, t.transferAccountId, BigInt(t.amount), t.payeeName) ?? "",
              extra: 24,
            }
          : (t.payeeName ?? ""),
      );
      const iconed =
        t.subtransactions.length > 0 || t.categoryId === categories.data?.readyToAssignCategoryId;
      const category = categoryText(t, true);
      texts.category.push(iconed ? { text: category, extra: 20 } : category);
      const amount = BigInt(t.amount);
      const code = !accountId && t.currency !== budget.currency ? ` ${t.currency}` : "";
      const sign = amount === 0n ? BigInt(t.baseAmount) : amount;
      const figure = formatAmount(
        money(amount < 0n ? -amount : amount, inCurrency(budget, t.currency).currency),
      );
      (sign < 0n ? texts.outflow : texts.inflow).push(figure + code);
      texts.amount.push(
        signedAmount(amount, (m) =>
          formatAmount(money(m, inCurrency(budget, t.currency).currency)),
        ) + code,
      );
      texts.balance.push(
        formatAmount(money(BigInt(t.runningBalance), inCurrency(budget, t.currency).currency)),
      );
    }
    return texts;
  }, [loaded, scheduledRows, today, accountId, budget, formatAmount, accountById, categories.data]);
  // Measured in the table's own font once it's on screen.
  const font = useMemo(() => {
    const table = viewport?.querySelector("table");
    if (!table) return "500 14px Inter, sans-serif";
    const style = getComputedStyle(table);
    return `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  }, [viewport]);
  const content = useMemo(() => measureContent(cellTexts, font), [cellTexts, font]);
  // The row editors share the read rows' layout, so nothing moves as a row opens or closes.
  const layout = useMemo(
    () =>
      layoutColumns(shownColumns, {
        dragged: widths,
        available: registerWidth,
        dateFormat: budget.dateFormat,
        content,
      }),
    [shownColumns, widths, registerWidth, budget.dateFormat, content],
  );
  const columnIds = layout.columns;
  /** Logos in the account column, as in the sidebar: only once some account has one, and room. */
  const showLogos = !layout.accountCompact && accountList.some((a) => a.logo);
  /** The currency of the register's own account (the budget's for all accounts). */
  const registerSettings = settingsOf(accountId);
  /** A new transaction in `id`, starting cleared in a cash account. */
  const newDraft = (id: string, date: string) => emptyDraft(id, date, accountById.get(id)?.type);
  const openAccounts = accountList.filter((a) => !a.closed);
  const account = accountId ? accountById.get(accountId) : undefined;
  const options = useMemo(
    () => (categories.data ? categoryOptions(categories.data) : []),
    [categories.data],
  );
  const payeeList = payees.data?.payees ?? [];
  /**
   * A phone's new transaction offers these payees to tap: the latest ones in the register (by
   * date), otherwise the most used.
   */
  const recentPayees = useMemo(() => {
    const list = payees.data?.payees ?? [];
    const hidden = new Set(list.filter((p) => p.hidden).map((p) => p.name));
    const newestFirst = (view.sort[0] ?? DEFAULT_SORT[0])?.dir === "desc" && dateFirst(view.sort);
    const names = newestFirst
      ? loaded.flatMap((t) => (t.payeeName && !t.transferAccountId ? [t.payeeName] : []))
      : [...list].sort((a, b) => b.useCount - a.useCount).map((p) => p.name);
    return [...new Set(names)].filter((name) => !hidden.has(name)).slice(0, 6);
  }, [payees.data, loaded, view.sort]);
  const flags = flagList.data?.flags ?? [];
  const searchSources = useMemo(
    () => ({ categories: options, accounts: accountList, flags, settings: registerSettings }),
    [options, accountList, flags, registerSettings],
  );

  /** Each category's available this month, beside it in the category fields. */
  const describeBalance = useMemo(() => {
    if (!monthData.data || !categories.data) return null;
    const available = new Map(monthData.data.categories.map((c) => [c.categoryId, c.available]));
    available.set(categories.data.readyToAssignCategoryId, monthData.data.readyToAssign);
    const currency = inCurrency(budget, undefined).currency;
    return (option: CategoryOption) => {
      const amount = available.get(option.id);
      if (amount === undefined) return null;
      return (
        <span
          className={cn(
            "text-xs",
            amount.startsWith("-")
              ? "text-destructive"
              : amount === "0"
                ? "text-muted-foreground"
                : "text-success",
          )}
        >
          {formatAmount(money(BigInt(amount), currency))}
        </span>
      );
    };
  }, [monthData.data, categories.data, budget, formatAmount]);

  const tableColumns = useMemo(
    () =>
      column.columns(
        columnIds.map((id) => column.display({ id, header: COLUMN_SPECS[id].header })),
      ),
    [columnIds],
  );
  const table = useTable({
    features,
    columns: tableColumns,
    data: loaded,
    getRowId: (t) => t.id,
  });
  const rows = table.getRowModel().rows;
  // Split lines sit right under their transaction (read-only; the split is edited as a whole)
  // once it's expanded; splits start folded, so more transactions fit.
  const [expandedSplits, toggleSplit] = useExpandedSplits();
  const flat = useMemo(
    () =>
      rows.flatMap(({ original: t }): Item[] => [
        { kind: "transaction", key: t.id, t },
        // Under a search, only the lines that match it show, folded or not.
        ...t.subtransactions
          .filter((line) =>
            t.matchingLineIds === null
              ? Boolean(expandedSplits[t.id])
              : t.matchingLineIds.includes(line.id),
          )
          .map((line): Item => ({ kind: "line", key: `${t.id}:${line.id}`, t, line })),
      ]),
    [rows, expandedSplits],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * The scroll area, measured for the width the columns share: its own width less the table
   * frame's padding (the frame itself grows with a table wider than the register).
   */
  // The rows fill the window below the toolbar: one scroll area, which ends at the page's foot.
  const fillHeight = useRemainingHeight(viewport);
  const viewportRef = useCallback((viewport: HTMLDivElement | null) => {
    scrollRef.current = viewport;
    setViewport(viewport);
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const frame = viewport.querySelector("[data-slot=table-container]");
      const style = frame ? getComputedStyle(frame) : null;
      const padding = style
        ? Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
        : 0;
      setRegisterWidth(viewport.clientWidth - padding);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      scrollRef.current = null;
    };
  }, []);
  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: rowHeight,
    getItemKey: (index) => flat[index]?.key ?? index,
    overscan: 12,
    scrollMargin: scheduledHeight,
    // Lets jsdom (no layout) render the first screen of rows.
    initialRect: { width: 1280, height: 800 },
  });
  const items = virtualizer.getVirtualItems();

  // Loads the next page as the last loaded rows scroll into view.
  const lastIndex = items.at(-1)?.index ?? -1;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = transactions;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && lastIndex >= flat.length - 20) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, lastIndex, flat.length]);

  /** A row that glows briefly: jumped to (the other side of a transfer), or just saved. */
  const [highlight, setHighlight] = useState<{ id: string; kind: "jump" | "saved" } | null>(null);
  useEffect(() => {
    if (!highlight) return;
    const timer = setTimeout(() => setHighlight(null), highlight.kind === "jump" ? 2500 : 900);
    return () => clearTimeout(timer);
  }, [highlight]);
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId || focused.current === focusId) return;
    // A scheduled row (from an Activity popover's upcoming list) is selected; it's at the top,
    // so there's nothing to load. Until the
    // scheduled rows are in, the id could be either.
    if (scheduled.isPending) return;
    if (scheduledRows.some((row) => row.id === focusId)) {
      focused.current = focusId;
      setScheduledSelection(new Set([focusId]));
      return;
    }
    const index = flat.findIndex((r) => r.key === focusId);
    if (index === -1) {
      // The other side of a transfer may be further back; load pages until it shows up.
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
      return;
    }
    focused.current = focusId;
    virtualizer.scrollToIndex(index, { align: "center" });
    setHighlight({ id: focusId, kind: "jump" });
  }, [
    focusId,
    flat,
    virtualizer,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    scheduledRows,
    scheduled.isPending,
  ]);
  /**
   * A transaction just saved, once the refreshed rows are in: brought into view (unless it was
   * saved with "Save and add another", whose new row stays put) and flashed. One the register
   * doesn't show (searched out, another account, further back) gets a toast instead.
   */
  const [reveal, setReveal] = useState<{ id: string; scroll: boolean; quiet?: boolean } | null>(
    null,
  );
  useEffect(() => {
    if (!reveal) return;
    setReveal(null);
    const index = flat.findIndex((r) => r.key === reveal.id);
    if (index === -1) {
      if (!reveal.quiet) toast.success("Transaction saved");
      return;
    }
    if (reveal.scroll) {
      if (phone) {
        document
          .querySelector(`li[data-transaction-id="${reveal.id}"]`)
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else {
        virtualizer.scrollToIndex(index, { align: "auto" });
      }
    }
    // A row still saving isn't flashed: it's marked as pending instead.
    if (!reveal.quiet) setHighlight({ id: reveal.id, kind: "saved" });
  }, [reveal, flat, virtualizer, phone]);
  const loadedIds = useMemo(() => loaded.map((t) => t.id), [loaded]);
  // The selection's filter is the register's, without the sort, and with the list's today so a
  // year-less `Income:` matches the same rows.
  const { sort: _sort, hideReconciled, ...rest } = query;
  const selectionFilter = {
    ...rest,
    today,
    ...(hideReconciled ? { hideReconciled: true } : {}),
  };
  const summary = $api.useQuery(
    "post",
    "/v1/budgets/{budgetId}/transactions/selection",
    {
      params: { path: { budgetId: budget.id } },
      body: { selection: selectionBody(selection, selectionFilter) },
    },
    { enabled: !isEmpty(selection) },
  );

  // The bar's figures: the selected transactions (none when only scheduled rows are ticked) plus
  // the selected scheduled rows.
  const selectionSummary = isEmpty(selection) ? NO_SUMMARY : summary.data;
  const selectedScheduled = scheduledRows.filter((row) => scheduledSelection.has(row.id));
  const scheduledTotal = selectedScheduled.reduce((sum, row) => sum + BigInt(row.amount), 0n);
  // Amounts in different currencies don't add up, so a mixed selection shows no total.
  const selectedCurrencies = new Set<string | null>(selectedScheduled.map((row) => row.currency));
  if (selectionSummary && selectionSummary.count > 0) {
    selectedCurrencies.add(selectionSummary.currency);
  }
  const mixedCurrencies = selectedCurrencies.size > 1 || selectedCurrencies.has(null);
  const [selectionCurrency] = selectedCurrencies;
  // Make Repeating is offered for exactly one plain transaction.
  const single =
    selection.mode === "some" && selection.ids.size === 1 && scheduledSelection.size === 0
      ? loaded.find((t) => selection.ids.has(t.id))
      : undefined;
  const repeatable = single && !single.transferFromSplit ? single : undefined;

  function toggleRow(id: string, on: boolean, shift: boolean) {
    const ids = shift ? rangeTo(loadedIds, anchor.current, id) : [id];
    anchor.current = id;
    head.current = id;
    setSelection((s) => setSelected(s, ids, on));
  }

  function toggleScheduled(id: string, on: boolean, shift: boolean) {
    const order = scheduledRows.map((row) => row.id);
    const ids = shift ? rangeTo(order, scheduledAnchor.current, id) : [id];
    scheduledAnchor.current = id;
    setScheduledSelection((current) => {
      const next = new Set(current);
      for (const rowId of ids) on ? next.add(rowId) : next.delete(rowId);
      return next;
    });
  }

  function clearSelection() {
    setSelection(NOTHING);
    setScheduledSelection(NO_ROWS);
    setSelecting(false);
  }

  /** Selects one row (a transaction or, with `scheduled`, a scheduled one) and nothing else. */
  function selectOnly(id: string, scheduled = false) {
    if (scheduled) {
      anchor.current = null;
      head.current = null;
      scheduledAnchor.current = id;
      setSelection(NOTHING);
      setScheduledSelection(new Set([id]));
      return;
    }
    anchor.current = id;
    head.current = id;
    setScheduledSelection(NO_ROWS);
    setSelection({ mode: "some", ids: new Set([id]) });
  }

  /**
   * When a row editor (the new transaction's, a split's) last closed. The rows under it move up as
   * it goes, so a click just after lands on another row than the one aimed at: it only selects.
   */
  const editorClosedAt = useRef(0);
  const rowEditorOpen = adding || editingSplit !== null;
  const rowEditorWasOpen = useRef(rowEditorOpen);
  useEffect(() => {
    if (rowEditorWasOpen.current && !rowEditorOpen) editorClosedAt.current = performance.now();
    rowEditorWasOpen.current = rowEditorOpen;
  }, [rowEditorOpen]);

  /**
   * A click on a transaction's cell. The first selects the row (Shift adds the range from the last
   * one picked, Cmd/Ctrl ticks or unticks it alone); one on the row that's the only one selected
   * (the second of a double-click too) edits the cell, through `edit`. The row's own controls (its
   * checkbox, flag, cleared and menu buttons, and what they open), and a drag that selected text,
   * aren't clicks on the row.
   */
  function clickRow(e: MouseEvent<HTMLElement>, id: string, edit?: (target: Element) => void) {
    const target = e.target;
    if (readOnly || isPendingId(id) || !(target instanceof Element)) return;
    if (!e.currentTarget.contains(target)) return;
    if (target.closest("button, a, input, textarea, select, label, [role=checkbox]")) return;
    // Shift extends the text selection too, and a double-click selects a word: neither is a drag
    // to copy text, so they go.
    if (e.shiftKey || e.detail > 1) window.getSelection()?.removeAllRanges();
    else if (window.getSelection()?.toString()) return;
    if (e.shiftKey) return toggleRow(id, true, true);
    if (e.metaKey || e.ctrlKey) return toggleRow(id, !isSelected(selection, id), false);
    const settled = performance.now() - editorClosedAt.current > 400;
    if (edit && settled && single?.id === id) return edit(target);
    selectOnly(id);
  }
  /**
   * Match: one imported transaction that isn't matched yet and
   * one entered transaction in the same account. Null when the selection isn't such a pair.
   */
  const pickedRows =
    selection.mode === "some" && scheduledSelection.size === 0
      ? loaded.filter((t) => selection.ids.has(t.id))
      : [];
  const allPickedLoaded = selection.mode === "some" && pickedRows.length === selection.ids.size;
  const matchPair = (() => {
    if (!allPickedLoaded || pickedRows.length !== 2) return null;
    const imported = pickedRows.find((t) => t.imported && !t.matched);
    const entered = pickedRows.find((t) => !t.imported && !t.matched);
    if (!imported || !entered || imported.accountId !== entered.accountId) return null;
    if (entered.cleared === "reconciled") return null;
    return { imported, entered };
  })();
  const unmatchable =
    allPickedLoaded && pickedRows.length > 0 && pickedRows.every((t) => t.matched !== null);

  async function runMatch(importedId: string, enteredId: string) {
    await matchTx.mutateAsync({
      params: { path: { budgetId: budget.id } },
      body: { transactionIds: [importedId, enteredId] },
    });
  }
  async function runUnmatch(id: string) {
    const done = await unmatchTx.mutateAsync({
      params: { path: { budgetId: budget.id, transactionId: id } },
    });
    return done.importedTransactionId;
  }

  /**
   * Bank Import Details' "Don't Rename as …": back to the imported payee, and
   * the payee's rule for that name goes. Undo puts back the payee, its approval and the same rule
   * (so it keeps its precedence); undo and redo check the row's version.
   */
  async function dontRename(t: Transaction) {
    const payeeId = t.payeeId;
    if (!payeeId) return;
    let removedRules: PayeeRuleSnapshot[] = [];
    /** The version this command last left the row at; the tab's own steps lead on from it. */
    let left = t.version;
    const path = { budgetId: budget.id, transactionId: t.id };
    const run = async (expectedVersion?: number) => {
      const done = await dontRenameTx.mutateAsync({ params: { path, query: { expectedVersion } } });
      history.noteSave(done.previousVersions, { [t.id]: done.version });
      removedRules = done.removedRules;
      left = done.version;
    };
    try {
      await run();
      history.record({
        label: "don't rename",
        undo: async () => {
          const done = await undoDontRenameTx.mutateAsync({
            params: { path, query: { expectedVersion: history.expectedVersion(t.id, left) } },
            body: { payeeId, approved: t.approved, rules: removedRules },
          });
          history.noteSave(done.previousVersions, { [t.id]: done.version });
          left = done.version;
          await refresh();
        },
        redo: async () => {
          await run(history.expectedVersion(t.id, left));
          await refresh();
        },
      });
      setEditing(null);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't rename it back");
    }
  }

  async function matchSelected() {
    if (!matchPair) return;
    const enteredId = matchPair.entered.id;
    let importedId = matchPair.imported.id;
    try {
      await runMatch(importedId, enteredId);
      history.record({
        label: "match transactions",
        undo: async () => {
          importedId = await runUnmatch(enteredId);
          await refresh();
        },
        redo: async () => {
          await runMatch(importedId, enteredId);
          await refresh();
        },
      });
      clearSelection();
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't match these transactions");
    }
  }

  async function unmatchRows(ids: readonly string[]) {
    const pairs: { enteredId: string; importedId: string }[] = [];
    try {
      for (const id of ids) pairs.push({ enteredId: id, importedId: await runUnmatch(id) });
      history.record({
        label: ids.length === 1 ? "unmatch transaction" : `unmatch ${ids.length} transactions`,
        undo: async () => {
          for (const p of pairs) await runMatch(p.importedId, p.enteredId);
          await refresh();
        },
        redo: async () => {
          for (const p of pairs) p.importedId = await runUnmatch(p.enteredId);
          await refresh();
        },
      });
      clearSelection();
      setEditing(null);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't unmatch");
      await refresh();
    }
  }

  /** Bulk actions; deleting reconciled transactions (or their transfers) asks first. */
  function requestBulk(action: BulkAction) {
    const found =
      action.type === "delete" && summary.data && !isEmpty(selection)
        ? deleteWarning(summary.data)
        : null;
    if (found) setWarning({ warning: found, proceed: () => void applyBulk(action) });
    else void applyBulk(action);
  }

  /**
   * One action on the selected transactions and scheduled rows, undone as one. Duplicate selects
   * the copies and Enter Now the entered transactions.
   */
  async function applyBulk(
    action: BulkAction,
    sel: Selection = selection,
    sched: ReadonlySet<string> = scheduledSelection,
  ) {
    try {
      const commands: Omit<UndoCommand, "label">[] = [];
      let count = 0;
      let nextSelection: Selection = NOTHING;
      let nextScheduled: ReadonlySet<string> = NO_ROWS;
      if (!isEmpty(sel) && action.type !== "enterNow") {
        const run = () =>
          bulk.mutateAsync({
            params: { path: { budgetId: budget.id } },
            body: { selection: selectionBody(sel, selectionFilter), action },
          });
        const result = await run();
        count += result.updated;
        if (action.type === "duplicate") {
          commands.push(duplicateCommand(async () => (await run()).created, result.created));
          // Every copy row whose original was ticked: both sides of a transfer ticked from both.
          nextSelection = { mode: "some", ids: new Set(result.copies) };
        } else if (result.updated > 0) {
          commands.push(bulkCommand(action, result.before, result.versions));
        }
      }
      if (
        sched.size > 0 &&
        action.type !== "cleared" &&
        action.type !== "approve" &&
        action.type !== "reject"
      ) {
        const ids = [...sched];
        const result = await scheduledBulk.mutateAsync({
          params: { path: { budgetId: budget.id } },
          body: { ids, action, today },
        });
        count += result.updated;
        if (result.updated > 0) commands.push(scheduledCommand(action, ids, result));
        if (action.type === "duplicate") nextScheduled = new Set(result.created);
        if (action.type === "enterNow") {
          nextSelection = { mode: "some", ids: new Set(result.entered) };
        }
      }
      if (commands.length > 0) {
        history.record({
          label: bulkLabel(action, count),
          destructive: bulkRemoves(action),
          // The ticked rows may be gone (copies, entered transactions), so the selection clears.
          undo: async () => {
            for (const command of [...commands].reverse()) await command.undo();
            clearSelection();
            await refresh();
          },
          redo: async () => {
            for (const command of commands) await command.redo();
            clearSelection();
            await refresh();
          },
        });
      }
      await refresh();
      // Actions that leave the rows in the register keep them selected, so C can toggle them back.
      // Only the selection the user made: Shift+L's "every row shown" isn't kept.
      const keep =
        sel === selection &&
        ["flag", "cleared", "approve", "categorize", "memo"].includes(action.type);
      setSelection(keep ? sel : nextSelection);
      setScheduledSelection(keep ? sched : nextScheduled);
      // A phone leaves selecting once nothing is left ticked.
      if (!keep && isEmpty(nextSelection) && nextScheduled.size === 0) setSelecting(false);
      // With Undo; a delete's stays up longer, as there's no confirmation before it.
      const message = bulkDoneMessage(action, count);
      if (commands.length > 0) history.announce(message, { destructive: bulkRemoves(action) });
      else toast.success(message);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't update the selected transactions."));
    }
  }

  /** Undo for duplicated transactions: delete the copies; redo copies the originals again. */
  function duplicateCommand(rerun: () => Promise<string[]>, created: string[]) {
    let current = created;
    return {
      undo: async () => {
        for (const transactionId of current) {
          await remove.mutateAsync({ params: { path: { budgetId: budget.id, transactionId } } });
        }
      },
      redo: async () => {
        current = await rerun();
      },
    };
  }

  /**
   * Undo for a bulk action on scheduled rows: schedules are put back exactly (first date
   * included) from `before`; copies and entered transactions are deleted.
   */
  function scheduledCommand(
    action: Exclude<BulkAction, { type: "cleared" | "approve" | "reject" }>,
    ids: string[],
    result: { before: ScheduledTransaction[]; entered: string[]; created: string[] },
  ) {
    const path = { budgetId: budget.id };
    let entered = result.entered;
    let created = result.created;
    // Schedules as they are now: deleted (or finished one-off) ones are gone.
    let current: (string | null)[] = result.before.map((b) =>
      action.type === "delete" || (action.type === "enterNow" && b.frequency === "never")
        ? null
        : b.id,
    );
    let redoIds = ids;
    return {
      undo: async () => {
        const restored: (string | null)[] = [];
        for (const [index, before] of result.before.entries()) {
          const body = { ...scheduleRestoreBody(before), today };
          const id = current[index];
          if (action.type === "duplicate") {
            restored.push(id ?? null);
            continue;
          }
          if (id) {
            await updateScheduled.mutateAsync({
              params: { path: { ...path, scheduledTransactionId: id } },
              body,
            });
            restored.push(id);
          } else {
            const again = await createScheduled.mutateAsync({ params: { path }, body });
            restored.push(again.scheduledTransaction?.id ?? null);
          }
        }
        current = restored;
        for (const transactionId of entered) {
          await remove.mutateAsync({ params: { path: { ...path, transactionId } } });
        }
        for (const scheduledTransactionId of created) {
          await removeScheduled.mutateAsync({
            params: { path: { ...path, scheduledTransactionId } },
          });
        }
        // Recreated schedules have new ids; the redo acts on what's there now.
        if (action.type === "delete" || action.type === "enterNow") {
          redoIds = current.filter((id): id is string => id !== null);
        }
      },
      redo: async () => {
        if (redoIds.length === 0) return;
        const again = await scheduledBulk.mutateAsync({
          params: { path },
          body: { ids: redoIds, action, today },
        });
        entered = again.entered;
        created = again.created;
        if (action.type === "delete") current = current.map(() => null);
        if (action.type === "enterNow") {
          current = result.before.map((b, i) =>
            b.frequency === "never" ? null : (current[i] ?? null),
          );
        }
      },
    };
  }

  // Item offsets count from the top of the Scheduled section (`scrollMargin`); the total doesn't.
  const lastEnd = items.at(-1)?.end;
  const paddingTop = (items[0]?.start ?? scheduledHeight) - scheduledHeight;
  const paddingBottom =
    lastEnd === undefined ? 0 : virtualizer.getTotalSize() + scheduledHeight - lastEnd;

  /** The balances moved by saves still on their way, put back over a refresh that lands first. */
  const pendingBalances = useRef(new Map<string, ReturnType<typeof balanceChange>>());
  const accountsKey = accountsQueryOptions(budget.id).queryKey;
  function moveBalances(change: ReturnType<typeof balanceChange>) {
    queryClient.setQueryData<AccountList>(
      accountsKey,
      (list) => list && withBalanceChange(list, change),
    );
  }

  async function refresh() {
    const before = queryClient.getQueryState(accountsKey)?.dataUpdatedAt;
    await refreshTransactions(queryClient, budget.id);
    if (pendingBalances.current.size === 0) return;
    if (queryClient.getQueryState(accountsKey)?.dataUpdatedAt === before) return;
    for (const change of pendingBalances.current.values()) moveBalances(change);
  }

  const editKey = useRef(0);
  /**
   * Saves an edit to `t`, shown at once along with the balances it moves (`kind`: "row" from the
   * editor, which marks the row as saving, or "cell"). A failed save puts the row back and says so;
   * `retry` offers to edit it again. Resolves with the saved row, or null.
   */
  async function saveEdit(
    t: Transaction,
    body: UpdateTransactionBody,
    {
      label,
      failure,
      kind = "cell",
      retry,
    }: { label: string; failure: string; kind?: "row" | "cell"; retry?: () => void },
  ): Promise<Transaction | null> {
    editKey.current += 1;
    const key = editKey.current;
    const balanceKey = `edit:${key}`;
    const change = balanceChange(t, patchedTransaction(t, body, rowContext), today);
    pendingBalances.current.set(balanceKey, change);
    moveBalances(change);
    setPendingEdits((list) => [...list, { key, id: t.id, body, kind }]);
    try {
      const after = await update.mutateAsync({
        params: {
          path: { budgetId: budget.id, transactionId: t.id },
          query: { today: todayIso() },
        },
        body,
      });
      pendingBalances.current.delete(balanceKey);
      setSavedRows((rows) => new Map(rows).set(after.id, after));
      setPendingEdits((list) => list.filter((e) => e.key !== key));
      recordUpdate(label, t, after);
      await refresh();
      setSavedRows((rows) => {
        if (rows.get(after.id) !== after) return rows;
        const next = new Map(rows);
        next.delete(after.id);
        return next;
      });
      return after;
    } catch (e) {
      pendingBalances.current.delete(balanceKey);
      setPendingEdits((list) => list.filter((edit) => edit.key !== key));
      toast.error(
        apiErrorMessage(e, failure),
        retry ? { action: { label: "Edit", onClick: retry } } : undefined,
      );
      await refresh();
      return null;
    }
  }

  /**
   * Brings a deleted transaction back (an undo): as the same record, so it keeps its place in its
   * day and later commands still find it, going on from the version it was deleted at. Should the
   * API not know it as deleted, it comes back as a new one.
   */
  async function restoreTransaction(t: Transaction, extra: Partial<CreateTransactionBody> = {}) {
    const run = (body: CreateTransactionBody) =>
      create.mutateAsync({
        params: { path: { budgetId: budget.id }, query: { today: todayIso() } },
        body: { ...body, ...extra },
      });
    const body = createBodyFromTransaction(t);
    try {
      const restored = await run(body);
      const after = versionsOf(restored);
      history.noteSave(
        Object.fromEntries(Object.entries(after).map(([id, version]) => [id, version - 1])),
        after,
      );
      return restored;
    } catch (error) {
      if (!isIdUnavailable(error)) throw error;
      return run(withoutIds(body));
    }
  }

  /** Undo for a bulk action on transactions, from their state before it. */
  function bulkCommand(
    action: Exclude<BulkAction, { type: "enterNow" }>,
    before: Transaction[],
    after: Record<string, number>,
  ) {
    let current = before;
    /** The version this command last left each row at; undo and redo follow the tab's steps. */
    let left = after;
    // Reject deletes the unapproved rows, so it's undone like a delete.
    const deletes = action.type === "delete" || action.type === "reject";
    return {
      undo: async () => {
        if (deletes) {
          const restored: Transaction[] = [];
          for (const transaction of before) restored.push(await restoreTransaction(transaction));
          current = restored;
        } else {
          const undone: Record<string, number> = {};
          for (const transaction of before) {
            // Followed each time: putting one side of a transfer back moves the other's too.
            const from = left[transaction.id] ?? transaction.version;
            const saved = await update.mutateAsync({
              params: {
                path: { budgetId: budget.id, transactionId: transaction.id },
                query: { today: todayIso() },
              },
              body: {
                ...updateBodyFromTransaction(transaction),
                expectedVersion: history.expectedVersion(transaction.id, from),
              },
            });
            Object.assign(undone, versionsOf(saved));
          }
          left = undone;
          current = before;
        }
      },
      redo: async () => {
        if (deletes) {
          for (const transaction of current) {
            await remove.mutateAsync({
              params: {
                path: { budgetId: budget.id, transactionId: transaction.id },
                query: {
                  expectedVersion: history.expectedVersion(transaction.id, transaction.version),
                },
              },
            });
          }
        } else if (action.type !== "duplicate") {
          const ids = current.map((transaction) => transaction.id);
          const result = await bulk.mutateAsync({
            params: { path: { budgetId: budget.id } },
            body: {
              selection: { ids },
              action,
              expectedVersions: Object.fromEntries(
                ids.flatMap((id) => {
                  const from = left[id];
                  return from === undefined ? [] : [[id, history.expectedVersion(id, from)]];
                }),
              ),
            },
          });
          left = result.versions;
        }
      },
    };
  }

  /**
   * Undo for a single edit: puts the row back as it was, unless a partner changed it since
   * (`expectedVersion`; the API refuses with STALE_VERSION).
   */
  function recordUpdate(label: string, before: Transaction, after: Transaction) {
    // The version this command last left the row at; the tab's own steps lead on from it.
    let left = after.version;
    const replay = async (row: Transaction) => {
      const saved = await update.mutateAsync({
        params: {
          path: { budgetId: budget.id, transactionId: row.id },
          query: { today: todayIso() },
        },
        body: {
          ...updateBodyFromTransaction(row),
          expectedVersion: history.expectedVersion(row.id, left),
        },
      });
      left = saved.version;
      await refresh();
    };
    history.record({ label, undo: () => replay(before), redo: () => replay(after) });
  }

  /** A transfer's payee as the register words it ("Payment: X" / "Transfer: X"). */
  function rowPayee(
    accountId: string,
    transferAccountId: string | null,
    amount: bigint,
    stored: string | null,
  ) {
    const own = accountById.get(accountId);
    const other = transferAccountId ? accountById.get(transferAccountId) : undefined;
    return own && other ? transferRowLabel(own.type, other, amount) : stored;
  }

  /**
   * An in-budget transfer's category cell: "Credit Card Payments: <card>" between a card and a
   * cash account (`paymentCategoryCard`), otherwise nothing.
   */
  function transferCategory(accountId: string, transferAccountId: string | null) {
    const own = accountById.get(accountId);
    const other = transferAccountId ? accountById.get(transferAccountId) : undefined;
    const card = own && other ? paymentCategoryCard(own, other) : null;
    if (!card?.paymentCategoryId) return "";
    const group = categories.data?.groups.find((g) =>
      g.categories.some((c) => c.id === card.paymentCategoryId),
    );
    const category = group?.categories.find((c) => c.id === card.paymentCategoryId);
    return group && category ? `${group.name}: ${category.name}` : "";
  }

  /** Whether `t` has a category: not in tracking accounts, nor on in-budget transfers. */
  function hasCategory(t: Transaction) {
    const type = accountById.get(t.accountId)?.type ?? "checking";
    const transferType = t.transferAccountId ? accountById.get(t.transferAccountId)?.type : null;
    return usesCategory(type, transferType);
  }

  /** How many categories a split's lines go to. */
  function splitCount(t: Transaction) {
    return new Set(t.subtransactions.map((l) => l.categoryId ?? l.transferAccountId)).size;
  }

  /**
   * A row's category as plain text, for a tooltip or a phone's summary line (`short`: "Split (2)",
   * and nothing where no category is needed).
   */
  function categoryText(t: Transaction, short = false): string {
    if (t.subtransactions.length > 0) {
      const count = splitCount(t);
      return short
        ? `Split (${count})`
        : `Split (${count} ${count === 1 ? "category" : "categories"})`;
    }
    if (t.needsCategory) return "Needs a category";
    const notNeeded = categoryNotNeeded({
      accountType: accountById.get(t.accountId)?.type ?? "checking",
      transferAccountType: t.transferAccountId
        ? (accountById.get(t.transferAccountId)?.type ?? null)
        : null,
      payeeName: t.payeeName,
    });
    if (!notNeeded) {
      return short && t.categoryId === categories.data?.readyToAssignCategoryId
        ? "Ready to Assign"
        : (t.categoryName ?? "");
    }
    return (
      transferCategory(t.accountId, t.transferAccountId) || (short ? "" : "Category not needed")
    );
  }

  /** The full text of a cell that may be cut short, for its tooltip. */
  function cellTitle(t: Transaction, id: ColumnId): string | undefined {
    if (id === "payee") {
      const payee = rowPayee(t.accountId, t.transferAccountId, BigInt(t.amount), t.payeeName);
      // Without its own column, the memo follows the payee.
      return [payee, layout.memoInPayee ? t.memo : ""].filter(Boolean).join(" · ") || undefined;
    }
    if (id === "category") return categoryText(t) || undefined;
    if (id === "memo") return t.memo || undefined;
    if (id === "account") return t.accountName;
    // The full date behind this year's short one.
    if (id === "date") return formatDate(t.date);
    return undefined;
  }

  /** A saved row's category cell; "Category not needed" in muted text. */
  function rowCategory(t: Transaction): ReactNode {
    const notNeeded = categoryNotNeeded({
      accountType: accountById.get(t.accountId)?.type ?? "checking",
      transferAccountType: t.transferAccountId
        ? (accountById.get(t.transferAccountId)?.type ?? null)
        : null,
      payeeName: t.payeeName,
    });
    if (!notNeeded) return categoryName(t);
    return (
      transferCategory(t.accountId, t.transferAccountId) || (
        <span className="text-muted-foreground">Category not needed</span>
      )
    );
  }

  /**
   * A category's name in a row: income reads "Ready to Assign" behind an inflow arrow (the stored
   * "Inflow: Ready to Assign" says it twice and doesn't fit a narrow column).
   */
  function categoryName(row: { categoryId: string | null; categoryName: string | null }) {
    if (!row.categoryId || row.categoryId !== categories.data?.readyToAssignCategoryId) {
      return row.categoryName && <CategoryLabel name={row.categoryName} />;
    }
    return (
      <span className="inline-flex min-w-0 items-center gap-1">
        <ArrowDownLeft className="size-3.5 shrink-0 text-success" role="img" aria-label="Inflow:" />
        <span className="truncate">Ready to Assign</span>
      </span>
    );
  }

  /**
   * The cells of `t` that can be edited, in Tab order. A split's transfer side only takes its
   * memo and category; the split owns the rest.
   */
  function editableColumns(t: Transaction): CellColumn[] {
    if (readOnly) return [];
    const categorized = hasCategory(t);
    return (
      columnIds
        // A memo without its own column is edited in the payee's cell, after the payee.
        .flatMap((c): ColumnId[] =>
          c === "amount"
            ? [amountSide(t)]
            : c === "payee" && layout.memoInPayee
              ? [c, "memo"]
              : [c],
        )
        .filter(
          (c): c is CellColumn =>
            isEditable(c) &&
            (c !== "category" || categorized) &&
            (!t.transferFromSplit || c === "memo" || c === "category"),
        )
    );
  }

  /**
   * The register column a cell is edited in: a folded Amount holds Outflow and Inflow, and the
   * payee's cell a memo without its own column.
   */
  function columnOf(cell: CellColumn): ColumnId {
    if ((cell === "outflow" || cell === "inflow") && columnIds.includes("amount")) return "amount";
    if (cell === "memo" && layout.memoInPayee) return "payee";
    return cell;
  }

  /**
   * Splits open as a whole, as do transactions being split from the category cell; `focus` is the
   * field to start in (the cell that was clicked).
   */
  function openSplit(t: Transaction, split = false, fromKey = false, focus?: EditorFocus) {
    const draft = draftFrom(t, inCurrency(budget, t.currency));
    setEditing(null);
    setAdding(false);
    setSplitError(null);
    setEditingSplit({
      id: t.id,
      draft: split ? startSplit(draft) : draft,
      fromKey,
      splitting: split && !fromKey,
      focus,
    });
  }

  /** The editor field a click on a row's cell means: the memo shown after the payee is the memo's. */
  function clickedColumn(id: ColumnId, target: EventTarget): ColumnId {
    if (id === "payee" && target instanceof Element && target.closest("[data-memo]")) return "memo";
    return id;
  }

  async function saveSplit(t: Transaction, draft: Draft, confirmed = false) {
    if (!draft.date) return setSplitError("Enter a date.");
    const result = updateBody(t, draft, settingsOf(draft.accountId), otherSettingsOf(draft));
    if (!result.ok) return setSplitError(result.error);
    if (draft.date > today) {
      if (await reschedule(t, draft)) setEditingSplit(null);
      return;
    }
    const found = confirmed ? null : editWarning(t, result.body, accountName);
    if (found) {
      setWarning({ warning: found, proceed: () => void saveSplit(t, draft, true) });
      return;
    }
    // The row shows the edit at once; the editor closes without waiting for the save.
    setEditingSplit(null);
    if (Object.keys(result.body).length === 0) return;
    const after = await saveEdit(t, result.body, {
      label: "edit transaction",
      failure: "Couldn't save the transaction.",
      kind: "row",
      retry: () => {
        setEditing(null);
        setAdding(false);
        setSplitError(null);
        setEditingSplit({ id: t.id, draft });
      },
    });
    if (after) setReveal({ id: t.id, scroll: true });
  }

  /** Accounts the payee cell offers transfers to: other open ones, plus the current target. */
  function transferTargets(t: Transaction) {
    return accountList.filter(
      (a) => a.id !== t.accountId && (!a.closed || a.id === t.transferAccountId),
    );
  }

  function jumpToOtherSide(t: Transaction) {
    if (!t.transferAccountId || !t.transferTransactionId) return;
    // The other register opens unfiltered, so the other side is in it.
    void navigate({
      to: "/budgets/$budgetId/accounts/$accountId",
      params: { budgetId: budget.id, accountId: t.transferAccountId },
      search: { transaction: t.transferTransactionId },
    });
  }

  /** Opens the new-transaction row: empty, or with a draft (Make Repeating's, Record Payment's). */
  function startAdding(draft: Draft | null = null, openPicker = draft !== null) {
    setEditing(null);
    setEditingSplit(null);
    setNewError(null);
    setAddingDraft(draft);
    setAddingPicker(openPicker);
    setAddingKey((k) => k + 1);
    setAdding(true);
  }

  /**
   * Make Repeating: a new scheduled row prefilled from `t`, a month later and repeating
   * monthly; saving it creates the schedule and leaves `t` as it is.
   */
  function makeRepeating(t: Transaction) {
    clearSelection();
    startAdding(makeRepeatingDraft(t, inCurrency(budget, t.currency)));
  }

  /**
   * After a save: close the new row, or ("Save and add another") open a fresh one that keeps the
   * date, in the register's own account.
   */
  function afterNewSaved(draft: Draft, another: boolean) {
    if (another && defaultAccountId) startAdding(newDraft(defaultAccountId, draft.date), false);
    else setAdding(false);
  }

  async function saveNew(draft: Draft, another = false, file: File | null = null) {
    if (!draft.date) return setNewError("Enter a date.");
    if (isScheduled(draft, today)) {
      // A scheduled transaction can't have an attachment.
      if (file) {
        return setNewError(
          "Scheduled transactions can't have attachments. Remove the file, or date it today or earlier.",
        );
      }
      return saveNewScheduled(draft, another);
    }
    const result = createBody(draft, settingsOf(draft.accountId), otherSettingsOf(draft));
    if (!result.ok) return setNewError(result.error);
    const fee = result.body.fee;
    // The row goes in at once, marked as saving, and the editor moves on without waiting.
    const id = pendingId();
    const row = pendingTransaction(id, result.body, rowContext);
    const change = balanceChange(null, row, today);
    pendingBalances.current.set(id, change);
    moveBalances(change);
    setPendingCreates((list) => [...list, { row }]);
    afterNewSaved(draft, another);
    if (!another) setReveal({ id, scroll: true, quiet: true });
    try {
      const created = await create.mutateAsync({
        params: { path: { budgetId: budget.id }, query: { today: todayIso() } },
        body: result.body,
      });
      pendingBalances.current.delete(id);
      setPendingCreates((list) =>
        list.map((p) => (p.row.id === id ? { ...p, savedId: created.id } : p)),
      );
      let current = created;
      history.record({
        label: "add transaction",
        undo: async () => {
          await remove.mutateAsync({
            params: {
              path: { budgetId: budget.id, transactionId: current.id },
              query: { expectedVersion: history.expectedVersion(current.id, current.version) },
            },
          });
          // A transfer's fee is a transaction of its own; it goes with the transfer it came with.
          const feeId = current.feeTransactionId;
          if (feeId) {
            await remove.mutateAsync({
              params: { path: { budgetId: budget.id, transactionId: feeId } },
            });
          }
          await refresh();
        },
        redo: async () => {
          current = await restoreTransaction(created, fee ? { fee } : {});
          await refresh();
        },
      });
      await refresh();
      setReveal({ id: created.id, scroll: !another });
      if (file) void attachToNew(created.id, file);
    } catch (e) {
      pendingBalances.current.delete(id);
      toast.error(apiErrorMessage(e, "Couldn't save the transaction."), {
        action: { label: "Edit", onClick: () => startAdding(draft, false) },
      });
      await refresh();
    } finally {
      setPendingCreates((list) => list.filter((p) => p.row.id !== id));
    }
  }

  /** A new transaction's attachment, uploaded once the transaction exists. */
  async function attachToNew(transactionId: string, file: File) {
    try {
      const { error } = await apiClient.POST(
        "/v1/budgets/{budgetId}/transactions/{transactionId}/attachment",
        {
          params: { path: { budgetId: budget.id, transactionId } },
          body: { file: file as unknown as string },
          bodySerializer: () => {
            const form = new FormData();
            form.append("file", file);
            return form;
          },
        },
      );
      if (error) {
        toast.error(apiErrorMessage(error, "Saved, but the attachment couldn't be added."));
      }
      await refresh();
    } catch {
      toast.error("Saved, but the attachment couldn't be added. Add it from the register.");
    }
  }

  /**
   * A new transaction that repeats or is dated ahead is a scheduled one. A past date with
   * a repeat enters that one transaction and starts the schedule after today.
   */
  async function saveNewScheduled(draft: Draft, another = false) {
    const result = scheduleCreateBody(draft, settingsOf(draft.accountId), today);
    if (!result.ok) return setNewError(result.error);
    // The editor moves on at once; a failed save offers the draft back.
    afterNewSaved(draft, another);
    try {
      const body = result.body;
      let written = await createScheduled.mutateAsync({
        params: { path: { budgetId: budget.id } },
        body,
      });
      history.record({
        label: "add scheduled transaction",
        undo: async () => {
          if (written.scheduledTransaction) {
            await removeScheduled.mutateAsync({
              params: {
                path: {
                  budgetId: budget.id,
                  scheduledTransactionId: written.scheduledTransaction.id,
                },
              },
            });
          }
          if (written.enteredTransactionId) {
            await remove.mutateAsync({
              params: {
                path: { budgetId: budget.id, transactionId: written.enteredTransactionId },
              },
            });
          }
          await refresh();
        },
        redo: async () => {
          written = await createScheduled.mutateAsync({
            params: { path: { budgetId: budget.id } },
            body,
          });
          await refresh();
        },
      });
      await refresh();
      // A past date with a repeat enters that one now; the rest wait in Scheduled Transactions.
      if (written.enteredTransactionId) {
        setReveal({ id: written.enteredTransactionId, scroll: !another });
      } else {
        toast.success("Added to Scheduled Transactions");
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't save the transaction."), {
        action: { label: "Edit", onClick: () => startAdding(draft, false) },
      });
    }
  }

  /**
   * Moving a transaction's date into the future makes it a scheduled transaction, its
   * transfer's other side included. Undo brings the transaction back.
   */
  async function reschedule(t: Transaction, draft: Draft) {
    const result = rescheduleBody(t, draft, settingsOf(draft.accountId), today);
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    try {
      let written = await createScheduled.mutateAsync({
        params: { path: { budgetId: budget.id } },
        body: result.body,
      });
      let restored: Transaction | null = null;
      history.record({
        label: "schedule transaction",
        undo: async () => {
          // The transaction first: if it can't come back, the schedule stays.
          restored = await restoreTransaction(t);
          const id = written.scheduledTransaction?.id;
          if (id) {
            await removeScheduled.mutateAsync({
              params: { path: { budgetId: budget.id, scheduledTransactionId: id } },
            });
          }
          await refresh();
        },
        redo: async () => {
          if (!restored) return;
          written = await createScheduled.mutateAsync({
            params: { path: { budgetId: budget.id } },
            body: { ...result.body, fromTransactionId: restored.id },
          });
          await refresh();
        },
      });
      await refresh();
      toast.success("Moved to Scheduled Transactions");
      return true;
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't schedule the transaction."));
      return false;
    }
  }

  /**
   * Tab off the row's last editable cell (Shift+Tab off its first) goes on to the row's next control
   * (the Cleared button; the flag going back), as the browser would have: the closing editor took
   * the focus with it, which otherwise lands on the page and costs an extra Tab.
   */
  function focusPast(id: string, cell: CellColumn, exit: "next" | "previous") {
    requestAnimationFrame(() => {
      const row = document.querySelector(`tr[data-transaction-id="${id}"]`);
      if (!row) return;
      const at = columnIds.indexOf(columnOf(cell));
      const cells = [...row.children];
      const beyond = exit === "next" ? cells.slice(at + 1) : cells.slice(0, at).reverse();
      for (const td of beyond) {
        const controls = [
          ...td.querySelectorAll<HTMLElement>("button, input, select, a[href], [tabindex]"),
        ].filter((el) => el.tabIndex >= 0 && !el.hasAttribute("disabled"));
        const target = exit === "next" ? controls[0] : controls.at(-1);
        if (target) {
          target.focus();
          return;
        }
      }
    });
  }

  async function commitCell(
    t: Transaction,
    cell: CellColumn,
    value: string | null,
    exit: CellExit,
    transferAccountId: string | null,
  ) {
    const result = cellUpdate(t, cell, value, inCurrency(budget, t.currency), transferAccountId);
    if (!result.ok) {
      toast.error(result.error);
      setEditing({ id: t.id, column: cell });
      return;
    }
    if (result.body.date && result.body.date > today) {
      setEditing(null);
      await reschedule(t, {
        ...draftFrom(t, inCurrency(budget, t.currency)),
        date: result.body.date,
      });
      return;
    }
    const order = editableColumns(t);
    const next = order[order.indexOf(cell) + (exit === "next" ? 1 : -1)];
    setEditing(exit !== "stay" && next ? { id: t.id, column: next } : null);
    if (exit !== "stay" && !next) focusPast(t.id, cell, exit);
    if (Object.keys(result.body).length === 0) return;
    const save = async () => {
      const after = await saveEdit(t, result.body, {
        label: "edit transaction",
        failure: "Couldn't save the change.",
      });
      // A new date moves the row: follow it.
      if (after && result.body.date) setReveal({ id: t.id, scroll: true });
    };
    const found = editWarning(t, result.body, accountName);
    if (!found) return save();
    setEditing(null);
    setWarning({
      warning: found,
      proceed: () => void save(),
      // Back to the cell: Cancel leaves the row open.
      cancel: () => setEditing({ id: t.id, column: cell }),
    });
  }

  function accountName(id: string) {
    return accountById.get(id)?.name ?? "the other account";
  }

  async function setFlag(t: Transaction, flag: FlagColor | null) {
    await saveEdit(
      t,
      { flag },
      {
        label: flag ? "flag transaction" : "remove flag",
        failure: "Couldn't change the flag.",
      },
    );
  }

  /** Flag names are the budget's, so everyone on it sees the new ones. */
  async function renameFlags(changes: Flag[]) {
    try {
      for (const { color, name } of changes) {
        await renameFlagMutation.mutateAsync({
          params: { path: { budgetId: budget.id, color } },
          body: { name },
        });
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't rename the flags."));
      throw e;
    } finally {
      await queryClient.invalidateQueries({ queryKey: flagsQueryOptions(budget.id).queryKey });
    }
  }

  async function toggleCleared(t: Transaction) {
    const cleared = t.cleared === "uncleared" ? "cleared" : "uncleared";
    await saveEdit(
      t,
      { cleared },
      {
        label: `mark transaction ${cleared}`,
        failure: "Couldn't update the transaction.",
      },
    );
  }

  /** Approve on one row; undone as an edit (a transfer's other side follows). */
  async function approveRow(t: Transaction) {
    await saveEdit(
      t,
      { approved: true },
      {
        label: "approve transaction",
        failure: "Couldn't approve the transaction.",
      },
    );
  }

  function handleDelete(t: Transaction) {
    const found = deleteWarning(rowDeleteScope(t));
    if (found) setWarning({ warning: found, proceed: () => void deleteRow(t) });
    else void deleteRow(t);
  }

  /** Delete, or Reject (which deletes an unapproved transaction it didn't import). */
  async function deleteRow(t: Transaction, reject = false) {
    try {
      await remove.mutateAsync({
        params: { path: { budgetId: budget.id, transactionId: t.id } },
      });
      let current: Transaction | null = null;
      history.record({
        label: reject ? "reject transaction" : "delete transaction",
        destructive: true,
        undo: async () => {
          current = await restoreTransaction(t);
          await refresh();
        },
        redo: async () => {
          if (!current) return;
          await remove.mutateAsync({
            params: {
              path: { budgetId: budget.id, transactionId: current.id },
              query: { expectedVersion: history.expectedVersion(current.id, current.version) },
            },
          });
          await refresh();
        },
      });
      await refresh();
      const transfers = t.transferAccountId || t.subtransactions.some((l) => l.transferAccountId);
      history.announce(
        reject
          ? "Transaction rejected"
          : transfers
            ? "Deleted, with its transfers"
            : "Transaction deleted",
        { destructive: true },
      );
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't delete the transaction."));
    }
  }

  const defaultAccountId = accountId ?? openAccounts[0]?.id;
  // A budget without accounts has nowhere to put a transaction: All Accounts offers to add one.
  const noAccounts = allAccounts && accounts.isSuccess && accountList.length === 0;
  const [addingAccount, setAddingAccount] = useState(false);
  const canAdd = defaultAccountId !== undefined && (allAccounts || account?.closed === false);

  // Arriving from the payment inspector's Record Payment opens the same row the toolbar does.
  const startPayment = recordPayment && canAdd && openRecordPayment ? recordPayment : null;
  const paymentOpened = useRef(false);
  useEffect(() => {
    if (!openRecordPayment) paymentOpened.current = false;
    if (!startPayment || paymentOpened.current) return;
    // Once per arrival; the route then drops `openRecordPayment` from the URL.
    paymentOpened.current = true;
    startAdding(startPayment(), false);
    onRecordPaymentOpened?.();
    // biome-ignore lint/correctness/useExhaustiveDependencies: startAdding is a plain function
  }, [openRecordPayment, startPayment, onRecordPaymentOpened]);

  // The register's shortcuts; the selection bar binds the ones on a selection.
  const rootRef = useRef<HTMLDivElement>(null);
  const idle = !adding && editing === null && editingSplit === null;
  function stepRows(direction: 1 | -1, extend: boolean) {
    const ids = selection.mode === "some" ? selection.ids : new Set<string>();
    const next = stepSelection(
      loadedIds,
      ids,
      { anchor: anchor.current, head: head.current },
      direction,
      { extend, several: "anchor" },
    );
    if (!next) return;
    anchor.current = next.cursor.anchor;
    head.current = next.cursor.head;
    setScheduledSelection(NO_ROWS);
    setSelection({ mode: "some", ids: new Set(next.ids) });
    const index = flat.findIndex((item) => item.key === next.cursor.head);
    if (index !== -1) virtualizer.scrollToIndex(index, { align: "auto" });
  }
  useShortcut("moveTransactions", (e) => stepRows(e.key === "ArrowUp" ? -1 : 1, false), {
    enabled: idle && !readOnly,
  });
  useShortcut("extendTransactions", (e) => stepRows(e.key === "ArrowUp" ? -1 : 1, true), {
    enabled: idle && !readOnly,
  });
  useShortcut("selectAll", () => setSelection({ mode: "all", except: new Set() }), {
    enabled: idle && !readOnly && loaded.length > 0,
  });
  useShortcut("deselectAll", clearSelection, {
    enabled: idle && (!isEmpty(selection) || scheduledSelection.size > 0),
  });
  useShortcut("addTransaction", () => startAdding(null, true), {
    enabled: !readOnly && canAdd && idle,
  });
  // S and K act on one selected transaction: its split editor, or its category list.
  useShortcut(
    "split",
    () => {
      if (!single) return;
      if (single.subtransactions.length > 0) openSplit(single, false, true);
      else if (!single.transferFromSplit && !single.transferAccountId) {
        openSplit(single, true, true);
      }
    },
    { enabled: idle && single !== undefined },
  );
  // Enter edits the one selected transaction from the keyboard, as a click on a cell does.
  const shortcutsOn = useShortcutsEnabled();
  useHotkeys(
    "enter",
    () => {
      if (!single) return;
      if (single.subtransactions.length > 0) return openSplit(single);
      const [first] = editableColumns(single);
      if (first) setEditing({ id: single.id, column: first });
    },
    {
      enabled: shortcutsOn && idle && single !== undefined && !phone,
      preventDefault: true,
      // Enter on a button or link presses it, and popovers keep their keys.
      ignoreEventWhen: (e) =>
        e.target instanceof Element &&
        e.target.closest(
          "button, a, [role=dialog], [role=menu], [data-radix-popper-content-wrapper]",
        ) !== null,
    },
    [single, idle, phone],
  );
  // Space ticks or unticks the row the arrow keys are on, adding to or taking from the selection.
  useHotkeys(
    "space",
    () => {
      const id = head.current;
      if (id && loadedIds.includes(id)) toggleRow(id, !isSelected(selection, id), false);
    },
    {
      enabled: shortcutsOn && idle && !readOnly && !phone,
      preventDefault: true,
      ignoreEventWhen: (e) =>
        e.target instanceof Element &&
        e.target.closest(
          "button, a, [role=checkbox], [role=dialog], [role=menu], [data-radix-popper-content-wrapper]",
        ) !== null,
    },
    [selection, idle, phone, loadedIds],
  );
  const singleCategory =
    single && editableColumns(single).includes("category") && single.subtransactions.length === 0;
  useShortcut("search", () => {
    rootRef.current
      ?.querySelector<HTMLInputElement>("input[aria-label='Search transactions']")
      ?.focus();
  });
  // Approve every unapproved transaction the register shows (its search included).
  useShortcut(
    "approveAll",
    () => void applyBulk({ type: "approve" }, { mode: "all", except: new Set() }, NO_ROWS),
    { enabled: idle && !readOnly && needsReview && !bulk.isPending },
  );

  const editingTransaction = editingSplit
    ? loaded.find((t) => t.id === editingSplit.id)
    : undefined;
  // The accounts too: without them a budget that has none would first read as one without
  // transactions.
  if (transactions.isPending || accounts.isPending) return <RegisterSkeleton phone={phone} />;
  if (transactions.isError) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {apiErrorMessage(transactions.error, "Couldn't load the transactions.")}
      </p>
    );
  }
  const q = searchText(search);
  // Nothing to show at all: an empty state in the table's place.
  const empty = rows.length === 0 && scheduledRows.length === 0 && !adding && !someHidden;
  const [first]: readonly SortField[] = view.sort.length > 0 ? view.sort : DEFAULT_SORT;
  const sort = first?.column;
  const dir = first?.dir;

  /**
   * A payee cell's content with the row's memo after it, quieter, when Memo has no column of its
   * own. The payee keeps its room; the memo takes what's left.
   */
  function withMemo(memo: string, payee: ReactNode): ReactNode {
    if (!layout.memoInPayee || !memo) return payee;
    return (
      // One line: a memo without room for a few letters wraps out of sight, not to a sliver.
      <span className="flex h-5 min-w-0 flex-wrap items-baseline gap-x-2 overflow-hidden">
        <span className="max-w-full truncate">{payee}</span>
        <span data-memo className="min-w-12 flex-1 basis-0 truncate text-muted-foreground text-xs">
          {memo}
        </span>
      </span>
    );
  }

  /** A row not saved yet has no id to act on: its controls wait, its cleared column says why. */
  function unsavedDisplay(t: Transaction, id: ColumnId): ReactNode {
    switch (id) {
      case "select":
        return <Checkbox aria-label="Saving transaction" checked={false} disabled />;
      case "review":
      case "attachment":
      case "actions":
        return null;
      case "flag": {
        const current = flags.find((f) => f.color === t.flag);
        return current ? (
          <Bookmark
            className={cn("mx-auto size-4 fill-current", FLAG_CLASS[current.color])}
            aria-label={`Flag: ${flagLabel(current)}`}
          />
        ) : null;
      }
      case "payee":
        return withMemo(
          t.memo,
          <span className="truncate">
            {rowPayee(t.accountId, t.transferAccountId, BigInt(t.amount), t.payeeName)}
          </span>,
        );
      case "cleared":
        return <PendingMark />;
      default:
        return display(t, id);
    }
  }

  function display(t: Transaction, id: ColumnId) {
    const amount = BigInt(t.amount);
    switch (id) {
      case "select":
        return (
          <Checkbox
            aria-label={`Select ${t.payeeName ?? "transaction"} on ${formatDate(t.date)}`}
            checked={isSelected(selection, t.id)}
            onClick={(e) => {
              e.preventDefault();
              toggleRow(t.id, !isSelected(selection, t.id), e.shiftKey);
            }}
          />
        );
      case "review":
        return (
          <ReviewCell
            approved={t.approved}
            needsCategory={t.needsCategory}
            pending={pendingRows.has(t.id) || remove.isPending}
            onApprove={() => void approveRow(t)}
            onReject={() => void deleteRow(t, true)}
            onCategorize={
              editableColumns(t).includes("category")
                ? () => setEditing({ id: t.id, column: "category" })
                : undefined
            }
            match={
              t.matched && (editing?.id === t.id || matchFor === t.id)
                ? {
                    onHold: (held) => setMatchFor(held ? t.id : null),
                    rows: [
                      {
                        date: formatDate(t.date),
                        payee: t.payeeName ?? "",
                        memo: t.memo,
                        amount: show(BigInt(t.amount), t.currency),
                      },
                      {
                        date: formatDate(t.matched.date),
                        payee: t.matched.payee,
                        memo: t.matched.memo,
                        amount: show(BigInt(t.matched.amount), t.currency),
                      },
                    ],
                    onUnmatch: () => {
                      setMatchFor(null);
                      void unmatchRows([t.id]);
                    },
                  }
                : undefined
            }
          />
        );
      case "flag":
        if (readOnly) {
          const current = flags.find((f) => f.color === t.flag);
          return current ? (
            <Bookmark
              className={cn("mx-auto size-4 fill-current", FLAG_CLASS[current.color])}
              aria-label={`Flag: ${flagLabel(current)}`}
            />
          ) : null;
        }
        return (
          <span className={cn("flex justify-center", !t.flag && REVEAL_ON_ROW)}>
            <FlagMenu
              value={t.flag}
              flags={flags}
              onChange={(flag) => void setFlag(t, flag)}
              onRename={renameFlags}
            />
          </span>
        );
      case "attachment":
        return (
          <span className={cn("flex justify-center", !t.attachment && REVEAL_ON_ROW)}>
            <AttachmentCell budgetId={budget.id} transaction={t} readOnly={readOnly} />
          </span>
        );
      case "account":
        return (
          <span className="flex min-w-0 items-center gap-2">
            {showLogos && <AccountMark logo={accountById.get(t.accountId)?.logo ?? null} />}
            <span className="truncate">{t.accountName}</span>
          </span>
        );
      case "date":
        return shortDate(t.date, budget.dateFormat, today);
      case "payee":
        return withMemo(
          t.memo,
          t.transferAccountId ? (
            <span className="flex min-w-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="-ml-1 shrink-0 text-muted-foreground"
                aria-label={`Go to the matching transaction in ${
                  accountById.get(t.transferAccountId)?.name ?? "the other account"
                }`}
                title="Go to the other side of this transfer"
                onClick={(e) => {
                  e.stopPropagation();
                  jumpToOtherSide(t);
                }}
              >
                <ArrowLeftRight />
              </Button>
              <span className="truncate">
                {rowPayee(t.accountId, t.transferAccountId, amount, t.payeeName)}
              </span>
            </span>
          ) : (
            t.payeeName
          ),
        );
      case "category":
        if (t.subtransactions.length > 0) {
          const expanded = Boolean(expandedSplits[t.id]);
          return (
            // The cell opens the split to edit; this shows or hides its lines.
            <button
              type="button"
              className="-mx-1.5 inline-flex h-6 max-w-[calc(100%+0.75rem)] items-center gap-1 rounded-md px-1.5 outline-none transition-colors hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-expanded={expanded}
              title={`${categoryText(t)}: ${expanded ? "hide" : "show"} its lines`}
              onClick={(e) => {
                e.stopPropagation();
                toggleSplit(t.id);
              }}
            >
              <Split className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              {/* Short enough for a narrow column; the full wording is the tooltip's. */}
              <span className="truncate" aria-hidden>
                Split · {splitCount(t)}
              </span>
              <span className="sr-only">
                {categoryText(t)}, {expanded ? "hide" : "show"} lines
              </span>
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                  expanded && "rotate-90",
                )}
                aria-hidden
              />
            </button>
          );
        }
        if (t.needsCategory) return <NeedsCategoryPill />;
        return rowCategory(t);
      case "memo":
        return t.memo;
      case "outflow":
      case "inflow": {
        // An FX revaluation has no native amount: its side is its base amount's.
        const sign = amount === 0n ? BigInt(t.baseAmount) : amount;
        if (id === "outflow" ? sign >= 0n : sign <= 0n) return "";
        return withBase(show(amount < 0n ? -amount : amount, t.currency), t);
      }
      case "amount": {
        const sign = amount === 0n ? BigInt(t.baseAmount) : amount;
        return (
          <span className={cn(sign > 0n && "text-success")}>
            {withBase(
              signedAmount(amount, (m) => show(m, t.currency)),
              t,
            )}
          </span>
        );
      }
      case "balance": {
        const balance = BigInt(t.runningBalance);
        // Quieter than the amounts beside it: it follows from them.
        return (
          <span className={cn(balance < 0n ? "text-destructive" : "text-muted-foreground")}>
            {show(balance, t.currency)}
          </span>
        );
      }
      case "enteredBy":
        // Nothing for rows nobody entered (scheduled) or from before this was recorded.
        return t.enteredBy ? (
          <MemberAvatar
            className="mx-auto"
            userId={t.enteredBy.userId}
            userName={t.enteredBy.name}
            avatarColor={t.enteredBy.avatarColor}
            removed={t.enteredBy.removed}
            picture={t.enteredBy.picture}
            currentUserId={session.data?.user.id}
            agentName={t.enteredBy.agent?.name}
            tooltipPrefix="Entered by "
            tooltipSuffix={
              t.changedBy?.name
                ? `, last changed by ${t.changedBy.agent ? agentFor(t.changedBy.agent.name, t.changedBy.name) : t.changedBy.name}`
                : ""
            }
          />
        ) : null;
      case "cleared":
        // Saved from the editor and taking a moment: the mark gives way to a spinner.
        if (pendingRows.get(t.id) === "row") {
          return (
            <span className="relative inline-flex align-middle">
              <ClearedMark
                state={t.cleared}
                className="fill-mode-forwards animate-out fade-out-0 delay-300 duration-200"
              />
              <PendingMark delayed className="absolute inset-0" />
            </span>
          );
        }
        if (readOnly || t.cleared === "reconciled") {
          const label = { cleared: "Cleared", uncleared: "Uncleared", reconciled: "Reconciled" }[
            t.cleared
          ];
          return (
            <span role="img" aria-label={label} title={label} className="inline-flex align-middle">
              <ClearedMark state={t.cleared} />
            </span>
          );
        }
        return (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="group/cleared"
            aria-label={t.cleared === "cleared" ? "Mark uncleared" : "Mark cleared"}
            title={t.cleared === "cleared" ? "Cleared" : "Uncleared"}
            onClick={() => void toggleCleared(t)}
          >
            <ClearedMark state={t.cleared} />
          </Button>
        );
      case "actions":
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Transaction actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {readOnly ? (
                <DropdownMenuItem onSelect={() => setHistoryFor(t.id)}>
                  <History /> History
                </DropdownMenuItem>
              ) : (
                <>
                  {!t.approved && (
                    <>
                      <DropdownMenuItem onSelect={() => void approveRow(t)}>
                        <Check /> Approve
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void deleteRow(t, true)}>
                        <CircleX /> Reject
                      </DropdownMenuItem>
                    </>
                  )}
                  {hasCategory(t) && !t.transferFromSplit && t.subtransactions.length === 0 && (
                    <DropdownMenuItem onSelect={() => openSplit(t, true)}>
                      <Split /> Split
                    </DropdownMenuItem>
                  )}
                  {!t.transferFromSplit && (
                    <DropdownMenuItem onSelect={() => makeRepeating(t)}>
                      <Repeat /> Make repeating
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => setHistoryFor(t.id)}>
                    <History /> History
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={t.transferFromSplit}
                    onSelect={() => handleDelete(t)}
                  >
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
    }
  }

  /** A split line, indented under its transaction. */
  function lineDisplay(t: Transaction, line: SubTransaction, id: ColumnId) {
    const amount = BigInt(line.amount);
    switch (id) {
      case "payee":
        return (
          <span className="flex min-w-0 items-center gap-1 pl-4">
            {line.transferAccountId && (
              <ArrowLeftRight className="size-3.5 shrink-0" aria-label="Transfer" />
            )}
            {withMemo(
              line.memo,
              <span className="truncate">
                {rowPayee(t.accountId, line.transferAccountId, amount, line.payeeName)}
              </span>,
            )}
          </span>
        );
      case "category": {
        const type = accountById.get(t.accountId)?.type ?? "checking";
        const to = line.transferAccountId ? accountById.get(line.transferAccountId)?.type : null;
        if (!usesCategory(type, to)) return transferCategory(t.accountId, line.transferAccountId);
        return line.needsCategory ? <NeedsCategoryPill /> : categoryName(line);
      }
      case "memo":
        return line.memo;
      case "outflow":
        return amount < 0n ? show(-amount, t.currency) : "";
      case "inflow":
        return amount > 0n ? show(amount, t.currency) : "";
      case "amount":
        return amount === 0n ? "" : signedAmount(amount, (m) => show(m, t.currency));
      default:
        return null;
    }
  }

  return (
    <CategoryBalancesContext.Provider value={describeBalance}>
      <div ref={rootRef} className="grid gap-3">
        {/* Nothing to add to, view or search until there's an account. */}
        <div className={cn("flex flex-wrap items-center gap-2", noAccounts && "hidden")}>
          {/* A phone's is a floating button, in reach wherever the list is scrolled to. */}
          {!readOnly && !phone && (
            <Button size="sm" onClick={() => startAdding()} disabled={!canAdd || adding}>
              <Plus /> Add transaction
            </Button>
          )}
          {recordPayment && canAdd && !readOnly && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => startAdding(recordPayment(), false)}
              disabled={adding}
            >
              <CreditCard /> Record payment
            </Button>
          )}
          {!readOnly && canAdd && <FileImportButton accountId={accountId} />}
          {!canAdd && account?.closed && (
            <p className="text-muted-foreground text-sm">
              Reopen this account to add transactions.
            </p>
          )}
          <div className="ml-auto flex items-center gap-1 max-md:w-full">
            {phone && !readOnly && !empty && (
              <Button
                type="button"
                variant={selecting ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={selecting}
                onClick={() => (selecting ? clearSelection() : setSelecting(true))}
              >
                {selecting ? "Done" : "Select"}
              </Button>
            )}
            {!readOnly && <UndoRedoButtons />}
            <RegisterViewMenu
              view={view}
              onChange={setView}
              runningBalance={!allAccounts}
              oldestMonth={oldestMonth}
              onResetColumns={!phone && Object.keys(widths).length > 0 ? resetWidths : undefined}
            />
            <RegisterSearchBox
              value={search.q ?? ""}
              onCommit={(text) => {
                const q = text.trim() ? text : undefined;
                saveSearch(budget.id, accountId ?? "all", q);
                onSearchChange({ q });
              }}
              // A phone's box is narrow: a name would be cut off.
              placeholder={
                phone
                  ? "Search"
                  : allAccounts
                    ? "Search all accounts"
                    : `Search ${account?.name ?? ""}`
              }
              sources={searchSources}
            />
          </div>
        </div>
        {(!isEmpty(selection) || scheduledSelection.size > 0) && (
          <SelectionBar
            summary={selectionSummary}
            total={
              selectionSummary && !mixedCurrencies
                ? signedAmount(BigInt(selectionSummary.total) + scheduledTotal, (m) =>
                    show(m, selectionCurrency ?? undefined),
                  )
                : null
            }
            allMatching={selection.mode === "all"}
            canSelectAll={
              !isEmpty(selection) &&
              (Boolean(hasNextPage) || loaded.length > (summary.data?.count ?? 0))
            }
            onSelectAll={() => setSelection({ mode: "all", except: new Set() })}
            onClear={clearSelection}
            flags={flags}
            categories={options}
            moveTargets={openAccounts.filter((a) => a.id !== accountId)}
            pending={bulk.isPending || scheduledBulk.isPending}
            onAction={requestBulk}
            onMatch={matchPair ? () => void matchSelected() : undefined}
            onUnmatch={
              unmatchable ? () => void unmatchRows(pickedRows.map((t) => t.id)) : undefined
            }
            scheduledCount={scheduledSelection.size}
            scheduledSplits={scheduledSplits(
              scheduledRows.filter((row) => scheduledSelection.has(row.id)),
            )}
            onMakeRepeating={repeatable ? () => makeRepeating(repeatable) : undefined}
            onCategorizeKey={
              singleCategory && single
                ? () => setEditing({ id: single.id, column: "category" })
                : undefined
            }
            onExport={() => {
              exportSelected(budget, selectionBody(selection, selectionFilter)).catch(() =>
                toast.error("Couldn't export the selected transactions."),
              );
            }}
          />
        )}

        <ChangeHistoryDialog
          transactionId={historyFor}
          onOpenChange={(open) => !open && setHistoryFor(null)}
        />

        <AlertDialog
          open={warning !== null}
          onOpenChange={(open) => {
            // Closing after Save/Delete is not a cancel (this runs after the action's onClick).
            if (open || !warning || proceeding.current) return;
            warning.cancel?.();
            setWarning(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{warning?.warning.title}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="grid gap-2">
                  {warning?.warning.paragraphs.map((text) => (
                    <p key={text}>{text}</p>
                  ))}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant={warning?.warning.confirm === "Delete" ? "destructive" : "default"}
                onClick={() => {
                  const proceed = warning?.proceed;
                  proceeding.current = true;
                  setWarning(null);
                  proceed?.();
                  queueMicrotask(() => {
                    proceeding.current = false;
                  });
                }}
              >
                {warning?.warning.confirm}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {empty ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">{noAccounts ? <Landmark /> : <ReceiptText />}</EmptyMedia>
              <EmptyTitle>{noAccounts ? "No accounts yet" : "No transactions yet"}</EmptyTitle>
              <EmptyDescription>
                {noAccounts
                  ? readOnly
                    ? "Transactions show up here once the budget has an account."
                    : "Add a checking, savings or credit card account to start recording transactions."
                  : canAdd && !readOnly
                    ? "Add one to start tracking where your money goes."
                    : "Transactions show up here once they're added."}
              </EmptyDescription>
            </EmptyHeader>
            {!readOnly && (noAccounts || canAdd) && (
              <EmptyContent>
                {noAccounts ? (
                  <Button size="sm" onClick={() => setAddingAccount(true)}>
                    <Plus /> Add account
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => startAdding()}>
                    <Plus /> Add transaction
                  </Button>
                )}
              </EmptyContent>
            )}
          </Empty>
        ) : phone ? (
          <PhoneTransactions
            allAccounts={allAccounts}
            today={today}
            byDay={dateOrder}
            newestFirst={view.sort[0]?.dir !== "asc"}
            balances={!allAccounts && view.showRunningBalance}
            payee={(t) => rowPayee(t.accountId, t.transferAccountId, BigInt(t.amount), t.payeeName)}
            rows={loaded}
            pending={pendingRows}
            selecting={
              !readOnly && (selecting || !isEmpty(selection) || scheduledSelection.size > 0)
            }
            onStartSelecting={
              readOnly
                ? undefined
                : (pick) => {
                    setSelecting(true);
                    if (pick.kind === "scheduled") toggleScheduled(pick.id, true, false);
                    else toggleRow(pick.id, true, false);
                  }
            }
            scheduled={scheduledRows}
            scheduledSelected={scheduledSelection}
            onSelectScheduled={(id) => toggleScheduled(id, !scheduledSelection.has(id), false)}
            isSelected={(id) => isSelected(selection, id)}
            onSelect={(t) => toggleRow(t.id, !isSelected(selection, t.id), false)}
            onOpen={(t) => {
              if (!readOnly && !t.transferFromSplit && !isPendingId(t.id)) openSplit(t);
            }}
            onToggleCleared={readOnly ? undefined : (t) => void toggleCleared(t)}
            show={(amount, currency) => show(amount, currency ?? undefined)}
            formatDate={formatDate}
            category={(t) => categoryText(t, true)}
            flags={flags}
            highlightId={highlight?.id ?? null}
            hasMore={Boolean(hasNextPage)}
            loadingMore={isFetchingNextPage}
            onLoadMore={() => void fetchNextPage()}
          />
        ) : (
          // The shared Table's tray, as the scroll area so the header stays on it: an overlay
          // scrollbar inside the rounded frame, instead of a native one that takes a strip beside
          // the header and squares off its corner.
          <ScrollArea
            viewportRef={viewportRef}
            // A query container: the editor's footer sizes to its visible width. The scroll padding
            // keeps a focused field clear of the sticky header and the pinned columns, should the
            // table ever be wider than the register.
            viewportClassName="@container scroll-pt-9"
            viewportProps={{
              style: {
                maxHeight: fillHeight ?? "70vh",
                scrollPaddingRight: pinnedWidth(columnIds),
              },
            }}
            // The scrollbar shows whenever the rows overflow, not only on hover.
            type="auto"
            scrollbars="both"
            className={cn("rounded-xl ring-1 ring-border", REGISTER_TRAY)}
          >
            <Table
              // The ScrollArea is the tray; the container keeps only its padding. Rows and cells
              // come from register-table.
              containerClassName="overflow-visible rounded-none bg-transparent ring-0 dark:bg-transparent"
              className="table-fixed"
              // layoutColumns fits the columns to the register; only past its narrowest layout does
              // the table scroll sideways, Cleared and Actions staying pinned.
              style={{ minWidth: layout.minWidth }}
              data-overflowing={
                (registerWidth !== null && layout.minWidth > registerWidth) || undefined
              }
            >
              <colgroup>
                {columnIds.map((id) => (
                  <col key={id} style={{ width: layout.widths[id] }} />
                ))}
              </colgroup>
              <TableHeader className="sticky top-0 z-10">
                {table.getHeaderGroups().map((group) => (
                  <RegisterRow key={group.id} still>
                    {group.headers.map((header) => {
                      const id = header.column.id as ColumnId;
                      const spec = COLUMN_SPECS[id];
                      const sortBy = SORTABLE[id];
                      // The arrow shows on the first sort field; the rest break its ties.
                      const active =
                        sortBy !== undefined &&
                        (sortBy === sort || (id === "amount" && sort === "inflow"));
                      const HeaderIcon =
                        id === "flag"
                          ? Bookmark
                          : id === "attachment"
                            ? ImageIcon
                            : id === "cleared"
                              ? CircleCheck
                              : null;
                      const resizable = RESIZABLE.includes(id) && HeaderIcon === null;
                      const pin = pinned(columnIds, id);
                      return (
                        <RegisterHead
                          key={header.id}
                          aria-sort={
                            active ? (dir === "asc" ? "ascending" : "descending") : undefined
                          }
                          style={pin?.style}
                          className={cn(
                            cn("font-medium text-[13px] text-muted-foreground", REGISTER_TRAY),
                            // A clear 1px at the bottom: the rows' card starts just under the
                            // header, and its top edge and corners would otherwise sit beneath it.
                            "border-b border-transparent bg-clip-padding",
                            resizable && "relative",
                            pin && [pin.className, PINNED_BG.head],
                            spec.align === "right" && "text-right",
                            // Centred like the column's cells (the flag and cleared icons).
                            spec.align === "center" && "text-center",
                          )}
                        >
                          {id === "select" ? (
                            <Checkbox
                              aria-label={
                                selection.mode === "all" ? "Unselect all" : "Select all matching"
                              }
                              checked={
                                selection.mode === "all"
                                  ? selection.except.size === 0 || "indeterminate"
                                  : (selection.ids.size > 0 || scheduledSelection.size > 0) &&
                                    "indeterminate"
                              }
                              disabled={loaded.length === 0 && scheduledRows.length === 0}
                              onCheckedChange={() => {
                                // Select all takes the scheduled rows along.
                                if (selection.mode === "all") return clearSelection();
                                setSelection({ mode: "all", except: new Set() });
                                setScheduledSelection(new Set(scheduledRows.map((row) => row.id)));
                              }}
                            />
                          ) : id === "balance" ? (
                            <BalanceHeader
                              sorted={!dateOrder}
                              onResetSort={() => setView({ sort: [...DEFAULT_SORT] })}
                            />
                          ) : sortBy ? (
                            <button
                              type="button"
                              className={cn(
                                // Middle-aligned, so an icon-only header sits level with the words.
                                "inline-flex items-center gap-1 align-middle hover:text-foreground",
                                active && "text-foreground",
                              )}
                              onClick={() => setView({ sort: nextSort(view.sort, sortBy) })}
                            >
                              {HeaderIcon ? (
                                <>
                                  <HeaderIcon className="size-3.5" aria-hidden />
                                  <span className="sr-only">{spec.header}</span>
                                </>
                              ) : (
                                spec.header
                              )}
                              {active &&
                                (dir === "asc" ? (
                                  <ArrowUp className="size-3" aria-hidden />
                                ) : (
                                  <ArrowDown className="size-3" aria-hidden />
                                ))}
                            </button>
                          ) : HeaderIcon ? (
                            <span className="inline-flex align-middle">
                              <HeaderIcon className="size-3.5" aria-hidden />
                              <span className="sr-only">{spec.header}</span>
                            </span>
                          ) : (
                            <span className={cn(spec.srOnly && "sr-only")}>{spec.header}</span>
                          )}
                          {resizable && (
                            <ColumnResizer
                              label={spec.header}
                              width={layout.widths[id] ?? 0}
                              onWidth={(px) => setWidth(id, px)}
                            />
                          )}
                        </RegisterHead>
                      );
                    })}
                  </RegisterRow>
                ))}
              </TableHeader>
              <RegisterBody ref={measureScheduled}>
                {adding && defaultAccountId && (
                  <TransactionEditor
                    transferCategory={transferCategory}
                    key={addingKey}
                    initial={addingDraft ?? newDraft(defaultAccountId, today)}
                    openDatePicker={addingPicker}
                    repeat
                    columns={columnIds}
                    accounts={openAccounts}
                    payees={payeeList}
                    categories={options}
                    dateFormat={budget.dateFormat}
                    settings={budget}
                    flags={flags}
                    onRenameFlags={renameFlags}
                    pending={false}
                    error={newError}
                    onSave={(draft, file) => void saveNew(draft, false, file)}
                    onSaveAndAddAnother={(draft, file) => void saveNew(draft, true, file)}
                    onCancel={() => setAdding(false)}
                    newAttachment={newAttachment}
                  />
                )}
                <ScheduledSection
                  rows={scheduledRows}
                  selected={scheduledSelection}
                  onSelect={toggleScheduled}
                  sole={
                    isEmpty(selection) && scheduledSelection.size === 1
                      ? ([...scheduledSelection][0] ?? null)
                      : null
                  }
                  onSelectOnly={(id) => selectOnly(id, true)}
                  columns={columnIds}
                  accountCompact={layout.accountCompact}
                  collapsed={view.scheduledCollapsed}
                  onToggle={() => setView({ scheduledCollapsed: !view.scheduledCollapsed })}
                  accounts={accountList}
                  payees={payeeList}
                  categories={options}
                  flags={flags}
                  onRenameFlags={renameFlags}
                  today={today}
                  onChanged={refresh}
                />
              </RegisterBody>
              <RegisterBody>
                {paddingTop > 0 && <tr aria-hidden style={{ height: paddingTop }} />}
                {items.map((item) => {
                  const row = flat[item.index];
                  if (!row) return null;
                  const t = row.t;
                  const future = t.date > today;
                  if (editingSplit?.id === t.id) {
                    if (row.kind === "line") return null;
                    return (
                      <TransactionEditor
                        transferCategory={transferCategory}
                        key={t.id}
                        initial={editingSplit.draft}
                        focusMemo={editingSplit.fromKey}
                        focusSplit={editingSplit.splitting}
                        focusCell={editingSplit.focus}
                        label="Edit transaction"
                        columns={columnIds}
                        attachment={
                          <AttachmentCell
                            budgetId={budget.id}
                            transaction={t}
                            readOnly={readOnly}
                          />
                        }
                        accounts={editorAccounts(accountList, t.accountId)}
                        accountChoices={movableAccounts(accountList, t)}
                        payees={payeeList}
                        categories={options}
                        dateFormat={budget.dateFormat}
                        settings={budget}
                        flags={flags}
                        onRenameFlags={renameFlags}
                        pending={false}
                        error={splitError}
                        onSave={(draft) => void saveSplit(t, draft)}
                        onCancel={() => setEditingSplit(null)}
                      />
                    );
                  }
                  if (row.kind === "line") {
                    return (
                      <RegisterRow
                        key={row.key}
                        data-index={item.index}
                        ref={virtualizer.measureElement}
                        data-state={isSelected(selection, t.id) ? "selected" : undefined}
                        data-sole={single?.id === t.id || undefined}
                        aria-label={`Split line of ${t.payeeName ?? "transaction"}`}
                        className={cn("text-muted-foreground text-xs", future && "italic")}
                      >
                        {columnIds.map((id) => {
                          const spec = COLUMN_SPECS[id];
                          const pin = pinned(columnIds, id);
                          return (
                            <RegisterCell
                              key={id}
                              title={
                                id === "memo" || (id === "payee" && layout.memoInPayee)
                                  ? row.line.memo || undefined
                                  : id === "category"
                                    ? (row.line.categoryName ?? undefined)
                                    : undefined
                              }
                              style={pin?.style}
                              className={cn(
                                "truncate py-1.5",
                                pin && [pin.className, PINNED_BG.row],
                                spec.align === "right" && "text-right tabular-nums",
                                isEditable(id) && !readOnly && SOLE_ROW_EDITS,
                              )}
                              onClick={(e) =>
                                clickRow(
                                  e,
                                  t.id,
                                  isEditable(id)
                                    ? (target) =>
                                        openSplit(t, false, false, {
                                          column: clickedColumn(id, target),
                                          line: t.subtransactions.indexOf(row.line),
                                        })
                                    : undefined,
                                )
                              }
                            >
                              {lineDisplay(t, row.line, id)}
                            </RegisterCell>
                          );
                        })}
                      </RegisterRow>
                    );
                  }
                  const unsaved = isPendingId(t.id);
                  const editable = unsaved ? [] : editableColumns(t);
                  return (
                    <RegisterRow
                      key={t.id}
                      data-index={item.index}
                      ref={virtualizer.measureElement}
                      data-transaction-id={t.id}
                      data-highlighted={highlight?.id === t.id ? highlight.kind : undefined}
                      data-state={isSelected(selection, t.id) ? "selected" : undefined}
                      data-sole={single?.id === t.id || undefined}
                      data-pending={pendingRows.get(t.id)}
                      aria-busy={pendingRows.has(t.id) || undefined}
                      className={cn(
                        // One height for every row, so an icon or an open editor doesn't grow it;
                        // taller for a finger.
                        "h-9 pointer-coarse:h-11",
                        // A quick hover; a row jumped to glows, then fades out, and one just saved
                        // flashes.
                        "duration-100 data-[highlighted=jump]:animate-[row-highlight_2.5s_ease-out] data-[highlighted=saved]:animate-[row-highlight_0.9s_ease-out]",
                        // Saving: a new row reads quieter at once, an edit only if it takes a moment.
                        PENDING_ROW,
                        future && "text-muted-foreground italic",
                        !t.approved && "font-semibold",
                      )}
                      title={future ? "Upcoming: not in the balance until its date" : undefined}
                    >
                      {columnIds.map((id) => {
                        const spec = COLUMN_SPECS[id];
                        const pin = pinned(columnIds, id);
                        if (editing?.id === t.id && columnOf(editing.column) === id) {
                          return (
                            <RegisterCell
                              key={id}
                              className={cn(
                                EDITOR_CELL,
                                IN_ROW_EDITOR,
                                "py-1",
                                id === "date" && DATE_EDITOR_FIT,
                              )}
                            >
                              <CellEditor
                                transaction={t}
                                column={editing.column}
                                settings={inCurrency(budget, t.currency)}
                                dateFormat={budget.dateFormat}
                                accounts={movableAccounts(accountList, t)}
                                payees={payeeList}
                                transfers={transferTargets(t)}
                                categories={options}
                                onSplit={
                                  !t.transferFromSplit && !t.transferAccountId
                                    ? () => openSplit(t, true)
                                    : undefined
                                }
                                onMakeRepeating={
                                  t.transferFromSplit ? undefined : () => makeRepeating(t)
                                }
                                onCommit={(value, exit, transferAccountId) =>
                                  void commitCell(t, editing.column, value, exit, transferAccountId)
                                }
                                onCancel={() => setEditing(null)}
                                onDontRename={() => void dontRename(t)}
                              />
                            </RegisterCell>
                          );
                        }
                        const cell = id === "amount" ? amountSide(t) : id;
                        const canEdit = (editable as ColumnId[]).includes(cell);
                        return (
                          <RegisterCell
                            key={id}
                            title={cellTitle(t, id)}
                            style={pin?.style}
                            className={cn(
                              // The row sets the height; cells only centre their content.
                              "truncate py-0",
                              pin && [pin.className, PINNED_BG.row],
                              spec.align === "right" && "text-right tabular-nums",
                              spec.align === "center" && "text-center",
                              ICON_CELL[id],
                              (id === "category" || id === "memo") && "text-muted-foreground",
                              canEdit && SOLE_ROW_EDITS,
                            )}
                            onClick={(e) => {
                              // The checkbox's cell ticks the row, the box or around it.
                              if (id === "select") {
                                if (unsaved || readOnly) return;
                                const box =
                                  e.target instanceof Element &&
                                  e.target.closest("[role=checkbox]");
                                if (!box) toggleRow(t.id, !isSelected(selection, t.id), e.shiftKey);
                                return;
                              }
                              clickRow(
                                e,
                                t.id,
                                canEdit || (id === "payee" && editable.includes("memo"))
                                  ? (target) => {
                                      // A split opens whole, in the field that was clicked.
                                      if (t.subtransactions.length > 0) {
                                        return openSplit(t, false, false, {
                                          column: clickedColumn(id, target),
                                        });
                                      }
                                      // The memo shown after the payee edits the memo.
                                      const memo =
                                        id === "payee" && target.closest("[data-memo]") !== null;
                                      setEditing({
                                        id: t.id,
                                        column: memo || !canEdit ? "memo" : (cell as CellColumn),
                                      });
                                    }
                                  : undefined,
                              );
                            }}
                          >
                            {unsaved ? unsavedDisplay(t, id) : display(t, id)}
                          </RegisterCell>
                        );
                      })}
                    </RegisterRow>
                  );
                })}
                {paddingBottom > 0 && <tr aria-hidden style={{ height: paddingBottom }} />}
              </RegisterBody>
            </Table>
          </ScrollArea>
        )}
        {phone &&
          !readOnly &&
          !empty &&
          canAdd &&
          !selecting &&
          isEmpty(selection) &&
          scheduledSelection.size === 0 && (
            // Above the bottom tabs, where the selection bar goes while rows are ticked.
            <Button
              size="icon"
              className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 size-14 rounded-full shadow-lg duration-200 animate-in fade-in-0 zoom-in-90 md:bottom-6 [&_svg:not([class*='size-'])]:size-6"
              aria-label="Add transaction"
              disabled={adding}
              onClick={() => startAdding()}
            >
              <Plus />
            </Button>
          )}
        {phone && defaultAccountId && (
          // A phone adds and edits in a full-height drawer.
          <Drawer
            open={adding || editingSplit !== null}
            onOpenChange={(open) => {
              if (open) return;
              setAdding(false);
              setEditingSplit(null);
            }}
          >
            <DrawerContent className="data-[vaul-drawer-direction=bottom]:max-h-[96svh]">
              <DrawerHeader className="text-left">
                <DrawerTitle>{adding ? "New transaction" : "Edit transaction"}</DrawerTitle>
                <DrawerDescription className="sr-only">
                  The transaction's date, payee, category, memo and amount.
                </DrawerDescription>
              </DrawerHeader>
              {/* The editor's own footer holds the home indicator's inset, so it sits at the bottom. */}
              <div className="mx-auto w-full max-w-xl overflow-y-auto px-4">
                {adding ? (
                  <TransactionEditor
                    layout="stacked"
                    transferCategory={transferCategory}
                    key={addingKey}
                    initial={addingDraft ?? newDraft(defaultAccountId, today)}
                    repeat
                    focusAmount
                    recentPayees={recentPayees}
                    columns={columnIds}
                    accounts={openAccounts}
                    payees={payeeList}
                    categories={options}
                    dateFormat={budget.dateFormat}
                    settings={budget}
                    flags={flags}
                    onRenameFlags={renameFlags}
                    pending={false}
                    error={newError}
                    onSave={(draft, file) => void saveNew(draft, false, file)}
                    onCancel={() => setAdding(false)}
                    newAttachment={newAttachment}
                  />
                ) : (
                  editingTransaction &&
                  editingSplit && (
                    <TransactionEditor
                      layout="stacked"
                      transferCategory={transferCategory}
                      key={editingTransaction.id}
                      initial={editingSplit.draft}
                      focusSplit={editingSplit.splitting}
                      label="Edit transaction"
                      columns={columnIds}
                      accounts={editorAccounts(accountList, editingTransaction.accountId)}
                      accountChoices={movableAccounts(accountList, editingTransaction)}
                      payees={payeeList}
                      categories={options}
                      dateFormat={budget.dateFormat}
                      settings={budget}
                      flags={flags}
                      onRenameFlags={renameFlags}
                      pending={false}
                      error={splitError}
                      onSave={(draft) => void saveSplit(editingTransaction, draft)}
                      onCancel={() => setEditingSplit(null)}
                      attachment={
                        <AttachmentField
                          budgetId={budget.id}
                          transaction={editingTransaction}
                          readOnly={readOnly}
                        />
                      }
                      onDelete={() => {
                        setEditingSplit(null);
                        void handleDelete(editingTransaction);
                      }}
                    />
                  )
                )}
              </div>
            </DrawerContent>
          </Drawer>
        )}

        {isFetchingNextPage && (
          <p className="text-muted-foreground text-xs" aria-live="polite">
            Loading more…
          </p>
        )}
        {someHidden && (
          <div className="grid justify-items-center gap-2 py-2 text-sm">
            <p className="text-muted-foreground">
              {q ? (
                <>
                  Some transactions are hidden by your search for "
                  <strong className="text-foreground">{q}</strong>".
                </>
              ) : (
                "Some transactions are hidden by filters."
              )}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setView({ range: "all", from: undefined, to: undefined, showReconciled: true });
                onSearchChange({ q: undefined });
              }}
            >
              View All
            </Button>
          </div>
        )}
        {addingAccount && <AddAccountDialog budget={budget} open onOpenChange={setAddingAccount} />}
      </div>
    </CategoryBalancesContext.Provider>
  );
}

/** Whether the register is sorted by date first (the default). */
function dateFirst(sort: readonly SortField[]) {
  return (sort[0] ?? DEFAULT_SORT[0])?.column === "date";
}

/**
 * The running balance is always in date order. Sorted by anything else, the column stays
 * and explains: clicking it goes back to the default order.
 */
function BalanceHeader({ sorted, onResetSort }: { sorted: boolean; onResetSort: () => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        className="hover:text-foreground"
        title="Sort by date (the balance's order)"
        onClick={onResetSort}
      >
        Balance
      </button>
      {sorted && (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" aria-label="About the balance" className="hover:text-foreground">
              <CircleHelp className="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 text-sm normal-case">
            Click the column header to return to the default balance sort order.
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}

/** Accounts a transaction can move to: open ones, plus the one it's in. */
function editorAccounts(accounts: readonly Account[], current: string) {
  return accounts.filter((a) => !a.closed || a.id === current);
}

/**
 * A header cell's right edge, dragged to widen or narrow its column (Memo,
 * which takes what's left, gives or takes the difference). Arrow keys move it 8px.
 * Hand-rolled: the register is a plain table with a colgroup, not a table library's columns.
 */
function ColumnResizer({
  label,
  width,
  onWidth,
}: {
  label: string;
  /** The column's width in pixels, for screen readers. */
  width: number;
  onWidth: (px: number) => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const cellWidth = (el: HTMLElement) => el.closest("th")?.getBoundingClientRect().width ?? 0;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable splitter has no element of its own
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      aria-valuenow={Math.round(width)}
      aria-valuemin={MIN_COLUMN_PX}
      tabIndex={0}
      // Shown on the header's hover, so the columns read as resizable; stronger under the pointer.
      className="absolute inset-y-1.5 right-0 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:right-0 after:w-px after:rounded-full after:bg-transparent after:transition-colors group-hover/row:after:bg-border hover:after:w-0.5 hover:after:bg-foreground/40 focus-visible:after:w-0.5 focus-visible:after:bg-ring"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, width: cellWidth(e.currentTarget) };
      }}
      onPointerMove={(e) => {
        if (!start.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
        onWidth(start.current.width + e.clientX - start.current.x);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        start.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        onWidth(cellWidth(e.currentTarget) + (e.key === "ArrowRight" ? 8 : -8));
      }}
    />
  );
}

/** How long a press on a card takes to start selecting. */
const LONG_PRESS_MS = 450;

/**
 * A long press on a card: starts selecting (and ticks the card), and swallows the click that ends
 * it. Hand-rolled: a timer and a few pointer events, not worth a dependency. A drag (a scroll)
 * cancels it.
 */
function useLongPress(onLongPress: ((id: string) => void) | undefined) {
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  return (id: string) =>
    onLongPress
      ? {
          onPointerDown: (e: React.PointerEvent) => {
            if (e.button !== 0) return;
            fired.current = false;
            cancel();
            press.current = {
              x: e.clientX,
              y: e.clientY,
              timer: window.setTimeout(() => {
                press.current = null;
                fired.current = true;
                navigator.vibrate?.(10);
                onLongPress(id);
              }, LONG_PRESS_MS),
            };
          },
          onPointerMove: (e: React.PointerEvent) => {
            const start = press.current;
            if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancel();
          },
          onPointerUp: cancel,
          onPointerCancel: cancel,
          onPointerLeave: cancel,
          // The press shouldn't also open the browser's menu for the card.
          onContextMenu: (e: React.MouseEvent) => {
            if (fired.current || press.current) e.preventDefault();
          },
          /** True once: the click that ends a long press isn't a tap. */
          consumeLongPress: () => {
            const was = fired.current;
            fired.current = false;
            return was;
          },
        }
      : null;
}

/**
 * A phone's register: each transaction a card, a thumb's height or more, with its payee and
 * amount on top and its date, category and memo under them. The amounts sit in a column of their
 * own, so they end at one edge whatever the payee's length or the row's status. A tap opens it in
 * the drawer. Checkboxes show only while selecting (a long press on a card, or the toolbar's
 * Select), when a tap ticks the card instead. Upcoming scheduled transactions come first, as on
 * the wide register.
 */
function PhoneTransactions({
  rows,
  pending,
  selecting,
  onStartSelecting,
  scheduled,
  scheduledSelected,
  onSelectScheduled,
  isSelected,
  onSelect,
  onOpen,
  onToggleCleared,
  show,
  formatDate,
  category,
  flags,
  highlightId,
  hasMore,
  loadingMore,
  onLoadMore,
  allAccounts,
  today,
  byDay,
  newestFirst,
  balances,
  payee,
}: {
  /** All Accounts: each card names its account. */
  allAccounts: boolean;
  today: string;
  /** Sorted by date: the cards come under a heading for each day, without a date of their own. */
  byDay: boolean;
  /** The days run newest first. */
  newestFirst: boolean;
  /** Each day's heading ends with the account's balance at the end of it. */
  balances: boolean;
  /** The row's payee as the wide register words it ("Payment: Visa Card" for a transfer). */
  payee: (t: Transaction) => string | null;
  rows: readonly Transaction[];
  /** Cards whose save hasn't come back. */
  pending: ReadonlyMap<string, PendingKind>;
  /** Checkboxes show, and a tap ticks a card. */
  selecting: boolean;
  /** A long press: start selecting with that card ticked. */
  onStartSelecting?: (pick: { kind: "transaction" | "scheduled"; id: string }) => void;
  scheduled: readonly ScheduledTransaction[];
  scheduledSelected: ReadonlySet<string>;
  onSelectScheduled: (id: string) => void;
  isSelected: (id: string) => boolean;
  onSelect: (t: Transaction) => void;
  onOpen: (t: Transaction) => void;
  onToggleCleared?: (t: Transaction) => void;
  show: (amount: bigint, currency: string | null) => string;
  formatDate: (iso: string) => string;
  /** The row's category in a few words ("Split (2)"), or "" where it needs none. */
  category: (t: Transaction) => string;
  flags: readonly Flag[];
  /** A card that flashes: just saved, or jumped to. */
  highlightId: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const card =
    "flex items-center gap-3 border-b py-2 pr-1 pl-3 last:border-b-0 select-none [-webkit-touch-callout:none]";
  /** Payee and amount on one line, the summary under them; the amount in its own right column. */
  const lines = "grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5";
  const meta = "col-span-2 truncate text-muted-foreground text-xs";
  const checkbox = "size-5 animate-in fade-in-0 zoom-in-75 duration-150 motion-reduce:animate-none";
  const signed = (amount: bigint, currency: string | null) =>
    signedAmount(amount, (m) => show(m, currency));
  const pressTransaction = useLongPress(
    onStartSelecting ? (id) => onStartSelecting({ kind: "transaction", id }) : undefined,
  );
  const pressScheduled = useLongPress(
    onStartSelecting ? (id) => onStartSelecting({ kind: "scheduled", id }) : undefined,
  );
  // One list a day when sorted by date (one list for everything otherwise).
  const days: { date: string | null; rows: Transaction[] }[] = [];
  for (const t of rows) {
    const last = days.at(-1);
    if (byDay && last?.date === t.date) last.rows.push(t);
    else if (!byDay && last) last.rows.push(t);
    else days.push({ date: byDay ? t.date : null, rows: [t] });
  }
  /** The balance once the day's last transaction is in (the running balance is in date order). */
  const endOfDay = (dayRows: readonly Transaction[]) => {
    const saved = dayRows.filter((t) => pending.get(t.id) !== "new");
    const last = newestFirst ? saved[0] : saved.at(-1);
    return last ? show(BigInt(last.runningBalance), last.currency) : null;
  };
  return (
    // Room at the end for the floating Add button.
    <div className="grid gap-4 pb-16">
      {scheduled.length > 0 && (
        <section aria-label="Upcoming" className="overflow-hidden rounded-lg border bg-muted/30">
          <h2 className="border-b px-3 py-2 font-medium text-muted-foreground text-xs">Upcoming</h2>
          <ul>
            {scheduled.map((row) => {
              const amount = BigInt(row.amount);
              const { consumeLongPress, ...press } = pressScheduled(row.id) ?? {
                consumeLongPress: () => false,
              };
              const summary = (
                <>
                  <span className="truncate font-medium">{row.payeeName ?? "No payee"}</span>
                  <span
                    className={cn(
                      "text-right font-medium tabular-nums",
                      amount > 0n && "text-success",
                    )}
                  >
                    {signed(amount, row.currency)}
                  </span>
                  <span className={meta}>
                    {[
                      formatDate(row.dateNext),
                      allAccounts && row.accountName,
                      row.subtransactions.length > 0
                        ? `Split (${row.subtransactions.length})`
                        : row.categoryName,
                      row.memo,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </>
              );
              return (
                <li
                  key={row.id}
                  data-state={scheduledSelected.has(row.id) ? "selected" : undefined}
                  className={cn(card, SELECTED_CARD)}
                  {...press}
                >
                  {selecting && (
                    <Checkbox
                      className={checkbox}
                      aria-label={`Select ${row.payeeName ?? "scheduled transaction"} on ${formatDate(row.dateNext)}`}
                      checked={scheduledSelected.has(row.id)}
                      onCheckedChange={() => onSelectScheduled(row.id)}
                    />
                  )}
                  {selecting ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-hidden
                      className={cn(lines, "min-h-11 content-center text-left outline-none")}
                      onClick={() => {
                        if (!consumeLongPress()) onSelectScheduled(row.id);
                      }}
                    >
                      {summary}
                    </button>
                  ) : (
                    <div className={cn(lines, "min-h-11 content-center")}>{summary}</div>
                  )}
                  {/* The cleared column's place: scheduled rows have no cleared state yet. */}
                  <span className="size-11 shrink-0" aria-hidden />
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {rows.length === 0 && (
        <p className="rounded-lg border px-3 py-6 text-center text-muted-foreground text-sm">
          No transactions
        </p>
      )}
      {days.map((day) => {
        const heading = day.date ? dayHeading(day.date, today) : null;
        const balance = day.date && balances ? endOfDay(day.rows) : null;
        return (
          <section
            key={day.date ?? "all"}
            aria-label={heading ?? "Transactions"}
            className="grid gap-1.5"
          >
            {heading && (
              <h2 className="flex items-baseline justify-between gap-3 px-1 text-xs">
                <span className="font-medium text-foreground">{heading}</span>
                {balance && (
                  <span
                    className="text-muted-foreground tabular-nums"
                    title="Balance at the end of the day"
                  >
                    <span className="sr-only">Balance at the end of the day: </span>
                    {balance}
                  </span>
                )}
              </h2>
            )}
            <ul className="overflow-hidden rounded-lg border bg-card">
              {day.rows.map((t) => {
                const amount = BigInt(t.amount);
                const flag = flags.find((f) => f.color === t.flag);
                const future = t.date > todayIso();
                const state = pending.get(t.id);
                const unsaved = state === "new";
                const { consumeLongPress, ...press } = (!unsaved && pressTransaction(t.id)) || {
                  consumeLongPress: () => false,
                };
                return (
                  <li
                    key={t.id}
                    data-transaction-id={t.id}
                    data-state={isSelected(t.id) ? "selected" : undefined}
                    data-highlighted={highlightId === t.id || undefined}
                    data-pending={state}
                    aria-busy={state ? true : undefined}
                    className={cn(
                      card,
                      "data-highlighted:animate-[row-highlight_0.9s_ease-out]",
                      SELECTED_CARD,
                      "transition-colors data-pending:text-muted-foreground data-[pending=cell]:delay-300 data-[pending=row]:delay-300",
                    )}
                    {...press}
                  >
                    {selecting && (
                      <Checkbox
                        className={checkbox}
                        aria-label={`Select ${t.payeeName ?? "transaction"} on ${formatDate(t.date)}`}
                        checked={isSelected(t.id)}
                        disabled={unsaved}
                        onCheckedChange={() => onSelect(t)}
                      />
                    )}
                    <button
                      type="button"
                      disabled={unsaved}
                      className={cn(
                        lines,
                        "min-h-11 content-center text-left outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring",
                        future && "text-muted-foreground italic",
                      )}
                      onClick={() => {
                        if (consumeLongPress()) return;
                        if (selecting) onSelect(t);
                        else onOpen(t);
                      }}
                    >
                      <span
                        className={cn(
                          "flex min-w-0 items-center gap-1 font-medium",
                          !t.approved && "font-semibold",
                        )}
                      >
                        {flag && (
                          <Bookmark
                            className={cn("size-3.5 shrink-0 fill-current", FLAG_CLASS[flag.color])}
                            aria-label={`Flag: ${flagLabel(flag)}`}
                          />
                        )}
                        <span className="truncate">{payee(t) ?? "No payee"}</span>
                        {t.attachment && (
                          <Paperclip
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-label="Has an attachment"
                          />
                        )}
                      </span>
                      <span
                        className={cn(
                          "text-right font-medium tabular-nums",
                          amount > 0n && "text-success",
                        )}
                      >
                        {signed(amount, t.currency)}
                      </span>
                      <span className={meta}>
                        {[
                          !byDay && formatDate(t.date),
                          allAccounts && t.accountName,
                          category(t),
                          t.memo,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {!t.approved && (
                        <span className="col-span-2 text-primary-text text-xs">Needs approval</span>
                      )}
                    </button>
                    {unsaved || state === "row" ? (
                      <span className="flex size-11 shrink-0 items-center justify-center">
                        <PendingMark delayed={!unsaved} />
                      </span>
                    ) : onToggleCleared && t.cleared !== "reconciled" ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="group/cleared size-11 shrink-0"
                        aria-label={t.cleared === "cleared" ? "Cleared" : "Uncleared"}
                        aria-pressed={t.cleared === "cleared"}
                        onClick={() => onToggleCleared(t)}
                      >
                        <ClearedMark state={t.cleared} />
                      </Button>
                    ) : (
                      <span
                        className="flex size-11 shrink-0 items-center justify-center"
                        role="img"
                        aria-label={
                          { cleared: "Cleared", uncleared: "Uncleared", reconciled: "Reconciled" }[
                            t.cleared
                          ]
                        }
                      >
                        <ClearedMark state={t.cleared} />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {hasMore && (
        <Button variant="outline" className="min-h-11" disabled={loadingMore} onClick={onLoadMore}>
          {loadingMore ? "Loading…" : "Show more"}
        </Button>
      )}
    </div>
  );
}
