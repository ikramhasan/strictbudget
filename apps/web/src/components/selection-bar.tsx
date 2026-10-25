import type { components } from "@strictbudget/api-client";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@strictbudget/ui/components/dropdown-menu";
import { Input } from "@strictbudget/ui/components/input";
import { Kbd } from "@strictbudget/ui/components/kbd";
import { Label } from "@strictbudget/ui/components/label";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@strictbudget/ui/components/popover";
import { cn } from "@strictbudget/ui/lib/utils";
import {
  ArrowRightLeft,
  Bookmark,
  CalendarClock,
  Check,
  Circle,
  CircleCheck,
  CircleX,
  Copy,
  FileDown,
  Link2,
  MoreHorizontal,
  NotebookPen,
  Repeat,
  Tag,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { FLAG_CLASS, type Flag, type FlagColor, flagLabel } from "@/lib/flags";
import { menuKeyDown } from "@/lib/menu-keys";
import { useShortcut } from "@/lib/shortcuts";
import { type CategoryOption, categoryLabel } from "@/lib/transactions";

export type BulkAction =
  | { type: "cleared"; cleared: "cleared" | "uncleared" }
  | { type: "flag"; flag: FlagColor | null }
  | { type: "categorize"; categoryId: string }
  | { type: "memo"; memo: string }
  | { type: "move"; accountId: string }
  | { type: "delete" }
  | { type: "duplicate" }
  | { type: "approve" }
  | { type: "reject" }
  /** Scheduled rows only. */
  | { type: "enterNow" };

type Summary = components["schemas"]["SelectionSummary"];

const NO_SPLITS = { splits: 0, splitsWithTransfers: 0 };

const FLAG_ITEM =
  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Each action is offered only when it applies to the selection. With unapproved rows selected,
 * Flag and the cleared states move into More. Enter Now shows when only scheduled rows are
 * selected, and Make Repeating when one plain transaction is.
 */
export function SelectionBar({
  summary,
  total,
  allMatching,
  canSelectAll,
  onSelectAll,
  onClear,
  flags,
  categories,
  moveTargets,
  pending,
  onAction,
  scheduledCount = 0,
  scheduledSplits = NO_SPLITS,
  onMakeRepeating,
  onMatch,
  onUnmatch,
  onExport,
  onCategorizeKey,
}: {
  /** Undefined while it loads. */
  summary: Summary | undefined;
  total: string | null;
  allMatching: boolean;
  /** Offer "Select all matching" (there are rows beyond the ticked ones). */
  canSelectAll: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  flags: readonly Flag[];
  categories: readonly CategoryOption[];
  /** Accounts the selection can move to: the budget's other open accounts. */
  moveTargets: readonly { id: string; name: string }[];
  pending: boolean;
  onAction: (action: BulkAction) => void;
  scheduledCount?: number;
  /** The selected scheduled splits (see `scheduledSplits`), counted in the un-split warning. */
  scheduledSplits?: { splits: number; splitsWithTransfers: number };
  /** Set when exactly one plain transaction is selected. */
  onMakeRepeating?: () => void;
  /** Set when the selection is one imported and one entered transaction. */
  onMatch?: () => void;
  /** Set when every selected transaction is matched. */
  onUnmatch?: () => void;
  onExport?: () => void;
  /** K with one transaction selected opens its category list instead of the menu. */
  onCategorizeKey?: () => void;
}) {
  const [flagOpen, setFlagOpen] = useState(false);
  const [categorizeOpen, setCategorizeOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [unsplitFor, setUnsplitFor] = useState<string | null>(null);
  const [memoOpen, setMemoOpen] = useState(false);
  // Set while a menu opens a dialog (More's memo, Categorize's un-split warning), so the closing
  // menu leaves the focus to the dialog.
  const openingDialog = useRef(false);
  const keepDialogFocus = (e: Event) => {
    if (openingDialog.current) e.preventDefault();
    openingDialog.current = false;
  };

  const count = summary ? summary.count + scheduledCount : null;
  const s = summary;
  const onlyScheduled = s?.count === 0 && scheduledCount > 0;
  // Clear shows when every selected row is uncleared; otherwise the states that apply are in
  // More. Scheduled rows have no cleared state.
  const reviewing = (s?.unapproved ?? 0) > 0;
  const toggle =
    s && s.count > 0 && scheduledCount === 0 && s.uncleared === s.count && !reviewing
      ? "cleared"
      : null;
  const markCleared = !toggle && s ? s.uncleared > 0 : false;
  const markUncleared = !toggle && s ? s.cleared > 0 : false;
  // Splits without a transfer line get un-split, after a warning. It counts every selected split,
  // scheduled ones too, and mentions transfers when any has a transfer line.
  const splits = (s?.splits ?? 0) + scheduledSplits.splits;
  const splitsWithTransfers = (s?.splitsWithTransfers ?? 0) + scheduledSplits.splitsWithTransfers;
  const unsplits = splits - splitsWithTransfers;

  function categorize(categoryId: string) {
    if (unsplits > 0) {
      openingDialog.current = true;
      setUnsplitFor(categoryId);
    } else onAction({ type: "categorize", categoryId });
  }
  const unsplitName = categories.find((c) => c.id === unsplitFor);
  const unsplitLabel = unsplitName ? categoryLabel(unsplitName) : "";

  const ready = !pending && s !== undefined;
  const canCategorize = s !== undefined && (s.categorizable > 0 || scheduledCount > 0);
  const transactions = s !== undefined && s.count > 0 && scheduledCount === 0;
  useShortcut("approve", () => onAction({ type: "approve" }), { enabled: ready && reviewing });
  useShortcut("reject", () => onAction({ type: "reject" }), { enabled: ready && reviewing });
  useShortcut("categorize", () => (onCategorizeKey ? onCategorizeKey() : setCategorizeOpen(true)), {
    enabled: ready && canCategorize,
  });
  // C toggles: anything uncleared makes them all cleared, all cleared makes them uncleared.
  useShortcut(
    "toggleCleared",
    () => onAction({ type: "cleared", cleared: (s?.uncleared ?? 0) > 0 ? "cleared" : "uncleared" }),
    { enabled: ready && transactions },
  );
  useShortcut("flag", () => setFlagOpen(true), { enabled: ready });
  useShortcut("duplicate", () => onAction({ type: "duplicate" }), { enabled: ready });
  useShortcut("makeRepeating", () => onMakeRepeating?.(), { enabled: ready && !!onMakeRepeating });
  useShortcut("delete", () => onAction({ type: "delete" }), {
    enabled: ready && (s.deletable > 0 || scheduledCount > 0),
  });
  useShortcut("enterNow", () => onAction({ type: "enterNow" }), {
    enabled: ready && onlyScheduled,
  });
  useShortcut("match", () => onMatch?.(), { enabled: ready && !!onMatch });
  useShortcut("unmatch", () => onUnmatch?.(), { enabled: ready && !!onUnmatch });

  /** Shift+F's menu takes digits: 1–6 a colour in order, 0 no flag. */
  function flagByDigit(e: React.KeyboardEvent) {
    if (!/^[0-6]$/.test(e.key)) return;
    const flag = e.key === "0" ? null : flags[Number(e.key) - 1]?.color;
    if (flag === undefined) return;
    e.preventDefault();
    setFlagOpen(false);
    onAction({ type: "flag", flag });
  }

  return (
    <section
      aria-label="Selected transactions"
      // Floats at the bottom, so the rows don't jump when it appears.
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 md:bottom-6 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-sm shadow-lg duration-200 ease-out-quint animate-in fade-in-0 slide-in-from-bottom-2 motion-reduce:slide-in-from-bottom-0"
    >
      {/* The count is read out as it changes; the X beside it clears the selection. */}
      <span className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Clear selection"
          onClick={onClear}
        >
          <X />
        </Button>
        <span aria-live="polite" className="pr-1 font-medium tabular-nums">
          {count === null ? "Counting…" : plural(count, "Transaction")}
        </span>
      </span>
      {total !== null && <span className="text-muted-foreground tabular-nums">Total {total}</span>}
      {canSelectAll && !allMatching && (
        <Button type="button" variant="link" size="sm" onClick={onSelectAll}>
          Select all matching
        </Button>
      )}
      <div className="flex flex-wrap items-center gap-1 border-l pl-2">
        {onlyScheduled && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => onAction({ type: "enterNow" })}
          >
            <CalendarClock /> Enter Now
          </Button>
        )}
        {reviewing && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => onAction({ type: "approve" })}
            >
              <Check /> Approve
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => onAction({ type: "reject" })}
            >
              <CircleX /> Reject
            </Button>
          </>
        )}
        {s && (s.categorizable > 0 || scheduledCount > 0) && (
          // Inflow → Ready to Assign first, then the visible groups in plan order, without payment
          // or hidden categories.
          <DropdownMenu open={categorizeOpen} onOpenChange={setCategorizeOpen}>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" disabled={pending}>
                <Tag /> Categorize
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56" onCloseAutoFocus={keepDialogFocus}>
              {groupOptions(categories).map((group, i) => (
                <DropdownMenuSub key={`${i}-${group.name}`}>
                  <DropdownMenuSubTrigger>{group.name}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                    {group.categories.map((c) => (
                      <DropdownMenuItem key={c.id} onSelect={() => categorize(c.id)}>
                        {c.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {/* With unapproved rows selected Flag is in More; Shift+F still opens this menu, anchored to More. */}
        <Popover open={flagOpen} onOpenChange={setFlagOpen}>
          {!reviewing && (
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="sm" disabled={pending || !s}>
                <Bookmark /> Flag
              </Button>
            </PopoverTrigger>
          )}
          {reviewing && <PopoverAnchor virtualRef={moreRef} />}
          <PopoverContent align="end" className="w-60 p-1.5">
            <div
              role="menu"
              aria-label="Flag selected"
              className="grid"
              onKeyDown={(e) => {
                flagByDigit(e);
                menuKeyDown(e);
              }}
            >
              {flags.map((f, i) => (
                <button
                  key={f.color}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setFlagOpen(false);
                    onAction({ type: "flag", flag: f.color });
                  }}
                  className={FLAG_ITEM}
                >
                  <Bookmark className={cn("size-4 fill-current", FLAG_CLASS[f.color])} />
                  {flagLabel(f)}
                  <Kbd className="ml-auto">{i + 1}</Kbd>
                </button>
              ))}
              <div className="my-1 border-t" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setFlagOpen(false);
                  onAction({ type: "flag", flag: null });
                }}
                className={FLAG_ITEM}
              >
                Clear flag
                <Kbd className="ml-auto">0</Kbd>
              </button>
            </div>
          </PopoverContent>
        </Popover>
        {toggle && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            title="Mark as cleared"
            onClick={() => onAction({ type: "cleared", cleared: toggle })}
          >
            <CircleCheck /> Clear
          </Button>
        )}
        {onMatch && (
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onMatch}>
            <Link2 /> Match
          </Button>
        )}
        {onUnmatch && (
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onUnmatch}>
            <Unlink /> Unmatch
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button ref={moreRef} type="button" variant="ghost" size="sm" disabled={pending || !s}>
              <MoreHorizontal /> More
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56" onCloseAutoFocus={keepDialogFocus}>
            {markCleared && (
              <DropdownMenuItem onSelect={() => onAction({ type: "cleared", cleared: "cleared" })}>
                <CircleCheck /> Mark as Cleared
              </DropdownMenuItem>
            )}
            {markUncleared && (
              <DropdownMenuItem
                onSelect={() => onAction({ type: "cleared", cleared: "uncleared" })}
              >
                <Circle /> Mark as Uncleared
              </DropdownMenuItem>
            )}
            {(markCleared || markUncleared) && <DropdownMenuSeparator />}
            {reviewing && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Bookmark /> Flag
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {flags.map((f) => (
                    <DropdownMenuItem
                      key={f.color}
                      onSelect={() => onAction({ type: "flag", flag: f.color })}
                    >
                      <Bookmark className={cn("size-4 fill-current", FLAG_CLASS[f.color])} />
                      {flagLabel(f)}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onAction({ type: "flag", flag: null })}>
                    Clear flag
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {/* Match and Unmatch are listed here too, greyed when they don't apply. */}
            <DropdownMenuItem disabled={!onMatch} onSelect={() => onMatch?.()}>
              <Link2 /> Match
              <DropdownMenuShortcut>M</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!onUnmatch} onSelect={() => onUnmatch?.()}>
              <Unlink /> Unmatch
              <DropdownMenuShortcut>shift U</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onAction({ type: "duplicate" })}>
              <Copy /> Duplicate
              <DropdownMenuShortcut>shift D</DropdownMenuShortcut>
            </DropdownMenuItem>
            {onMakeRepeating && (
              <DropdownMenuItem onSelect={onMakeRepeating}>
                <Repeat /> Make Repeating
                <DropdownMenuShortcut>shift T</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={() => {
                openingDialog.current = true;
                setMemoOpen(true);
              }}
            >
              <NotebookPen /> Memo…
            </DropdownMenuItem>
            {onExport && s && s.count > 0 && (
              <DropdownMenuItem onSelect={onExport}>
                <FileDown /> Export {plural(s.count, "Transaction")}
              </DropdownMenuItem>
            )}
            {moveTargets.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ArrowRightLeft /> Move to Account
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {moveTargets.map((a) => (
                    <DropdownMenuItem
                      key={a.id}
                      onSelect={() => onAction({ type: "move", accountId: a.id })}
                    >
                      {a.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {s && (s.deletable > 0 || scheduledCount > 0) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => onAction({ type: "delete" })}
                >
                  <Trash2 /> Delete
                  <DropdownMenuShortcut>delete</DropdownMenuShortcut>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={unsplitFor !== null} onOpenChange={(open) => !open && setUnsplitFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {splits === 1
                ? "Un-split and Categorize Split Transaction?"
                : "Un-split and Categorize Split Transactions?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="grid gap-2">
                {splits === 1 ? (
                  <>
                    <p>A quick heads up: You have a split transaction selected.</p>
                    <p>
                      If you categorize the split transaction as "{unsplitLabel}" we will un-split
                      it.
                    </p>
                  </>
                ) : (
                  <>
                    <p>A quick heads up: You have {splits} split transactions selected.</p>
                    {splitsWithTransfers > 0 ? (
                      <p>
                        If you categorize them as "{unsplitLabel}" we will un-split the
                        transactions, as long as they don't contain transfers.
                        <br />
                        If they do contain transfers, we'll leave them as split transactions and
                        categorize all the non-transfer sub-transactions as "{unsplitLabel}."
                      </p>
                    ) : (
                      <p>
                        If you categorize these split transactions as "{unsplitLabel}" we will
                        un-split them.
                      </p>
                    )}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (unsplitFor) onAction({ type: "categorize", categoryId: unsplitFor });
                setUnsplitFor(null);
              }}
            >
              Categorize
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MemoDialog
        open={memoOpen}
        count={count ?? 0}
        onOpenChange={setMemoOpen}
        onSave={(memo) => {
          setMemoOpen(false);
          onAction({ type: "memo", memo });
        }}
      />
    </section>
  );
}

/** The flat category options as their groups, in order (each group's run of options). */
export function groupOptions(options: readonly CategoryOption[]) {
  const groups: { name: string; categories: CategoryOption[] }[] = [];
  for (const option of options) {
    const last = groups.at(-1);
    if (last?.name === option.group) last.categories.push(option);
    else groups.push({ name: option.group, categories: [option] });
  }
  return groups;
}

/** The memo replaces each selected transaction's. */
function MemoDialog({
  open,
  count,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  count: number;
  onOpenChange: (open: boolean) => void;
  onSave: (memo: string) => void;
}) {
  const [memo, setMemo] = useState("");
  const id = useId();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setMemo("");
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (memo) onSave(memo);
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit Memo ({plural(count, "Transaction")})</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={id}>Memo</Label>
            <Input
              id={id}
              value={memo}
              maxLength={500}
              placeholder="Enter a memo for selected transactions"
              autoFocus
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!memo}>
              Update {plural(count, "Transaction")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
