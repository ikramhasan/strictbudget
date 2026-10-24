import type { components } from "@strictbudget/api-client";
import { type CurrencyCode, money } from "@strictbudget/engine";
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
import { Input } from "@strictbudget/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { cn } from "@strictbudget/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Ghost, Redo2, Search, Undo2 } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { accountsQueryOptions } from "@/lib/accounts";
import { $api } from "@/lib/api";
import { useBudget } from "@/lib/budget-context";
import { apiErrorCode, apiErrorMessage } from "@/lib/budgets";
import { scheduledQueryPrefix } from "@/lib/scheduled";
import {
  type Payee,
  payeesQueryOptions,
  transactionsQueryPrefix,
  transferLabel,
} from "@/lib/transactions";
import type { UndoCommand } from "@/lib/undo";
import { type CategorizationChange, PayeeCategorizationSection } from "./payee-categorization";
import {
  PayeeRenamingRules,
  type PayeeRule,
  payeeRulesQueryOptions,
  RenamingRulesGear,
} from "./payee-renaming-rules";

type Snapshot = components["schemas"]["PayeeSnapshot"];

const ManagePayeesContext = createContext<(() => void) | null>(null);

/** Opens the Manage Payees dialog from anywhere in a budget (plan menu, payee field). */
export function useManagePayees() {
  return useContext(ManagePayeesContext);
}

export function ManagePayeesProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  return (
    <ManagePayeesContext.Provider value={show}>
      {children}
      {open && <ManagePayeesDialog onClose={() => setOpen(false)} />}
    </ManagePayeesContext.Provider>
  );
}

const HIDDEN_HELP =
  "Hidden payees will not be suggested as you type or included in the list of payees when " +
  "adding a transaction. This is useful for payees you don't expect to use again, like from a " +
  "trip or event.";

type GroupId = "payees" | "transfers" | "hidden";

/** Transfer payees are listed but can't be changed. */
function ManagePayeesDialog({ onClose }: { onClose: () => void }) {
  const { budget } = useBudget();
  const queryClient = useQueryClient();
  const path = { budgetId: budget.id };
  const payeesQuery = useQuery(payeesQueryOptions(budget.id));
  const accountsQuery = useQuery(accountsQueryOptions(budget.id));
  const payees = payeesQuery.data?.payees ?? [];
  const rulesQuery = useQuery(payeeRulesQueryOptions(budget.id));
  const { rulesByPayee, transferPayeeIds } = useMemo(() => {
    const byPayee = new Map<string, PayeeRule[]>();
    for (const rule of rulesQuery.data?.rules ?? []) {
      byPayee.set(rule.payeeId, [...(byPayee.get(rule.payeeId) ?? []), rule]);
    }
    const transfers = new Map(
      (rulesQuery.data?.transferPayees ?? []).map((t) => [`transfer:${t.accountId}`, t.payeeId]),
    );
    return { rulesByPayee: byPayee, transferPayeeIds: transfers };
  }, [rulesQuery.data]);
  /** A list item's payee id (transfer items are keyed by account). */
  const payeeIdOf = (itemId: string) => transferPayeeIds.get(itemId) ?? itemId;
  const hasRules = (itemId: string) => rulesByPayee.has(payeeIdOf(itemId));

  const update = $api.useMutation("patch", "/v1/budgets/{budgetId}/payees/{payeeId}");
  const hide = $api.useMutation("post", "/v1/budgets/{budgetId}/payees/hide");
  const combine = $api.useMutation("post", "/v1/budgets/{budgetId}/payees/combine");
  const remove = $api.useMutation("post", "/v1/budgets/{budgetId}/payees/delete");
  const restore = $api.useMutation("post", "/v1/budgets/{budgetId}/payees/restore");

  const [search, setSearch] = useState("");
  /** Payee ids in the order they were ticked (the first names a combine), or one transfer. */
  const [selected, setSelected] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Record<GroupId, boolean>>({
    payees: false,
    transfers: true,
    hidden: true,
  });
  const [past, setPast] = useState<UndoCommand[]>([]);
  const [future, setFuture] = useState<UndoCommand[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transfers = useMemo(
    () =>
      (accountsQuery.data?.accounts ?? []).map((a) => ({
        id: `transfer:${a.id}`,
        name: transferLabel(a.name),
      })),
    [accountsQuery.data],
  );
  const matches = (name: string) => name.toLowerCase().includes(search.trim().toLowerCase());
  const groups: { id: GroupId; label: string; items: { id: string; name: string }[] }[] = [
    { id: "payees", label: "Payees", items: payees.filter((p) => !p.hidden && matches(p.name)) },
    { id: "transfers", label: "Transfer Payees", items: transfers.filter((t) => matches(t.name)) },
    {
      id: "hidden",
      label: "Hidden Payees",
      items: payees.filter((p) => p.hidden && matches(p.name)),
    },
  ];
  const unused = payees.filter((p) => p.useCount === 0);

  const byId = new Map(payees.map((p) => [p.id, p]));
  const picked = selected.map((id) => byId.get(id)).filter((p): p is Payee => p !== undefined);
  const pickedTransfer = transfers.find((t) => selected[0] === t.id);

  // Drop selections that no longer exist (deleted, combined, or undone away).
  useEffect(() => {
    if (!payeesQuery.data || !accountsQuery.data) return;
    setSelected((ids) => {
      const kept = ids.filter((id) => byId.has(id) || transfers.some((t) => t.id === id));
      return kept.length === ids.length ? ids : kept;
    });
  });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: payeesQueryOptions(budget.id).queryKey }),
      queryClient.invalidateQueries({ queryKey: payeeRulesQueryOptions(budget.id).queryKey }),
      queryClient.invalidateQueries({ queryKey: transactionsQueryPrefix }),
      queryClient.invalidateQueries({ queryKey: scheduledQueryPrefix }),
      queryClient.invalidateQueries({
        queryKey: ["get", "/v1/budgets/{budgetId}/payees/transactions"],
      }),
    ]);
  }

  /** Runs a change, records it for the dialog's Undo, and refreshes what shows payees. */
  async function run(command: UndoCommand & { first?: () => Promise<void> }) {
    setBusy(true);
    setError(null);
    try {
      await (command.first ?? command.redo)();
      setPast((list) => [...list, command]);
      setFuture([]);
    } catch (e) {
      setError(
        apiErrorCode(e) === "PAYEE_NAME_TAKEN"
          ? "Another payee already exists with this name"
          : apiErrorMessage(e, "Couldn't save the change. Try again."),
      );
      throw e;
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function step(direction: "undo" | "redo") {
    const from = direction === "undo" ? past : future;
    const command = from.at(-1);
    if (!command || busy) return;
    setBusy(true);
    setError(null);
    try {
      await command[direction]();
      if (direction === "undo") {
        setPast((list) => list.slice(0, -1));
        setFuture((list) => [...list, command]);
      } else {
        setFuture((list) => list.slice(0, -1));
        setPast((list) => [...list, command]);
      }
      setSelected([]);
    } catch (e) {
      setError(apiErrorMessage(e, `Couldn't ${direction}. Try again.`));
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  const rename = (p: Payee, name: string) =>
    run({
      label: "Rename payee",
      undo: async () => {
        await update.mutateAsync({
          params: { path: { ...path, payeeId: p.id } },
          body: { name: p.name },
        });
      },
      redo: async () => {
        await update.mutateAsync({ params: { path: { ...path, payeeId: p.id } }, body: { name } });
      },
    });

  const categorize = (p: Payee, change: CategorizationChange) => {
    // `restore`: undo and redo bring back a choice even if its category was hidden since.
    const apply = (body: CategorizationChange, restore: boolean) => async () => {
      await update.mutateAsync({
        params: { path: { ...path, payeeId: p.id } },
        body: { ...body, restore },
      });
    };
    return run({
      label: "Change categorization",
      undo: apply(
        { categorization: p.categorization, defaultCategoryId: p.defaultCategoryId },
        true,
      ),
      redo: apply(change, false),
    });
  };

  const setHidden = (ids: string[], hidden: boolean) => {
    const apply = (value: boolean) => () =>
      hide.mutateAsync({ params: { path }, body: { payeeIds: ids, hidden: value } }).then(() => {});
    return run({
      label: hidden ? "Hide payees" : "Unhide payees",
      undo: apply(!hidden),
      redo: apply(hidden),
    }).then(() => setSelected([]));
  };

  /** Combine and delete can be undone by restoring what they changed; redo re-runs them. */
  function restorable(label: string, action: () => Promise<Snapshot>) {
    let snapshot: Snapshot | null = null;
    const redo = async () => {
      snapshot = await action();
    };
    return run({
      label,
      redo,
      undo: async () => {
        if (snapshot) await restore.mutateAsync({ params: { path }, body: snapshot });
      },
    }).then(() => setSelected([]));
  }

  const combineInto = (name: string) =>
    restorable("Combine payees", async () => {
      const result = await combine.mutateAsync({
        params: { path },
        body: { payeeIds: selected, name },
      });
      return result.snapshot;
    });

  const deleteSelected = (replacementPayeeId: string | null) => {
    const payeeIds = [...selected];
    return restorable("Delete payees", async () => {
      const result = await remove.mutateAsync({
        params: { path },
        body: { payeeIds, replacementPayeeId },
      });
      return result.snapshot;
    });
  };

  function toggle(id: string, on: boolean) {
    setError(null);
    if (id.startsWith("transfer:")) {
      setSelected(on ? [id] : []);
      return;
    }
    setSelected((ids) => {
      const payeeIds = ids.filter((x) => !x.startsWith("transfer:"));
      return on ? [...payeeIds.filter((x) => x !== id), id] : payeeIds.filter((x) => x !== id);
    });
  }

  function toggleGroup(items: { id: string }[], on: boolean) {
    setError(null);
    const ids = items.map((i) => i.id);
    if (ids.some((id) => id.startsWith("transfer:"))) {
      // Transfer payees are looked at one at a time.
      if (!on) setSelected([]);
      return;
    }
    setSelected((current) => {
      const rest = current.filter((x) => !x.startsWith("transfer:") && !ids.includes(x));
      return on ? [...rest, ...ids] : rest;
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[min(44rem,90vh)] flex-col gap-0 p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>Manage Payees</DialogTitle>
          <DialogDescription className="sr-only">
            Rename, combine, hide and delete the budget's payees.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-[17rem_1fr]">
          <div className="flex min-h-0 flex-col border-r">
            <div className="relative p-2">
              <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search payees"
                placeholder="Search Payees"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-8"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-2">
              {payeesQuery.isPending ? (
                <Skeleton className="m-2 h-24" />
              ) : (
                groups.map((group) => {
                  if (group.id === "hidden" && !payees.some((p) => p.hidden)) return null;
                  const count = group.items.filter((i) => selected.includes(i.id)).length;
                  const all = group.items.length > 0 && count === group.items.length;
                  return (
                    <section key={group.id} aria-label={group.label}>
                      <div className="flex items-center gap-1.5 px-2 py-1">
                        <button
                          type="button"
                          aria-label={`${collapsed[group.id] ? "Expand" : "Collapse"} ${group.label}`}
                          aria-expanded={!collapsed[group.id]}
                          className="rounded-sm text-muted-foreground hover:text-foreground"
                          onClick={() => setCollapsed((c) => ({ ...c, [group.id]: !c[group.id] }))}
                        >
                          {collapsed[group.id] ? (
                            <ChevronRight className="size-4" />
                          ) : (
                            <ChevronDown className="size-4" />
                          )}
                        </button>
                        <Checkbox
                          aria-label={`Select all ${group.label}`}
                          checked={all ? true : count > 0 ? "indeterminate" : false}
                          disabled={group.items.length === 0}
                          onCheckedChange={(v) => toggleGroup(group.items, v === true)}
                        />
                        <span className="font-semibold text-sm">
                          {group.label}
                          {count > 0 && ` (${count})`}
                        </span>
                      </div>
                      {!collapsed[group.id] &&
                        group.items.map((item) => {
                          const on = selected.includes(item.id);
                          return (
                            <div
                              key={item.id}
                              className={cn(
                                "relative flex items-center gap-2 py-1 pr-2 pl-8",
                                on && "bg-muted",
                              )}
                            >
                              {hasRules(item.id) && (
                                <span className="absolute left-3.5 flex">
                                  <RenamingRulesGear />
                                </span>
                              )}
                              <Checkbox
                                aria-label={`Select ${item.name}`}
                                checked={on}
                                onCheckedChange={(v) => toggle(item.id, v === true)}
                              />
                              <button
                                type="button"
                                className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
                                onClick={() => {
                                  setError(null);
                                  setSelected([item.id]);
                                }}
                              >
                                {item.name}
                              </button>
                            </div>
                          );
                        })}
                    </section>
                  );
                })
              )}
              {unused.length > 0 && (
                <button
                  type="button"
                  className="px-3 py-1 text-primary-text text-sm underline underline-offset-4 hover:no-underline"
                  onClick={() => {
                    setError(null);
                    setSelected(unused.map((p) => p.id));
                  }}
                >
                  Select {unused.length} Unused {unused.length === 1 ? "Payee" : "Payees"}
                </button>
              )}
            </div>
          </div>
          <div className="min-h-0 overflow-y-auto bg-muted/40 p-4">
            {pickedTransfer ? (
              <div className="grid gap-3">
                <p className="font-semibold text-sm">{pickedTransfer.name}</p>
                {transferPayeeIds.has(pickedTransfer.id) && (
                  <PayeeRenamingRules
                    // Fresh drafts for each payee.
                    key={pickedTransfer.id}
                    budgetId={budget.id}
                    payeeId={payeeIdOf(pickedTransfer.id)}
                    rules={rulesByPayee.get(payeeIdOf(pickedTransfer.id)) ?? []}
                    run={run}
                    disabled={busy}
                  />
                )}
                <p className="rounded-md bg-primary/10 p-3 text-sm">
                  Transfer payees are used to move money between accounts, including credit card
                  payments. strictbudget creates these for you, so they can't be edited or deleted.
                </p>
              </div>
            ) : picked.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                <Ghost className="size-16" strokeWidth={1.25} />
                <p className="text-foreground text-sm">Select a payee to edit.</p>
              </div>
            ) : (
              <PayeeEditor
                // A fresh editor (name draft, delete step) for each selection.
                key={selected.join(",")}
                picked={picked}
                payees={payees}
                busy={busy}
                error={error}
                anyRules={picked.some((p) => rulesByPayee.has(p.id))}
                renaming={
                  picked.length === 1 && (
                    <PayeeRenamingRules
                      budgetId={budget.id}
                      payeeId={(picked[0] as Payee).id}
                      rules={rulesByPayee.get((picked[0] as Payee).id) ?? []}
                      run={run}
                      disabled={busy}
                    />
                  )
                }
                onError={setError}
                onRename={(p, name) => rename(p, name).catch(() => {})}
                onCategorize={(p, change) => categorize(p, change).catch(() => {})}
                onCombine={(name) => combineInto(name).catch(() => {})}
                onHide={(hidden) =>
                  setHidden(
                    picked.map((p) => p.id),
                    hidden,
                  ).catch(() => {})
                }
                onDelete={(replacement) => deleteSelected(replacement).catch(() => {})}
              />
            )}
          </div>
        </div>
        <DialogFooter className="m-0 flex-row items-center justify-between border-t px-4 py-3 sm:justify-between">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={past.length === 0 || busy}
              onClick={() => step("undo")}
            >
              <Undo2 /> Undo
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={future.length === 0 || busy}
              onClick={() => step("redo")}
            >
              <Redo2 /> Redo
            </Button>
          </div>
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayeeEditor({
  picked,
  payees,
  busy,
  error,
  anyRules,
  renaming,
  onError,
  onRename,
  onCategorize,
  onCombine,
  onHide,
  onDelete,
}: {
  picked: Payee[];
  payees: readonly Payee[];
  busy: boolean;
  error: string | null;
  anyRules: boolean;
  renaming: ReactNode;
  onError: (message: string | null) => void;
  onRename: (payee: Payee, name: string) => Promise<void>;
  onCategorize: (payee: Payee, change: CategorizationChange) => Promise<void>;
  onCombine: (name: string) => Promise<void>;
  onHide: (hidden: boolean) => Promise<void>;
  onDelete: (replacementPayeeId: string | null) => Promise<void>;
}) {
  const first = picked[0] as Payee;
  const single = picked.length === 1;
  const [name, setName] = useState(first.name);
  const [deleting, setDeleting] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [showing, setShowing] = useState(false);
  const uses = picked.reduce((sum, p) => sum + p.useCount, 0);
  const allHidden = picked.every((p) => p.hidden);
  const ids = new Set(picked.map((p) => p.id));
  // Offers the other payees that are in use, hidden ones included.
  const replacements = payees.filter((p) => !ids.has(p.id) && p.useCount > 0);

  function commitName() {
    const trimmed = name.trim();
    if (!trimmed) {
      onError("Payee name cannot be empty");
      return;
    }
    onError(null);
    if (trimmed !== first.name) void onRename(first, trimmed);
  }

  const usesLink =
    uses > 0 ? (
      <button
        type="button"
        className="w-fit text-primary-text text-sm underline underline-offset-4 hover:no-underline"
        onClick={() => setShowing(true)}
      >
        Show {uses} {uses === 1 ? "Transaction" : "Transactions"}
      </button>
    ) : (
      single && <p className="text-muted-foreground text-sm">No Transactions</p>
    );

  return (
    <div
      className={cn(
        "grid gap-3",
        deleting && "[&>.dimmed]:pointer-events-none [&>.dimmed]:opacity-50",
      )}
    >
      {single ? (
        <section className="dimmed grid gap-2 rounded-lg border bg-background p-4">
          <label htmlFor="payee-name" className="font-semibold text-sm">
            Payee Name
          </label>
          <Input
            id="payee-name"
            value={name}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
            }}
          />
          {error && (
            <p
              role="alert"
              className="rounded-md bg-destructive/15 px-2 py-1 text-destructive text-sm"
            >
              {error}
            </p>
          )}
          {usesLink}
        </section>
      ) : (
        <>
          <div className="dimmed grid gap-1">
            <div className="flex items-baseline gap-3">
              <p className="font-semibold text-sm">{picked.length} Payees Selected</p>
              {usesLink}
            </div>
            <p className="text-muted-foreground text-sm">{picked.map((p) => p.name).join(", ")}</p>
          </div>
          <section className="dimmed grid gap-2 rounded-lg border bg-background p-4">
            <p className="font-semibold text-sm">Combine and Rename</p>
            <p className="text-muted-foreground text-sm">
              Combining these payees will also combine all their renaming rules and categorization
              rules.
            </p>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = name.trim();
                if (!trimmed) return onError("Payee name cannot be empty");
                void onCombine(trimmed);
              }}
            >
              <Input
                aria-label="Combined payee name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button type="submit" disabled={busy}>
                Combine
              </Button>
            </form>
            {error && (
              <p
                role="alert"
                className="rounded-md bg-destructive/15 px-2 py-1 text-destructive text-sm"
              >
                {error}
              </p>
            )}
          </section>
        </>
      )}

      {single && (
        <PayeeCategorizationSection
          payee={first}
          busy={busy}
          onChange={(change) => onCategorize(first, change)}
        />
      )}
      {renaming}

      {deleting ? (
        <section className="grid gap-2">
          <label htmlFor="replacement-payee" className="font-semibold text-sm">
            New payee
          </label>
          <p className="text-muted-foreground text-sm italic">
            {uses === 1
              ? "1 transaction is using this payee. Select a new payee for this transaction."
              : `${uses} transactions are using these payees. Select a new payee for them.`}
          </p>
          <NativeSelect
            id="replacement-payee"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            className="w-full"
          >
            <NativeSelectOption value="">[No Payee]</NativeSelectOption>
            {replacements.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => void onDelete(replacement || null)}
            >
              Delete
            </Button>
          </div>
        </section>
      ) : (
        <div className="grid gap-2">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void onHide(!allHidden)}
            >
              {allHidden ? (single ? "Unhide" : "Unhide All") : single ? "Hide" : "Hide All"}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              // Unused payees go at once; used ones first ask where their transactions go.
              onClick={() => (uses === 0 ? void onDelete(null) : setDeleting(true))}
            >
              {single ? "Delete" : "Delete All"}
            </Button>
          </div>
          {!single && anyRules && (
            <p className="text-muted-foreground text-xs">
              One or more of these payees have renaming rules. Deleting them will also delete their
              rules.
            </p>
          )}
          <p className="text-muted-foreground text-xs">{HIDDEN_HELP}</p>
        </div>
      )}
      {showing && (
        <PayeeTransactions payeeIds={picked.map((p) => p.id)} onClose={() => setShowing(false)} />
      )}
    </div>
  );
}

/** "Show N Transactions": everything using the payees, scheduled ones included. */
function PayeeTransactions({ payeeIds, onClose }: { payeeIds: string[]; onClose: () => void }) {
  const { budget, formatAmount, formatDate } = useBudget();
  const query = $api.useQuery("get", "/v1/budgets/{budgetId}/payees/transactions", {
    params: { path: { budgetId: budget.id }, query: { payeeIds: payeeIds.join(",") } },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="px-4 py-3">
          <DialogTitle>Transactions</DialogTitle>
          <DialogDescription className="sr-only">
            The transactions and scheduled transactions using the selected payees.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto">
          {query.isPending ? (
            <Skeleton className="m-4 h-16" />
          ) : query.isError ? (
            <p className="p-4 text-muted-foreground text-sm">Couldn't load the transactions.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Account</th>
                  <th className="px-2 py-2 text-left font-medium">Date</th>
                  <th className="px-2 py-2 text-left font-medium">Category</th>
                  <th className="px-2 py-2 text-left font-medium">Memo</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {query.data.transactions.map((t) => (
                  <tr key={t.id} className="border-t">
                    <td className="max-w-28 truncate px-4 py-1.5">{t.accountName}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{formatDate(t.date)}</td>
                    <td className="max-w-32 truncate px-2 py-1.5">{t.categoryName}</td>
                    <td className="max-w-32 truncate px-2 py-1.5 text-muted-foreground">
                      {t.memo}
                    </td>
                    <td className="whitespace-nowrap px-4 py-1.5 text-right tabular-nums">
                      {formatAmount(money(BigInt(t.amount), t.currency as CurrencyCode))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <DialogFooter className="m-0 border-t px-4 py-3">
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
