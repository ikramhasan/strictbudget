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
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import { cn } from "@strictbudget/ui/lib/utils";
import { Circle, CircleCheck, Plus, Split, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";
import type { Account } from "@/lib/accounts";
import { applyTransactionDraft, draftTransactionFromFile } from "@/lib/ai";
import { todayIso } from "@/lib/dates";
import type { Flag } from "@/lib/flags";
import { inCurrency, type MoneySettings, parseMoneyInput } from "@/lib/money-input";
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
  withSplitTotal,
} from "@/lib/transactions";
import { FlagMenu } from "./flag-menu";
import { NewAttachmentCell } from "./new-transaction-attachment";
import { type ColumnId, PINNED_BG, pinned, pinnedColumns, pinnedWidth } from "./register-columns";
import { CategoryField, DateField, listOwnsKey, PayeeField } from "./register-fields";
import { RegisterCell, RegisterRow } from "./register-table";

/** Fields that share a line in the stacked editor. */
const STACKED_ROWS: ColumnId[][] = [
  ["account"],
  ["date"],
  ["payee"],
  ["category"],
  ["memo"],
  ["outflow", "inflow"],
  ["flag", "cleared"],
  ["attachment"],
];
const STACKED_LABEL: Partial<Record<ColumnId, string>> = {
  account: "Account",
  date: "Date",
  payee: "Payee",
  category: "Category",
  memo: "Memo",
  outflow: "Outflow",
  inflow: "Inflow",
  flag: "Flag",
  cleared: "Cleared",
  attachment: "Attachment",
};

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
  layout = "row",
  pending,
  error,
  transferCategory,
  onSave,
  onSaveAndAddAnother,
  onCancel,
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
  function save(another = false) {
    // Not while the AI is still filling the row in.
    if (filling) return;
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
          />
        );
      case "account":
        return (
          <NativeSelect
            aria-label="Account"
            // First field of the row (the date is, without an account column).
            autoFocus
            value={draft.accountId}
            onChange={(e) => {
              const next = accounts.find((a) => a.id === e.target.value);
              // An account can't transfer to itself.
              const self = draft.transferAccountId === e.target.value;
              set({
                accountId: e.target.value,
                // On a new row (the one with "Save and add another") the account's starting state
                // is re-applied, over a manual toggle.
                ...(onSaveAndAddAnother ? { cleared: clearedFor(next?.type) } : {}),
                ...(self ? { payeeName: "", transferAccountId: null } : {}),
                ...(next && !usesCategory(next.type, self ? null : transferTo?.type)
                  ? { categoryId: null, lines: null }
                  : {}),
              });
            }}
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
            autoFocus={!columns.includes("account") && !focusMemo && layout !== "stacked"}
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
            onChange={({ name, transferAccountId, payee }) =>
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
              })
            }
          />
        );
      case "category":
        if (lines) {
          return (
            <p className="flex items-center gap-1.5 px-2 text-sm">
              <Split className="size-4 text-muted-foreground" />
              Split ({lines.length} lines)
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
            onSplit={canSplit ? () => setDraft(startSplit) : undefined}
            // Opens the payee list, keeping the payee and category.
            onPaymentTransfer={() => setPayeeFocus((n) => n + 1)}
            categories={pickable}
            shortcuts
            suggestedIds={payeeSuggestionIds(payees, draft)}
          />
        ) : (
          <p className="truncate px-2 text-muted-foreground text-sm italic">
            {transferCategory?.(draft.accountId, draft.transferAccountId) || "Category not needed"}
          </p>
        );
      case "memo":
        return (
          <Input
            aria-label="Memo"
            placeholder="Memo"
            autoFocus={focusMemo}
            value={draft.memo}
            onChange={(e) => set({ memo: e.target.value })}
            className="h-8"
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
        return (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={draft.cleared === "cleared" ? "Cleared" : "Uncleared"}
            aria-pressed={draft.cleared === "cleared"}
            onClick={() => set({ cleared: draft.cleared === "cleared" ? "uncleared" : "cleared" })}
          >
            {draft.cleared === "cleared" ? (
              <CircleCheck className="text-primary-text" />
            ) : (
              <Circle className="text-muted-foreground" />
            )}
          </Button>
        );
      default:
        return null;
    }
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
      case "outflow":
      case "inflow":
        return (
          <Input
            aria-label={`${column === "outflow" ? "Outflow" : "Inflow"}, ${name}`}
            placeholder={column === "outflow" ? "Outflow" : "Inflow"}
            inputMode="decimal"
            value={line[column]}
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

  const footerItems = (
    <>
      {lines && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => set({ lines: [...lines, emptyLine()] })}
          >
            <Plus /> Add line
          </Button>
          <p
            className={cn(
              "mr-auto text-sm tabular-nums",
              remaining !== null && remaining !== 0n ? "text-destructive" : "text-muted-foreground",
            )}
            aria-live="polite"
          >
            {remaining === null ? "Check the amounts" : remainingLabel(remaining, settings)}
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
      <Button type="button" variant="outline" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="button" size="sm" onClick={() => save()} disabled={pending || filling}>
        Save
      </Button>
      {onSaveAndAddAnother && (
        <Button type="button" size="sm" onClick={() => save(true)} disabled={pending || filling}>
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

  // A phone edits in a drawer: the same fields, one under another, with their names.
  if (layout === "stacked") {
    const stacked = STACKED_ROWS.flat().filter(
      (c) =>
        columns.includes(c) ||
        c === "flag" ||
        c === "cleared" ||
        (c === "attachment" && newAttachment !== undefined),
    );
    return (
      <form
        aria-label={label}
        className="grid gap-3"
        onKeyDown={handleKeyDown}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {STACKED_ROWS.map((row) => {
          const fields = row
            .filter((column) => stacked.includes(column))
            .map((column) => ({ column, field: cell(column) }))
            .filter(({ field }) => field);
          if (fields.length === 0) return null;
          return (
            <div key={row.join()} className="grid auto-cols-fr grid-flow-col gap-3">
              {fields.map(({ column, field }) => (
                <div key={column} className="grid gap-1.5 [&_button]:min-h-11 [&_input]:h-11">
                  <span className="text-muted-foreground text-xs">{STACKED_LABEL[column]}</span>
                  {field}
                </div>
              ))}
            </div>
          );
        })}
        {lines?.map((line, index) => (
          <fieldset key={line.key} className="grid gap-2 rounded-lg border p-3 [&_input]:h-11">
            <legend className="px-1 text-muted-foreground text-xs">Split line {index + 1}</legend>
            {(["payee", "category", "memo", "outflow", "inflow", "actions"] as const).map(
              (column) => (
                <div key={column}>{lineCell(line, index, column)}</div>
              ),
            )}
          </fieldset>
        ))}
        <div className="flex flex-wrap items-center justify-end gap-2 [&>button]:min-h-11 [&>button]:flex-1">
          {footerItems}
        </div>
        {mismatchDialog}
      </form>
    );
  }

  return (
    <>
      <RegisterRow
        still
        aria-label={label}
        className="not-last:*:border-b-0 bg-muted/50"
        onKeyDown={handleKeyDown}
      >
        {columns.map((column) => (
          <RegisterCell
            key={column}
            style={pinned(columns, column)?.style}
            className={cn(
              "px-1.5",
              (column === "cleared" || column === "flag" || column === "attachment") &&
                "text-center",
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
          aria-label={`Split line ${index + 1}`}
          className="not-last:*:border-b-0 bg-muted/50"
          onKeyDown={handleKeyDown}
        >
          {columns.map((column) => (
            <RegisterCell
              key={column}
              style={pinned(columns, column)?.style}
              className={cn(
                "px-1.5 py-1",
                pinned(columns, column) && [pinned(columns, column)?.className, PINNED_BG.editor],
              )}
            >
              {lineCell(line, index, column)}
            </RegisterCell>
          ))}
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
            className="sticky left-1.5 flex max-w-full flex-wrap items-center justify-end gap-2 whitespace-normal"
            style={{ width: `calc(100cqw - 0.75rem - ${pinnedWidth(columns)})` }}
          >
            {footerItems}
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
