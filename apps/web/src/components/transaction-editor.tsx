import {
  accountFamily,
  type DateFormat,
  formatAmount,
  money,
  usesCategory,
} from "@strictbudget/engine";
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
import { FieldError } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@strictbudget/ui/components/input-group";
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import { ToggleGroup, ToggleGroupItem } from "@strictbudget/ui/components/toggle-group";
import { cn } from "@strictbudget/ui/lib/utils";
import { Minus, Plus, Split, Trash2, X } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import type { Account } from "@/lib/accounts";
import { applyTransactionDraft, draftTransactionFromFile } from "@/lib/ai";
import { todayIso } from "@/lib/dates";
import type { Flag } from "@/lib/flags";
import { inCurrency, type MoneySettings, parseMoneyInput, toMoneyInput } from "@/lib/money-input";
import {
  type CategoryOption,
  clearedFor,
  type Draft,
  draftAmount,
  emptyLine,
  type LineDraft,
  type Payee,
  payeeSuggestionIds,
  remainingLabel,
  splitMismatch,
  splitRemaining,
  startSplit,
  type TransferDirection,
  transferRateLabel,
  withRemainder,
  withSplitTotal,
} from "@/lib/transactions";
import { FlagMenu } from "./flag-menu";
import { NewAttachmentCell } from "./new-transaction-attachment";
import {
  COLUMN_SPECS,
  type ColumnId,
  PINNED_BG,
  pinned,
  pinnedColumns,
  pinnedWidth,
} from "./register-columns";
import {
  CategoryField,
  DateField,
  listOwnsKey,
  type PayeeChoice,
  PayeeField,
} from "./register-fields";
import {
  ClearedMark,
  DATE_EDITOR_FIT,
  EDITOR_CELL,
  RegisterCell,
  RegisterRow,
} from "./register-table";

/**
 * A typed amount as the budget writes amounts ("50" reads "50.00", "12+3" "15.00"), so the figures
 * in an editor line up; left as typed when it can't be read (saving says why).
 */
function tidyAmount(text: string, settings: MoneySettings) {
  if (text.trim() === "") return text;
  const amount = parseMoneyInput(text, settings);
  return typeof amount === "string" ? text : toMoneyInput(amount, settings);
}

/** The field an editor opens in: a column of the transaction's row, or of one of its split lines. */
export interface EditorFocus {
  column: ColumnId;
  /** The split line's index; left out for the transaction's own row. */
  line?: number;
}

/**
 * The control to focus for `focus` in a row editor's rows (under `body`): the clicked cell's field.
 * A split's own category isn't a field, so its first line's is; a memo without a column is the
 * footer's.
 */
function focusTarget(body: ParentNode, { column, line }: EditorFocus) {
  const row =
    line !== undefined && line >= 0 ? `[data-editor-line="${line}"]` : "[data-editor-main]";
  const candidates = [
    `${row} [data-editor-column="${column}"]`,
    `[data-editor-line="0"] [data-editor-column="${column}"]`,
    column === "memo" ? "[data-editor-footer-memo]" : null,
  ];
  for (const selector of candidates) {
    const field = selector
      ? body
          .querySelector(selector)
          ?.querySelector<HTMLElement>(
            "input:not([type=hidden]), select, textarea, button:not([tabindex='-1'])",
          )
      : null;
    if (field) return field;
  }
  return null;
}

export function TransactionEditor({
  initial,
  columns,
  accounts,
  accountChoices,
  payees,
  categories,
  dateFormat,
  settings: budgetSettings,
  flags,
  onRenameFlags,
  label = "New transaction",
  repeat = false,
  scheduled = false,
  openDatePicker = false,
  focusMemo = false,
  focusSplit = false,
  focusAmount = false,
  focusCell,
  recentPayees = [],
  layout = "row",
  pending,
  error,
  transferCategory,
  onSave,
  onSaveAndAddAnother,
  onCancel,
  onDelete,
  attachment,
  newAttachment,
}: {
  initial: Draft;
  columns: readonly ColumnId[];
  /** Open accounts only. */
  accounts: readonly Account[];
  /** The account list, when narrower than `accounts` (an existing one stays in its currency). */
  accountChoices?: readonly Account[];
  payees: readonly Payee[];
  categories: readonly CategoryOption[];
  dateFormat: DateFormat;
  /** The budget's; amounts use the draft account's currency. */
  settings: MoneySettings;
  flags: readonly Flag[];
  onRenameFlags: (changes: Flag[]) => Promise<void>;
  label?: string;
  /** Offer "Repeat:" in the date picker (new and scheduled transactions). */
  repeat?: boolean;
  /** A scheduled transaction: it has no cleared state until it's entered. */
  scheduled?: boolean;
  /** Open the date picker first (Make Repeating). */
  openDatePicker?: boolean;
  /** Start in the memo (the S shortcut's split). */
  focusMemo?: boolean;
  /** Start in the first split line's amount (a transaction just split from its category). */
  focusSplit?: boolean;
  /** Start in the amount, raising a phone's number keyboard (a new transaction in the drawer). */
  focusAmount?: boolean;
  /** Start in this field (the row's cell that was clicked to open it). */
  focusCell?: EditorFocus;
  /** Payees to offer as one tap each under the stacked editor's payee field. */
  recentPayees?: readonly string[];
  layout?: "row" | "stacked";
  pending: boolean;
  error: string | null;
  /** An in-budget transfer's category text ("Credit Card Payments: <card>"), or "". */
  transferCategory?: (accountId: string, transferAccountId: string | null) => string;
  /** `file`: a new transaction's attachment, to upload once it's saved. */
  onSave: (draft: Draft, file: File | null) => void;
  /** A new row's "Save and add another" (also its Enter); the next row keeps the date. */
  onSaveAndAddAnother?: (draft: Draft, file: File | null) => void;
  onCancel: () => void;
  /** The stacked editor's Delete, under its fields (an existing transaction). */
  onDelete?: () => void;
  /** An existing transaction's attachment cell, shown as it is while the row is edited. */
  attachment?: ReactNode;
  /**
   * A new transaction's attachment, picked in the editor and uploaded after saving; with AI on,
   * a receipt can fill the transaction in.
   */
  newAttachment?: { budgetId: string; aiEnabled: boolean };
}) {
  const [draft, setDraft] = useState(initial);
  const [file, setFile] = useState<File | null>(null);
  const [filling, setFilling] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const account = accounts.find((a) => a.id === draft.accountId);
  const settings = inCurrency(budgetSettings, account?.currency);
  const transferTo = accounts.find((a) => a.id === draft.transferAccountId);
  const needsCategory = account ? usesCategory(account.type, transferTo?.type) : true;
  // Money can move to any other open account; a split can't itself be a transfer (its lines can).
  // Scheduled transfers stay in one currency.
  const transfers = accounts.filter(
    (a) => a.id !== draft.accountId && (!scheduled || a.currency === account?.currency),
  );
  const lines = draft.lines;
  // A transfer to an account in another currency: that side's own amount.
  const crossTo =
    !scheduled && !lines && account && transferTo && transferTo.currency !== account.currency
      ? transferTo
      : null;
  // A schedule has no rate of its own: it takes the date's when it's entered. Across currencies
  // a side in the budget's currency sets the base amount, so a rate would do nothing.
  const foreign =
    !scheduled &&
    account !== undefined &&
    account.currency !== budgetSettings.currency &&
    crossTo?.currency !== budgetSettings.currency;
  // A new transfer's fee comes out of the sending account (the other one for an inflow).
  const sending = typedDirection(draft) === "in" ? transferTo : account;
  const withFee = Boolean(onSaveAndAddAnother && !scheduled && !lines && transferTo && sending);
  const feeSettings = inCurrency(budgetSettings, sending?.currency);
  const canSplit = account ? usesCategory(account.type, null) && !draft.transferAccountId : false;
  // Splitting moves to the first line's amount, on the side the transaction's amount is on.
  const firstLineAmount = useRef<HTMLInputElement>(null);
  const [splitFocus, setSplitFocus] = useState(focusSplit ? 1 : 0);
  useEffect(() => {
    if (splitFocus === 0) return;
    // After the category list closes, which hands focus back to where it opened.
    // Selected, so typing replaces the whole amount it starts with.
    const frame = requestAnimationFrame(() => {
      firstLineAmount.current?.focus();
      firstLineAmount.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [splitFocus]);
  const direction = typedDirection(draft) === "in" ? "inflow" : "outflow";
  const mainRow = useRef<HTMLTableRowElement>(null);
  // Once, as the editor opens.
  useEffect(() => {
    if (!focusCell || layout !== "row") return;
    const frame = requestAnimationFrame(() => {
      const body = mainRow.current?.parentElement;
      const field = body ? focusTarget(body, focusCell) : null;
      if (!field) return;
      field.focus();
      // An amount is selected, so typing replaces it.
      if (field instanceof HTMLInputElement && field.inputMode === "decimal") field.select();
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  // Remounts the payee field focused, after the card's "Payment to <card>" is picked.
  const [payeeFocus, setPayeeFocus] = useState(0);
  // A card's category list has "Payment to <card>" under "Credit Cards". Picking it clears the payee and category and moves to the payee list, to pick the account
  // the payment comes from.
  const pickable =
    account && accountFamily(account.type) === "credit"
      ? [
          ...categories,
          { id: CARD_PAYMENT, name: `Payment to ${account.name}`, group: "Credit Cards" },
        ]
      : categories;

  function chooseAccount(id: string) {
    const next = accounts.find((a) => a.id === id);
    // An account can't transfer to itself.
    const self = draft.transferAccountId === id;
    set({
      accountId: id,
      // On a new row (the one with "Save and add another") the account's starting state is
      // re-applied, over a manual toggle.
      ...(onSaveAndAddAnother ? { cleared: clearedFor(next?.type) } : {}),
      ...(self ? { payeeName: "", transferAccountId: null } : {}),
      ...(next && !usesCategory(next.type, self ? null : transferTo?.type)
        ? { categoryId: null, lines: null }
        : {}),
    });
  }

  function choosePayee({ name, transferAccountId, payee }: PayeeChoice) {
    setDraft((d) => {
      const to = accounts.find((a) => a.id === transferAccountId);
      const uses = account ? usesCategory(account.type, to?.type) : true;
      return {
        ...d,
        payeeName: name,
        transferAccountId,
        // What another account receives is typed again for a new one.
        ...(transferAccountId !== d.transferAccountId ? { transferAmount: "" } : {}),
        ...(!uses ? { categoryId: null } : {}),
        // Fills in the payee's category, by its Categorization setting.
        ...(payee?.prefillCategoryId && uses && d.categoryId === null && !d.lines
          ? { categoryId: payee.prefillCategoryId }
          : {}),
      };
    });
  }

  /** An amount field's text tidied as it's left ("50" reads "50.00"). */
  function tidyMain(side: "outflow" | "inflow") {
    setDraft((d) => ({ ...d, [side]: tidyAmount(d[side], settings) }));
  }
  function tidyLine(key: string, side: "outflow" | "inflow") {
    setDraft((d) => ({
      ...d,
      lines:
        d.lines?.map((l) =>
          l.key === key ? { ...l, [side]: tidyAmount(l[side], settings) } : l,
        ) ?? null,
    }));
  }

  function setLine(key: string, patch: Partial<LineDraft>) {
    setDraft((d) => ({
      ...d,
      lines: d.lines?.map((l) => (l.key === key ? { ...l, ...patch } : l)) ?? null,
    }));
  }
  function removeLine(key: string) {
    setDraft((d) => ({ ...d, lines: d.lines?.filter((l) => l.key !== key) ?? null }));
  }

  // Saving a split whose lines miss its total asks first.
  const [mismatch, setMismatch] = useState<ReturnType<typeof splitMismatch>>(null);
  // A split's "left to split" turns red only once saving has found it short.
  const [triedSave, setTriedSave] = useState(false);
  function save(another = false) {
    // Not while the AI is still filling the row in.
    if (filling) return;
    if (draft.lines) setTriedSave(true);
    const found = splitMismatch(draft, settings);
    if (found) setMismatch(found);
    else if (another && onSaveAndAddAnother) onSaveAndAddAnother(draft, file);
    else onSave(draft, file);
  }

  async function fillFrom(receipt: File) {
    if (!newAttachment) return;
    setFilling(true);
    try {
      const read = await draftTransactionFromFile(
        newAttachment.budgetId,
        receipt,
        draft.accountId,
        todayIso(),
      );
      setDraft((d) => {
        const own = accounts.find((a) => a.id === d.accountId);
        return applyTransactionDraft(d, read, inCurrency(budgetSettings, own?.currency));
      });
      if (!read.found) toast.warning("This doesn't look like a receipt. Check what was filled in.");
      else if (read.note) toast.info(read.note);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The AI couldn't read this file.");
    } finally {
      setFilling(false);
    }
  }
  const show = (amount: bigint) => formatAmount(money(amount, settings.currency), settings);

  function handleKeyDown(event: KeyboardEvent) {
    // The prompt's keys reach the row through the portal; they're the prompt's own.
    if (listOwnsKey(event) || mismatch) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      // On a new row, Enter is "Save and add another".
      save(true);
    }
  }

  function cell(column: ColumnId) {
    switch (column) {
      case "select":
        return null;
      case "attachment":
        return newAttachment ? (
          <NewAttachmentCell
            file={file}
            onFile={setFile}
            aiEnabled={newAttachment.aiEnabled}
            // Reading it, or uploading it with the saved transaction.
            busy={filling || (pending && file !== null)}
            onFill={(receipt) => void fillFrom(receipt)}
            labelled={layout === "stacked"}
            className={layout === "stacked" ? "justify-start" : "justify-center"}
          />
        ) : (
          (attachment ?? null)
        );
      case "flag":
        return (
          <FlagMenu
            value={draft.flag}
            flags={flags}
            onChange={(flag) => set({ flag })}
            onRename={onRenameFlags}
            labelled={layout === "stacked"}
          />
        );
      case "account":
        return (
          <NativeSelect
            aria-label="Account"
            // First field of the row (the date is, without an account column). The stacked editor
            // starts in the amount, or nowhere: focusing a select would open no keyboard.
            autoFocus={!focusMemo && !focusSplit && !focusCell && layout === "row"}
            value={draft.accountId}
            onChange={(e) => chooseAccount(e.target.value)}
            className="h-8 w-full"
          >
            {(accountChoices ?? accounts).map((a) => (
              <NativeSelectOption key={a.id} value={a.id}>
                {a.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        );
      case "date":
        return (
          <DateField
            value={draft.date}
            onChange={(date) => set({ date })}
            format={dateFormat}
            // A phone's drawer opens without the keyboard; the date is a tap away.
            autoFocus={
              !columns.includes("account") &&
              !focusMemo &&
              !focusSplit &&
              !focusCell &&
              layout !== "stacked"
            }
            defaultOpen={openDatePicker}
            repeat={
              repeat
                ? { value: draft.frequency ?? "never", onChange: (frequency) => set({ frequency }) }
                : undefined
            }
          />
        );
      case "payee":
        return (
          <PayeeField
            key={payeeFocus}
            autoFocus={payeeFocus > 0}
            value={draft.payeeName}
            payees={payees}
            transfers={lines ? [] : transfers}
            own={account && { type: account.type, direction: typedDirection(draft) }}
            transferAccountId={draft.transferAccountId}
            onChange={choosePayee}
          />
        );
      case "category":
        if (lines) {
          return (
            <p
              className="flex min-w-0 items-center gap-1.5 px-1.5 text-sm"
              title={`Split (${lines.length} ${lines.length === 1 ? "line" : "lines"})`}
            >
              <Split className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate" aria-hidden>
                Split · {lines.length}
              </span>
              <span className="sr-only">
                Split into {lines.length} {lines.length === 1 ? "line" : "lines"}
              </span>
            </p>
          );
        }
        return needsCategory ? (
          <CategoryField
            value={draft.categoryId}
            onChange={(categoryId) => {
              if (categoryId !== CARD_PAYMENT) {
                set({ categoryId });
                return;
              }
              set({ categoryId: null, payeeName: "", transferAccountId: null });
              setPayeeFocus((n) => n + 1);
            }}
            onSplit={
              canSplit
                ? () => {
                    setDraft(startSplit);
                    setSplitFocus((n) => n + 1);
                  }
                : undefined
            }
            // Opens the payee list, keeping the payee and category.
            onPaymentTransfer={() => setPayeeFocus((n) => n + 1)}
            categories={pickable}
            shortcuts
            suggestedIds={payeeSuggestionIds(payees, draft)}
          />
        ) : (
          <p
            className="truncate px-1.5 text-muted-foreground text-sm italic"
            title={transferCategory?.(draft.accountId, draft.transferAccountId) || undefined}
          >
            {transferCategory?.(draft.accountId, draft.transferAccountId) || "Category not needed"}
          </p>
        );
      case "memo":
        return (
          <Input
            aria-label="Memo"
            // The stacked editor names the field above it.
            placeholder={layout === "stacked" ? undefined : "Memo"}
            autoFocus={focusMemo}
            value={draft.memo}
            onChange={(e) => set({ memo: e.target.value })}
            className="h-8"
          />
        );
      case "amount":
        return (
          <AmountField
            outflow={draft.outflow}
            inflow={draft.inflow}
            fallback={direction}
            settings={settings}
            onChange={set}
          />
        );
      case "outflow":
      case "inflow":
        return (
          <Input
            aria-label={column === "outflow" ? "Outflow" : "Inflow"}
            placeholder={column === "outflow" ? "Outflow" : "Inflow"}
            inputMode="decimal"
            value={draft[column]}
            onBlur={() => tidyMain(column)}
            // One side only: typing an outflow clears the inflow and vice versa.
            onChange={(e) =>
              set(
                column === "outflow"
                  ? { outflow: e.target.value, inflow: "" }
                  : { inflow: e.target.value, outflow: "" },
              )
            }
            className="h-8 text-right tabular-nums"
          />
        );
      case "cleared":
        if (scheduled) return null;
        if (layout === "stacked") {
          const cleared = draft.cleared === "cleared";
          return (
            <Button
              type="button"
              variant="outline"
              aria-pressed={cleared}
              className="w-full justify-start font-normal"
              onClick={() => set({ cleared: cleared ? "uncleared" : "cleared" })}
            >
              <ClearedMark state={cleared ? "cleared" : "uncleared"} />
              {cleared ? "Cleared" : "Uncleared"}
            </Button>
          );
        }
        return (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="group/cleared"
            aria-label={draft.cleared === "cleared" ? "Cleared" : "Uncleared"}
            aria-pressed={draft.cleared === "cleared"}
            onClick={() => set({ cleared: draft.cleared === "cleared" ? "uncleared" : "cleared" })}
          >
            <ClearedMark state={draft.cleared === "cleared" ? "cleared" : "uncleared"} />
          </Button>
        );
      default:
        return null;
    }
  }

  /** Once every other line has an amount, the one left empty takes the rest. */
  function fillRemainder(leaving: string) {
    setDraft((d) => {
      const empty = (d.lines ?? []).filter(
        (l) => l.outflow.trim() === "" && l.inflow.trim() === "",
      );
      const last = empty.length === 1 ? empty[0] : undefined;
      return last && last.key !== leaving ? withRemainder(d, last.key, settings) : d;
    });
  }

  function lineCell(line: LineDraft, index: number, column: ColumnId) {
    const to = accounts.find((a) => a.id === line.transferAccountId);
    const lineUses = account ? usesCategory(account.type, to?.type) : true;
    const name = `line ${index + 1}`;
    switch (column) {
      case "payee":
        return (
          <PayeeField
            label={`Payee, ${name}`}
            value={line.payeeName}
            payees={payees}
            transfers={transfers}
            own={account && { type: account.type, direction: typedDirection(line) }}
            transferAccountId={line.transferAccountId}
            onChange={({ name: payeeName, transferAccountId, payee }) => {
              const toAccount = accounts.find((a) => a.id === transferAccountId);
              const uses = account ? usesCategory(account.type, toAccount?.type) : true;
              setLine(line.key, {
                payeeName,
                transferAccountId,
                ...(!uses ? { categoryId: null } : {}),
                ...(payee?.prefillCategoryId && uses && line.categoryId === null
                  ? { categoryId: payee.prefillCategoryId }
                  : {}),
              });
            }}
          />
        );
      case "category":
        return lineUses ? (
          <CategoryField
            label={`Category, ${name}`}
            value={line.categoryId}
            onChange={(categoryId) => setLine(line.key, { categoryId })}
            categories={categories}
            shortcuts
            suggestedIds={payeeSuggestionIds(payees, line)}
          />
        ) : (
          <p className="px-2 text-muted-foreground text-sm italic">Category not needed</p>
        );
      case "memo":
        return (
          <Input
            aria-label={`Memo, ${name}`}
            placeholder="Memo"
            value={line.memo}
            onChange={(e) => setLine(line.key, { memo: e.target.value })}
            className="h-8"
          />
        );
      case "amount":
        return (
          <AmountField
            label={name}
            outflow={line.outflow}
            inflow={line.inflow}
            fallback={direction}
            settings={settings}
            inputRef={index === 0 ? firstLineAmount : undefined}
            onBlur={() => fillRemainder(line.key)}
            onChange={(patch) => setLine(line.key, patch)}
          />
        );
      case "outflow":
      case "inflow":
        return (
          <Input
            ref={index === 0 && column === direction ? firstLineAmount : undefined}
            aria-label={`${column === "outflow" ? "Outflow" : "Inflow"}, ${name}`}
            placeholder={column === "outflow" ? "Outflow" : "Inflow"}
            inputMode="decimal"
            value={line[column]}
            onBlur={() => {
              tidyLine(line.key, column);
              fillRemainder(line.key);
            }}
            onChange={(e) =>
              setLine(
                line.key,
                column === "outflow"
                  ? { outflow: e.target.value, inflow: "" }
                  : { inflow: e.target.value, outflow: "" },
              )
            }
            className="h-8 text-right tabular-nums"
          />
        );
      case "actions":
        return (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${name}`}
            onClick={() => removeLine(line.key)}
          >
            <X />
          </Button>
        );
      default:
        return null;
    }
  }

  const split = lines ? splitRemaining(draft, settings) : null;
  const remaining = split && "remaining" in split ? split.remaining : null;
  const rateLabel = transferRate(draft, settings, account?.currency, crossTo?.currency);

  // The row editor's memo goes in its footer when the register has no Memo column, and each split
  // line's in the cells before its payee (which lines leave empty).
  const memoInFooter = layout === "row" && !columns.includes("memo");
  const memoLead = memoInFooter
    ? columns.slice(columns.indexOf("select") + 1, columns.indexOf("payee"))
    : [];
  const footerExtras = (
    <>
      {memoInFooter && (
        // Lined up with the split lines' memos, which start after the select column.
        <div
          data-editor-footer-memo
          className="mr-auto w-72 max-w-full"
          style={{
            marginLeft: `calc(0rem${columns
              .slice(0, columns.indexOf("select") + 1)
              .map((c) => ` + ${COLUMN_SPECS[c].width ?? "0rem"}`)
              .join("")} - 0.25rem)`,
          }}
        >
          <Input
            aria-label="Memo"
            placeholder="Memo"
            autoFocus={focusMemo}
            value={draft.memo}
            onChange={(e) => set({ memo: e.target.value })}
            className="h-8"
          />
        </div>
      )}
      {lines && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const line = emptyLine();
              setDraft((d) =>
                withRemainder({ ...d, lines: [...(d.lines ?? []), line] }, line.key, settings),
              );
            }}
          >
            <Plus /> Add line
          </Button>
          <p
            className={cn(
              "mr-auto text-sm tabular-nums",
              // Still being typed, what's left is only a count; it's a problem once lines go past
              // the total, or saving found them short.
              remaining === 0n && split && "total" in split && split.total !== 0n
                ? "text-success"
                : (remaining !== null && remaining < 0n) || (triedSave && remaining !== 0n)
                  ? "text-destructive"
                  : "text-muted-foreground",
            )}
            aria-live="polite"
          >
            {remaining === null || !split || "error" in split
              ? "Check the amounts"
              : remainingLabel(remaining, settings, split.total)}
          </p>
        </>
      )}
      {error && <FieldError className="mr-auto">{error}</FieldError>}
      {crossTo && (
        // The other account's own amount; left empty, the date's rate.
        <div className="flex flex-col items-end gap-0.5 text-muted-foreground text-sm">
          <div className="flex items-center gap-1.5">
            <span aria-hidden>
              {crossTo.name} {typedDirection(draft) === "in" ? "sends" : "receives"}
            </span>
            <Input
              aria-label={`${crossTo.name} ${
                typedDirection(draft) === "in" ? "sends" : "receives"
              } (${crossTo.currency})`}
              className="h-7 w-28 text-right tabular-nums"
              inputMode="decimal"
              placeholder="Date's rate"
              value={draft.transferAmount ?? ""}
              onChange={(e) => set({ transferAmount: e.target.value })}
            />
            <span aria-hidden>{crossTo.currency}</span>
          </div>
          {rateLabel && (
            <span className="text-xs tabular-nums" aria-live="polite">
              {rateLabel}
            </span>
          )}
        </div>
      )}
      {withFee && sending && (
        <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
          <span aria-hidden>Fee</span>
          <Input
            aria-label={`Transfer fee (${feeSettings.currency})`}
            className="h-7 w-20 text-right tabular-nums"
            inputMode="decimal"
            placeholder="None"
            value={draft.fee ?? ""}
            onChange={(e) => set({ fee: e.target.value })}
          />
          <span aria-hidden>{feeSettings.currency}</span>
          {draft.fee?.trim() && usesCategory(sending.type, null) && (
            <div className="w-44">
              <CategoryField
                label="Fee category"
                value={draft.feeCategoryId ?? null}
                onChange={(feeCategoryId) => set({ feeCategoryId })}
                categories={categories}
              />
            </div>
          )}
        </div>
      )}
      {foreign && account && (
        // What the plan counts is this amount at the rate; left empty, the date's rate (locked once saved, looked up again only when the date changes).
        <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
          <span aria-hidden>1 {account.currency} =</span>
          <Input
            aria-label={`Rate from ${account.currency} to ${budgetSettings.currency}`}
            className="h-7 w-24 tabular-nums"
            inputMode="decimal"
            placeholder="Date's rate"
            value={draft.fxRate ?? ""}
            onChange={(e) => set({ fxRate: e.target.value })}
          />
          <span aria-hidden>{budgetSettings.currency}</span>
        </div>
      )}
    </>
  );
  // On a new row Enter is "Save and add another", so that's the primary; Save, which closes the
  // row, is the quieter one beside it.
  const footerActions = (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <Button
        type="button"
        variant={onSaveAndAddAnother ? "outline" : "default"}
        size="sm"
        onClick={() => save()}
        disabled={pending || filling}
      >
        Save
      </Button>
      {onSaveAndAddAnother && (
        <Button
          type="button"
          size="sm"
          title="Enter"
          onClick={() => save(true)}
          disabled={pending || filling}
        >
          Save and add another
        </Button>
      )}
    </>
  );
  const mismatchDialog = (
    <AlertDialog open={mismatch !== null} onOpenChange={(open) => !open && setMismatch(null)}>
      <AlertDialogContent className="data-[size=default]:sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Something Doesn't Add Up</AlertDialogTitle>
          <AlertDialogDescription>
            {mismatch &&
              `The total is ${show(mismatch.total)}, but the splits add up to ${show(
                mismatch.lines,
              )}. How would you like to handle the unassigned ${show(mismatch.unassigned)}?`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {/* Each leaves the row open to check before saving. */}
        <AlertDialogFooter>
          {mismatch?.distributed && (
            <AlertDialogAction
              onClick={() => {
                const lines = mismatch.distributed;
                setDraft((d) => ({ ...d, lines }));
              }}
            >
              Auto-Distribute
            </AlertDialogAction>
          )}
          <AlertDialogAction
            variant="outline"
            onClick={() => setDraft((d) => withSplitTotal(d, settings))}
          >
            Update Total
          </AlertDialogAction>
          <AlertDialogCancel>Adjust Manually</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  // A phone edits in a drawer, amount first: the figure large at the top with its direction under
  // it, then who and what for, then the rest, each field named above it.
  if (layout === "stacked") {
    const field = (name: string, control: ReactNode, className?: string) => (
      <div className={cn("grid min-w-0 gap-1.5", className)}>
        <span className="font-medium text-muted-foreground text-xs">{name}</span>
        {control}
      </div>
    );
    const showChips =
      recentPayees.length > 0 &&
      !draft.transferAccountId &&
      (draft.payeeName === "" || recentPayees.includes(draft.payeeName));
    const attachmentField = newAttachment ? cell("attachment") : attachment;
    return (
      <form
        aria-label={label}
        className="grid gap-5 [&_[data-slot=input-group]]:h-11 [&_[data-slot=native-select-wrapper]]:h-11 [&_input]:h-11 [&_select]:h-11"
        onKeyDown={handleKeyDown}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <HeroAmount
          outflow={draft.outflow}
          inflow={draft.inflow}
          fallback={direction}
          settings={settings}
          autoFocus={focusAmount}
          onChange={set}
        />
        <div className="grid gap-1.5">
          {field(
            "Payee",
            // Its own "Payee" placeholder would only repeat the name above it.
            <div className="[&_input::placeholder]:text-transparent">{cell("payee")}</div>,
          )}
          {showChips && (
            // biome-ignore lint/a11y/useSemanticElements: a group of buttons, not a form section
            <div
              role="group"
              aria-label="Recent payees"
              className="-mx-4 flex gap-2 overflow-x-auto px-4 pt-0.5 pb-1 [scrollbar-width:none]"
            >
              {recentPayees.map((name) => {
                const chosen = draft.payeeName === name;
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={chosen}
                    className={cn(
                      "h-8 shrink-0 rounded-full border px-3 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                      chosen
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-background hover:bg-accent",
                    )}
                    onClick={() =>
                      choosePayee({
                        name,
                        transferAccountId: null,
                        payee: payees.find((p) => p.name === name),
                      })
                    }
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {field("Category", cell("category"))}
        <div className="grid grid-cols-2 gap-3">
          {columns.includes("account") && field("Account", cell("account"))}
          {field("Date", cell("date"), columns.includes("account") ? undefined : "col-span-2")}
        </div>
        {field("Memo", cell("memo"))}
        <div className="grid grid-cols-2 gap-3 [&_button]:h-11">
          {field("Flag", cell("flag"))}
          {!scheduled && field("Status", cell("cleared"))}
        </div>
        {attachmentField &&
          field("Receipt or photo", <div className="[&_button]:h-11">{attachmentField}</div>)}
        {lines?.map((line, index) => (
          <fieldset key={line.key} className="grid gap-3 rounded-xl border p-3 pt-1">
            <legend className="sr-only">Split line {index + 1}</legend>
            <div className="flex items-center justify-between">
              <span aria-hidden className="font-medium text-muted-foreground text-xs">
                Line {index + 1}
              </span>
              {lineCell(line, index, "actions")}
            </div>
            {lineCell(line, index, "amount")}
            {lineCell(line, index, "payee")}
            {lineCell(line, index, "category")}
            {lineCell(line, index, "memo")}
          </fieldset>
        ))}
        {onDelete && (
          <Button
            type="button"
            variant="ghost"
            className="h-11 text-destructive"
            onClick={onDelete}
          >
            <Trash2 /> Delete transaction
          </Button>
        )}
        {/* Split totals, rates and errors, then the buttons, kept in reach above the keyboard. */}
        <div className="sticky bottom-0 -mx-4 grid gap-3 border-t bg-popover px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="flex flex-wrap items-center gap-2 empty:hidden">{footerExtras}</div>
          <div className="flex gap-2 [&>button]:h-11 [&>button]:flex-1">{footerActions}</div>
        </div>
        {mismatchDialog}
      </form>
    );
  }

  return (
    <>
      <RegisterRow
        ref={mainRow}
        still
        data-editor-main
        aria-label={label}
        className="not-last:*:border-b-0 bg-muted/50"
        onKeyDown={handleKeyDown}
      >
        {columns.map((column) => (
          <RegisterCell
            key={column}
            data-editor-column={column}
            style={pinned(columns, column)?.style}
            className={cn(
              EDITOR_CELL,
              column === "date" && DATE_EDITOR_FIT,
              (column === "cleared" || column === "flag" || column === "attachment") &&
                "px-1 text-center",
              pinned(columns, column) && [pinned(columns, column)?.className, PINNED_BG.editor],
            )}
          >
            {cell(column)}
          </RegisterCell>
        ))}
      </RegisterRow>
      {lines?.map((line, index) => (
        <RegisterRow
          still
          key={line.key}
          data-editor-line={index}
          aria-label={`Split line ${index + 1}`}
          className="not-last:*:border-b-0 bg-muted/50"
          onKeyDown={handleKeyDown}
        >
          {columns.map((column) =>
            memoLead.includes(column) ? (
              // Without a Memo column, a line's memo takes its empty cells before the payee.
              column === memoLead[0] && (
                <RegisterCell
                  key={column}
                  data-editor-column="memo"
                  colSpan={memoLead.length}
                  className={cn(EDITOR_CELL, "py-1")}
                >
                  {lineCell(line, index, "memo")}
                </RegisterCell>
              )
            ) : (
              <RegisterCell
                key={column}
                data-editor-column={column}
                style={pinned(columns, column)?.style}
                className={cn(
                  EDITOR_CELL,
                  "py-1",
                  pinned(columns, column) && [pinned(columns, column)?.className, PINNED_BG.editor],
                )}
              >
                {lineCell(line, index, column)}
              </RegisterCell>
            ),
          )}
        </RegisterRow>
      ))}
      <RegisterRow still className="bg-muted/50" onKeyDown={handleKeyDown}>
        <RegisterCell
          colSpan={columns.length - pinnedColumns(columns).length}
          className="px-1.5 pt-0"
        >
          {/*
           * The register's table can be wider than its scrolling container, so the footer takes
           * the container's visible width (`100cqw`: the container is a query container), sticks
           * to its left edge while scrolling sideways, and wraps within it. It stops short of the
           * pinned columns (Cleared, Actions), which keep their own cells in this row.
           */}
          <div
            className="sticky left-1.5 flex max-w-full items-center gap-x-4 whitespace-normal"
            style={{ width: `calc(100cqw - 0.75rem - ${pinnedWidth(columns)})` }}
          >
            {/* Totals, rates and errors wrap; the buttons stay on one line at the right. */}
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{footerExtras}</div>
            <div className="flex shrink-0 items-center gap-2">{footerActions}</div>
          </div>
          {mismatchDialog}
        </RegisterCell>
        {pinnedColumns(columns).map((column) => (
          <RegisterCell
            key={column}
            style={pinned(columns, column)?.style}
            className={cn(pinned(columns, column)?.className, PINNED_BG.editor)}
          />
        ))}
      </RegisterRow>
    </>
  );
}

/** The card's own "Payment to <card>" entry in its category list. */
const CARD_PAYMENT = "__card_payment";

/** "1 EUR = 1.17647 USD" from the typed amounts of a transfer between currencies, or null. */
function transferRate(
  draft: Draft,
  settings: MoneySettings,
  own: string | undefined,
  other: string | undefined,
) {
  const text = draft.transferAmount?.trim() ?? "";
  if (!own || !other || text === "") return null;
  const amount = draftAmount(draft, settings);
  const otherAmount = parseMoneyInput(text, inCurrency(settings, other));
  if (typeof amount === "string" || typeof otherAmount === "string") return null;
  return transferRateLabel(amount, own, otherAmount, other);
}

/** Which way the typed amount goes: transfers are worded by it ("Payment from …"). */
function typedDirection(amounts: { outflow: string; inflow: string }): TransferDirection {
  if (amounts.inflow.trim()) return "in";
  if (amounts.outflow.trim()) return "out";
  return null;
}

/**
 * One amount for a register whose Outflow and Inflow are folded into Amount: the figure, and a
 * sign button that turns it from an outflow into an inflow and back (as does typing "+" or "-"
 * first). `fallback` is the side an empty amount starts on.
 */
function AmountField({
  label,
  outflow,
  inflow,
  fallback,
  settings,
  inputRef,
  onBlur,
  onChange,
}: {
  /** "line 1", for a split line's. */
  label?: string;
  outflow: string;
  inflow: string;
  fallback: "outflow" | "inflow";
  /** The amount's currency and number format, to tidy what's typed when it's left. */
  settings: MoneySettings;
  inputRef?: Ref<HTMLInputElement>;
  onBlur?: () => void;
  onChange: (amounts: { outflow: string; inflow: string }) => void;
}) {
  const [chosen, setChosen] = useState(fallback);
  const side = inflow.trim() ? "inflow" : outflow.trim() ? "outflow" : chosen;
  const text = side === "inflow" ? inflow : outflow;
  const other = side === "inflow" ? "outflow" : "inflow";
  const name = side === "inflow" ? "Inflow" : "Outflow";
  function put(to: "outflow" | "inflow", value: string) {
    setChosen(to);
    onChange(to === "outflow" ? { outflow: value, inflow: "" } : { outflow: "", inflow: value });
  }
  return (
    <InputGroup className="h-8">
      <InputGroupAddon align="inline-start" className="pl-[3px]!">
        <InputGroupButton
          size="icon-xs"
          tabIndex={-1}
          aria-label={`Make it an ${other}`}
          title={`${name}. Click, or type ${other === "inflow" ? "+" : "-"} first, for an ${other}.`}
          className={cn("size-5", side === "inflow" ? "text-success" : "text-muted-foreground")}
          onClick={() => put(other, text)}
        >
          {side === "inflow" ? <Plus /> : <Minus />}
        </InputGroupButton>
      </InputGroupAddon>
      <InputGroupInput
        ref={inputRef}
        aria-label={label ? `${name}, ${label}` : name}
        placeholder={name}
        inputMode="decimal"
        value={text}
        onBlur={() => {
          const tidied = tidyAmount(text, settings);
          if (tidied !== text) put(side, tidied);
          onBlur?.();
        }}
        onChange={(e) => {
          const value = e.target.value;
          if (value.startsWith("+")) put("inflow", value.slice(1));
          else if (value.startsWith("-")) put("outflow", value.slice(1));
          else put(side, value);
        }}
        className={cn("pr-[5px] text-right tabular-nums", side === "inflow" && "text-success")}
      />
    </InputGroup>
  );
}

/**
 * A phone's amount: the figure large and centred with its currency's symbol, and an Outflow/Inflow
 * switch under it in place of a sign (typing + or - first switches it too).
 */
function HeroAmount({
  outflow,
  inflow,
  fallback,
  settings,
  autoFocus,
  onChange,
}: {
  outflow: string;
  inflow: string;
  fallback: "outflow" | "inflow";
  settings: MoneySettings;
  autoFocus: boolean;
  onChange: (amounts: { outflow: string; inflow: string }) => void;
}) {
  const id = useId();
  const [chosen, setChosen] = useState(fallback);
  const side = inflow.trim() ? "inflow" : outflow.trim() ? "outflow" : chosen;
  const text = side === "inflow" ? inflow : outflow;
  const zero = toMoneyInput(0n, settings);
  // The symbol alone: the formatted zero without its figures.
  const symbol =
    settings.currencySymbolPosition === "none"
      ? ""
      : formatAmount(money(0n, settings.currency), settings).replace(/[\d.,'\s\u00a0\u2212-]/g, "");
  const before = settings.currencySymbolPosition === "before";
  function put(to: "outflow" | "inflow", value: string) {
    setChosen(to);
    onChange(to === "outflow" ? { outflow: value, inflow: "" } : { outflow: "", inflow: value });
  }
  const mark = symbol && (
    <span aria-hidden className="font-medium text-2xl text-muted-foreground">
      {symbol}
    </span>
  );
  return (
    <div className="grid justify-items-center gap-4 pt-2">
      <label
        htmlFor={id}
        className={cn(
          "flex max-w-full items-baseline justify-center gap-1 border-b-2 px-2 transition-colors focus-within:border-primary",
          side === "inflow" && "text-success",
        )}
      >
        {before && mark}
        <input
          id={id}
          aria-label={side === "inflow" ? "Inflow" : "Outflow"}
          inputMode="decimal"
          autoComplete="off"
          // biome-ignore lint/a11y/noAutofocus: a new transaction on a phone starts with its amount
          autoFocus={autoFocus}
          placeholder={zero}
          value={text}
          // Sized to its figures, so the symbol stays beside them.
          style={{ width: `${Math.max((text || zero).length, 1) + 0.25}ch` }}
          className="h-14! min-w-0 max-w-full bg-transparent text-center font-semibold text-4xl tabular-nums tracking-tight outline-none placeholder:text-muted-foreground/40"
          onBlur={() => {
            const tidied = tidyAmount(text, settings);
            if (tidied !== text) put(side, tidied);
          }}
          onChange={(e) => {
            const value = e.target.value;
            if (value.startsWith("+")) put("inflow", value.slice(1));
            else if (value.startsWith("-")) put("outflow", value.slice(1));
            else put(side, value);
          }}
        />
        {!before && mark}
      </label>
      <ToggleGroup
        type="single"
        spacing={0}
        size="lg"
        aria-label="Money in or out"
        value={side}
        onValueChange={(value) => {
          if (value === "outflow" || value === "inflow") put(value, text);
        }}
        className="w-full max-w-72"
      >
        <ToggleGroupItem value="outflow" className="h-10! flex-1">
          <Minus aria-hidden /> Outflow
        </ToggleGroupItem>
        <ToggleGroupItem value="inflow" className="h-10! flex-1 data-[state=on]:text-success!">
          <Plus aria-hidden /> Inflow
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
