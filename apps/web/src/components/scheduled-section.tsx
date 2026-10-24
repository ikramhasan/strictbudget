import { formatDate, money, SCHEDULE_FREQUENCY_LABELS, usesCategory } from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import { Checkbox } from "@strictbudget/ui/components/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@strictbudget/ui/components/dropdown-menu";
import { cn } from "@strictbudget/ui/lib/utils";
import {
  ArrowLeftRight,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Repeat,
  Split,
  Trash2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import type { Account } from "@/lib/accounts";
import { $api, apiClient } from "@/lib/api";
import { useBudget } from "@/lib/budget-context";
import { apiErrorMessage } from "@/lib/budgets";
import type { Flag, FlagColor } from "@/lib/flags";
import { inCurrency } from "@/lib/money-input";
import {
  draftFromScheduled,
  type ScheduledTransaction,
  scheduleRestoreBody,
  scheduleUpdateBody,
} from "@/lib/scheduled";
import { type CategoryOption, type Draft, movableAccounts, type Payee } from "@/lib/transactions";
import { useUndo } from "@/lib/undo";
import { AccountLogo } from "./accounts-nav";
import { FlagMenu } from "./flag-menu";
import { COLUMN_SPECS, type ColumnId, isEditable, PINNED_BG, pinned } from "./register-columns";
import { RegisterCell, RegisterRow } from "./register-table";
import { ScheduledAttachmentCell } from "./transaction-attachment";
import { TransactionEditor } from "./transaction-editor";

/**
 * A scheduled row's tint, on every cell (as RegisterRow paints its states), and its selected tint,
 * which also holds on hover.
 */
const SCHEDULED_ROW =
  "*:bg-[color-mix(in_oklab,var(--muted)_40%,var(--background))] data-selected:*:bg-[color-mix(in_oklab,var(--primary)_10%,var(--background))] data-selected:hover:*:bg-[color-mix(in_oklab,var(--primary)_14%,var(--background))]";

/**
 * One row per schedule (its next occurrence), plus the other account's side of scheduled
 * transfers. Editing a row changes it and every later occurrence. A split's transfer line in the
 * other account is only entered from there; it's edited and deleted through its split.
 */
export function ScheduledSection({
  rows,
  columns,
  collapsed,
  onToggle,
  accounts,
  payees,
  categories,
  flags,
  onRenameFlags,
  today,
  onChanged,
  selected,
  onSelect,
}: {
  rows: readonly ScheduledTransaction[];
  columns: readonly ColumnId[];
  collapsed: boolean;
  onToggle: () => void;
  accounts: readonly Account[];
  payees: readonly Payee[];
  categories: readonly CategoryOption[];
  flags: readonly Flag[];
  onRenameFlags: (changes: Flag[]) => Promise<void>;
  today: string;
  onChanged: () => Promise<void>;
  selected: ReadonlySet<string>;
  onSelect: (id: string, on: boolean, shift: boolean) => void;
}) {
  // A viewer sees the schedules but can't change or enter them.
  const { budget, formatAmount, readOnly: viewer } = useBudget();
  const history = useUndo();
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const update = $api.useMutation(
    "patch",
    "/v1/budgets/{budgetId}/scheduled-transactions/{scheduledTransactionId}",
  );
  const create = $api.useMutation("post", "/v1/budgets/{budgetId}/scheduled-transactions");
  const remove = $api.useMutation(
    "delete",
    "/v1/budgets/{budgetId}/scheduled-transactions/{scheduledTransactionId}",
  );
  const enter = $api.useMutation(
    "post",
    "/v1/budgets/{budgetId}/scheduled-transactions/{scheduledTransactionId}/enter",
  );
  const removeTransaction = $api.useMutation(
    "delete",
    "/v1/budgets/{budgetId}/transactions/{transactionId}",
  );
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const show = (amount: bigint, currency: string) =>
    formatAmount(money(amount, inCurrency(budget, currency).currency));
  const path = (scheduledTransactionId: string) => ({
    params: { path: { budgetId: budget.id, scheduledTransactionId } },
  });

  if (rows.length === 0) return null;

  /** Whether `row`'s side takes a category (not tracking accounts, nor in-budget transfers). */
  function categorized(row: ScheduledTransaction) {
    const type = accountById.get(row.accountId)?.type ?? "checking";
    const to = row.transferAccountId ? accountById.get(row.transferAccountId)?.type : null;
    return usesCategory(type, to);
  }

  /** The schedule as its own account has it (undo restores from this). */
  async function ownRow(row: ScheduledTransaction) {
    if (row.kind === "schedule") return row;
    const { data, error } = await apiClient.GET("/v1/budgets/{budgetId}/scheduled-transactions", {
      params: { path: { budgetId: budget.id } },
    });
    if (error) throw error;
    const own = data.scheduledTransactions.find((r) => r.id === row.scheduledTransactionId);
    if (!own) throw new Error("Scheduled transaction not found");
    return own;
  }

  /** Puts a schedule back as it was; returns its (possibly new) id. */
  async function restore(before: ScheduledTransaction, currentId: string | null) {
    const body = { ...scheduleRestoreBody(before), today };
    if (currentId) {
      await update.mutateAsync({ ...path(currentId), body });
      return currentId;
    }
    const created = await create.mutateAsync({
      params: { path: { budgetId: budget.id } },
      body,
    });
    return created.scheduledTransaction?.id ?? null;
  }

  async function save(row: ScheduledTransaction, draft: Draft) {
    if (!draft.date) return setError("Enter a date.");
    const settings = inCurrency(budget, accountById.get(draft.accountId)?.currency);
    const result = scheduleUpdateBody(row, draft, settings, today, categorized(row));
    if (!result.ok) return setError(result.error);
    try {
      const before = await ownRow(row);
      const after = await update.mutateAsync({
        ...path(row.scheduledTransactionId),
        body: result.body,
      });
      let entered = after.enteredTransactionId;
      let current = after.scheduledTransaction ? before.id : null;
      history.record({
        label: "scheduled transaction edit",
        undo: async () => {
          // The schedule first: if it can't come back, the entered transaction stays.
          current = await restore(before, current);
          if (entered) {
            await removeTransaction.mutateAsync({
              params: { path: { budgetId: budget.id, transactionId: entered } },
            });
          }
          await onChanged();
        },
        redo: async () => {
          if (!current) return;
          const again = await update.mutateAsync({ ...path(current), body: result.body });
          entered = again.enteredTransactionId;
          if (!again.scheduledTransaction) current = null;
          await onChanged();
        },
      });
      setEditing(null);
      await onChanged();
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't save the scheduled transaction."));
    }
  }

  async function enterNow(row: ScheduledTransaction) {
    try {
      const before = await ownRow(row);
      const result = await enter.mutateAsync({
        ...path(row.scheduledTransactionId),
        body: { today },
      });
      let enteredId = result.transaction.id;
      let current = result.scheduledTransaction ? before.id : null;
      history.record({
        label: "enter scheduled transaction",
        undo: async () => {
          current = await restore(before, current);
          await removeTransaction.mutateAsync({
            params: { path: { budgetId: budget.id, transactionId: enteredId } },
          });
          await onChanged();
        },
        redo: async () => {
          if (!current) return;
          const again = await enter.mutateAsync({ ...path(current), body: { today } });
          enteredId = again.transaction.id;
          if (!again.scheduledTransaction) current = null;
          await onChanged();
        },
      });
      await onChanged();
      toast.success("Transaction entered");
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't enter the transaction."));
    }
  }

  async function deleteSchedule(row: ScheduledTransaction) {
    try {
      const before = await ownRow(row);
      await remove.mutateAsync(path(before.id));
      let current: string | null = null;
      history.record({
        label: "deleted scheduled transaction",
        undo: async () => {
          current = await restore(before, null);
          await onChanged();
        },
        redo: async () => {
          if (!current) return;
          await remove.mutateAsync(path(current));
          current = null;
          await onChanged();
        },
      });
      await onChanged();
      toast.success("Scheduled transaction deleted");
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't delete the scheduled transaction."));
    }
  }

  async function setFlag(row: ScheduledTransaction, flag: FlagColor | null) {
    const old = row.flag;
    const send = (value: FlagColor | null) =>
      update.mutateAsync({ ...path(row.scheduledTransactionId), body: { flag: value, today } });
    try {
      await send(flag);
      history.record({
        label: "scheduled transaction flag",
        undo: async () => {
          await send(old);
          await onChanged();
        },
        redo: async () => {
          await send(flag);
          await onChanged();
        },
      });
      await onChanged();
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't change the flag."));
    }
  }

  function open(row: ScheduledTransaction) {
    if (row.kind === "splitTransfer" || viewer) return;
    setError(null);
    setEditing({ id: row.id, draft: draftFromScheduled(row, inCurrency(budget, row.currency)) });
  }

  function display(row: ScheduledTransaction, id: ColumnId) {
    const amount = BigInt(row.amount);
    switch (id) {
      case "select":
        return (
          <Checkbox
            aria-label={`Select scheduled ${row.payeeName ?? "transaction"} on ${formatDate(
              row.dateNext,
              budget.dateFormat,
            )}`}
            checked={selected.has(row.id)}
            onClick={(e) => {
              e.preventDefault();
              onSelect(row.id, !selected.has(row.id), e.shiftKey);
            }}
          />
        );
      case "attachment":
        return <ScheduledAttachmentCell />;
      case "flag":
        return row.kind === "splitTransfer" || viewer ? null : (
          <FlagMenu
            value={row.flag}
            flags={flags}
            onChange={(flag) => void setFlag(row, flag)}
            onRename={onRenameFlags}
          />
        );
      case "account":
        return (
          <span className="flex min-w-0 items-center gap-2">
            <AccountLogo
              name={row.accountName}
              logo={accountById.get(row.accountId)?.logo ?? null}
            />
            <span className="truncate">{row.accountName}</span>
          </span>
        );
      case "date": {
        const repeats = row.frequency !== "never" && row.kind !== "splitTransfer";
        return (
          <span className="flex items-center justify-between gap-1">
            {formatDate(row.dateNext, budget.dateFormat)}
            {repeats && (
              <Repeat
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-label={`Repeats: ${SCHEDULE_FREQUENCY_LABELS[row.frequency]}`}
              >
                <title>{SCHEDULE_FREQUENCY_LABELS[row.frequency]}</title>
              </Repeat>
            )}
          </span>
        );
      }
      case "payee":
        return row.transferAccountId ? (
          <span className="flex min-w-0 items-center gap-1">
            <ArrowLeftRight className="size-3.5 shrink-0" aria-label="Transfer" />
            <span className="truncate">{row.payeeName}</span>
          </span>
        ) : (
          row.payeeName
        );
      case "category":
        if (row.subtransactions.length > 0) {
          const count = new Set(row.subtransactions.map((l) => l.categoryId ?? l.transferAccountId))
            .size;
          return (
            <span className="flex items-center gap-1.5">
              <Split className="size-4 shrink-0" />
              <span className="truncate">
                Split ({count} {count === 1 ? "category" : "categories"})
              </span>
            </span>
          );
        }
        return categorized(row) ? row.categoryName : "";
      case "memo":
        return row.memo;
      case "outflow":
        return amount < 0n ? show(-amount, row.currency) : "";
      case "inflow":
        return amount > 0n ? show(amount, row.currency) : "";
      case "actions":
        return viewer ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Scheduled transaction actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void enterNow(row)}>
                <CalendarClock /> Enter Now
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={row.kind === "splitTransfer"}
                onSelect={() => void deleteSchedule(row)}
              >
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      default:
        return null;
    }
  }

  const span = columns.length;
  return (
    <>
      <RegisterRow still className="bg-muted">
        <RegisterCell colSpan={span} className="py-1.5">
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={onToggle}
            className="ml-8 inline-flex items-center gap-1.5 font-medium text-sm"
          >
            <CalendarDays className="size-4 text-muted-foreground" />
            Scheduled Transactions
            {collapsed ? (
              <ChevronRight className="size-4" aria-hidden />
            ) : (
              <ChevronDown className="size-4" aria-hidden />
            )}
          </button>
        </RegisterCell>
      </RegisterRow>
      {!collapsed &&
        rows.map((row) => {
          if (editing?.id === row.id) {
            return (
              <TransactionEditor
                key={row.id}
                initial={editing.draft}
                label="Edit scheduled transaction"
                columns={columns}
                accounts={accounts.filter((a) => !a.closed || a.id === row.accountId)}
                accountChoices={movableAccounts(accounts, row)}
                payees={payees}
                categories={categories}
                dateFormat={budget.dateFormat}
                settings={budget}
                flags={flags}
                onRenameFlags={onRenameFlags}
                repeat
                scheduled
                pending={update.isPending}
                error={error}
                onSave={(draft) => void save(row, draft)}
                onCancel={() => setEditing(null)}
              />
            );
          }
          const readOnly = row.kind === "splitTransfer";
          return [
            <RegisterRow
              key={row.id}
              aria-label={`Scheduled: ${row.payeeName ?? "transaction"} on ${formatDate(
                row.dateNext,
                budget.dateFormat,
              )}`}
              data-selected={selected.has(row.id) || undefined}
              className={SCHEDULED_ROW}
            >
              {columns.map((id) => {
                const spec = COLUMN_SPECS[id];
                const editable = !readOnly && !viewer && isEditable(id);
                const pin = pinned(columns, id);
                return (
                  <RegisterCell
                    key={id}
                    style={pin?.style}
                    className={cn(
                      "truncate",
                      pin && [pin.className, PINNED_BG.scheduled],
                      spec.align === "right" && "text-right tabular-nums",
                      spec.align === "center" && "py-1 text-center",
                      id === "flag" && "px-1",
                      id === "actions" && "py-1",
                      (id === "category" || id === "memo") && "text-muted-foreground",
                      editable && "cursor-text",
                    )}
                    onClick={editable ? () => open(row) : undefined}
                  >
                    {display(row, id)}
                  </RegisterCell>
                );
              })}
            </RegisterRow>,
            ...row.subtransactions.map((line) => {
              const lineAmount = BigInt(line.amount);
              const type = accountById.get(row.accountId)?.type ?? "checking";
              const to = line.transferAccountId
                ? accountById.get(line.transferAccountId)?.type
                : null;
              const cells: Partial<Record<ColumnId, ReactNode>> = {
                payee: (
                  <span className="flex min-w-0 items-center gap-1 pl-4">
                    {line.transferAccountId && (
                      <ArrowLeftRight className="size-3.5 shrink-0" aria-label="Transfer" />
                    )}
                    <span className="truncate">{line.payeeName}</span>
                  </span>
                ),
                category: usesCategory(type, to) ? line.categoryName : "",
                memo: line.memo,
                outflow: lineAmount < 0n ? show(-lineAmount, row.currency) : "",
                inflow: lineAmount > 0n ? show(lineAmount, row.currency) : "",
              };
              return (
                <RegisterRow
                  key={`${row.id}:${line.id}`}
                  aria-label={`Split line of ${row.payeeName ?? "scheduled transaction"}`}
                  className="bg-muted/40 text-muted-foreground text-xs"
                >
                  {columns.map((id) => (
                    <RegisterCell
                      key={id}
                      style={pinned(columns, id)?.style}
                      className={cn(
                        "truncate py-1.5",
                        pinned(columns, id) && [
                          pinned(columns, id)?.className,
                          PINNED_BG.scheduled,
                        ],
                        COLUMN_SPECS[id].align === "right" && "text-right tabular-nums",
                        isEditable(id) && "cursor-text",
                      )}
                      onClick={isEditable(id) && !viewer ? () => open(row) : undefined}
                    >
                      {cells[id] ?? null}
                    </RegisterCell>
                  ))}
                </RegisterRow>
              );
            }),
          ];
        })}
    </>
  );
}
