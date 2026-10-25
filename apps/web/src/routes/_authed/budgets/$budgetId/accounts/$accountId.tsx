import { ACCOUNT_TYPE_LABELS, accountFamily, isOnBudget, money } from "@strictbudget/engine";
import { Alert, AlertDescription } from "@strictbudget/ui/components/alert";
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
import { Badge } from "@strictbudget/ui/components/badge";
import { Button } from "@strictbudget/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@strictbudget/ui/components/empty";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@strictbudget/ui/components/tooltip";
import { cn } from "@strictbudget/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Info, Lock, Pencil } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { type AccountEdit, AccountLogoField, EditAccountForm } from "@/components/account-forms";
import { BalanceHistory } from "@/components/balance-history";
import {
  cardPaymentDraft,
  OverspendingFigure,
  PaymentFigure,
  useCardPayment,
} from "@/components/card-payment";
import { PairCategoryDialog } from "@/components/loan-dialogs";
import { LoanPage, usePairCategory } from "@/components/loan-page";
import { PageHeader } from "@/components/page-header";
import { PageTitle } from "@/components/page-title";
import { ReconcileBanner, ReconcilePopover, reconciledLabel } from "@/components/reconcile";
import { Register } from "@/components/register";
import { REVIEW_SEARCH, ReviewBanner } from "@/components/review-banner";
import { StarButton } from "@/components/star-button";
import { signedAmount, UnrealizedGain } from "@/components/unrealized-gain";
import { UpdateToLoanDialog, UpdateToLoanSection } from "@/components/update-to-loan";
import { accountsQueryOptions, closeAccountNotice } from "@/lib/accounts";
import { $api } from "@/lib/api";
import { useBudget } from "@/lib/budget-context";
import { apiErrorCode, apiErrorMessage } from "@/lib/budgets";
import { categoriesQueryOptions } from "@/lib/categories";
import { todayIso } from "@/lib/dates";
import { inCurrency } from "@/lib/money-input";
import { invalidateMonths } from "@/lib/months";
import { deleteAccountLogo, pictureSrc, uploadAccountLogo } from "@/lib/pictures";
import { type RegisterSearch, registerSearchSchema } from "@/lib/register-filters";
import { scheduledQueryPrefix } from "@/lib/scheduled";
import { useShortcut } from "@/lib/shortcuts";
import { transactionsQueryPrefix } from "@/lib/transactions";

export const Route = createFileRoute("/_authed/budgets/$budgetId/accounts/$accountId")({
  /**
   * `transaction`: scroll to and highlight it (the other side of a transfer). `recordPayment`:
   * open a card's Record Payment row (the payment inspector's button). The rest is the register's
   * search, filters and sort.
   */
  validateSearch: registerSearchSchema.extend({
    transaction: z.string().optional(),
    recordPayment: z.boolean().optional(),
  }),
  component: AccountPage,
});

type Confirm = "close" | "delete" | "reopen" | null;

function AccountPage() {
  const { accountId } = Route.useParams();
  const { transaction, recordPayment: openPayment, ...registerSearch } = Route.useSearch();
  const { budget, formatAmount, readOnly } = useBudget();
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const onSearchChange = useCallback(
    (patch: Partial<RegisterSearch>, replace?: boolean) =>
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, ...patch, transaction: undefined }),
        replace,
      }),
    [navigate],
  );
  const onRecordPaymentOpened = useCallback(
    () =>
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, recordPayment: undefined }),
        replace: true,
      }),
    [navigate],
  );
  const accounts = useQuery(accountsQueryOptions(budget.id));
  const update = $api.useMutation("patch", "/v1/budgets/{budgetId}/accounts/{accountId}");
  const close = $api.useMutation("post", "/v1/budgets/{budgetId}/accounts/{accountId}/close");
  const reopen = $api.useMutation("post", "/v1/budgets/{budgetId}/accounts/{accountId}/reopen");
  const remove = $api.useMutation("delete", "/v1/budgets/{budgetId}/accounts/{accountId}");
  const revalue = $api.useMutation("post", "/v1/budgets/{budgetId}/accounts/{accountId}/revalue");
  const reconcile = $api.useMutation(
    "post",
    "/v1/budgets/{budgetId}/accounts/{accountId}/reconcile",
  );
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [updatingToLoan, setUpdatingToLoan] = useState(false);
  const updateToLoan = $api.useMutation(
    "post",
    "/v1/budgets/{budgetId}/accounts/{accountId}/update-to-loan",
  );
  const categories = useQuery(categoriesQueryOptions(budget.id));
  const pairCategory = usePairCategory(budget.id);
  /** The bank's balance while reconciling against it (the banner over the register). */
  const [reconcilingTo, setReconcilingTo] = useState<bigint | null>(null);

  const account = accounts.data?.accounts.find((a) => a.id === accountId);
  const path = { budgetId: budget.id, accountId };
  /** The budget's number format with the account's own currency, for its amounts. */
  const accountSettings = inCurrency(budget, account?.currency);
  const show = (amount: string | bigint) =>
    formatAmount(money(BigInt(amount), accountSettings.currency));
  /** Plan amounts (a card's payment category), in the budget's currency. */
  const showBudget = (amount: string | bigint) =>
    formatAmount(money(BigInt(amount), budget.currency));
  const isLoan = account !== undefined && accountFamily(account.type) === "loan";
  // A loan's reconcile is its page's Update Balance.
  const reconcilable = account !== undefined && !isLoan;
  const isCard = account !== undefined && accountFamily(account.type) === "credit";
  const cardPayment = useCardPayment(isCard ? account : undefined);
  // A Record Payment link to an account that can't take one (closed, or not a card) is dropped,
  // so it can't open a payment row later (after a reopen) on its own.
  const paymentImpossible = account !== undefined && (!isCard || account.closed);
  useEffect(() => {
    if (openPayment && paymentImpossible) onRecordPaymentOpened();
  }, [openPayment, paymentImpossible, onRecordPaymentOpened]);

  // A reconciliation in progress belongs to the account it started on.
  useEffect(() => setReconcilingTo(null), [accountId]);

  useShortcut("reconcile", () => setReconcileOpen(true), { enabled: reconcilable });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: accountsQueryOptions(budget.id).queryKey }),
      queryClient.invalidateQueries({ queryKey: transactionsQueryPrefix }),
      queryClient.invalidateQueries({ queryKey: categoriesQueryOptions(budget.id).queryKey }),
      invalidateMonths(queryClient),
    ]);
  }

  async function handleSave(values: AccountEdit) {
    try {
      await update.mutateAsync({
        params: { path },
        // The user's today dates an adjustment and starts a loan's new terms in their month.
        body: { ...values, date: todayIso() },
      });
      await refresh();
      setEditing(false);
      return null;
    } catch (error) {
      return apiErrorMessage(error, "Couldn't save the account.");
    }
  }

  async function run(work: () => Promise<unknown>, done: string, failure: string) {
    try {
      await work();
      await refresh();
      toast.success(done);
    } catch (error) {
      toast.error(apiErrorMessage(error, failure));
    }
  }

  async function handleRevalue() {
    try {
      const today = todayIso();
      const result = await revalue.mutateAsync({ params: { path }, body: { date: today, today } });
      await refresh();
      toast.success(
        result.transaction
          ? `Revalued: ${signedAmount(BigInt(result.transaction.baseAmount), (m) => showBudget(m))}`
          : "Nothing to revalue: the account is booked at today's rate",
      );
    } catch (error) {
      toast.error(apiErrorMessage(error, "Couldn't revalue the account."));
    }
  }

  async function finishReconciling(balance: bigint) {
    setReconcileOpen(false);
    try {
      await reconcile.mutateAsync({
        params: { path },
        body: { balance: balance.toString(), date: todayIso() },
      });
      setReconcilingTo(null);
      await refresh();
    } catch (error) {
      toast.error(apiErrorMessage(error, "Couldn't reconcile the account."));
    }
  }

  async function handleDelete() {
    try {
      await remove.mutateAsync({ params: { path } });
    } catch (error) {
      toast.error(
        apiErrorCode(error) === "ACCOUNT_HAS_HISTORY"
          ? "This account has transactions, so it can't be deleted. Close it instead."
          : apiErrorMessage(error, "Couldn't delete the account."),
      );
      return;
    }
    await navigate({ to: "/budgets/$budgetId", params: { budgetId: budget.id } });
    await refresh();
    toast.success(`Deleted “${account?.name}”`);
  }

  if (accounts.isPending) return <Skeleton className="h-40" />;
  if (!account) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Account not found</EmptyTitle>
          <EmptyDescription>It may have been deleted.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const working = BigInt(account.balances.working);

  const closeNow = () =>
    run(
      () => close.mutateAsync({ params: { path }, body: { date: todayIso() } }),
      "Account closed",
      "Couldn't close the account.",
    );
  /** A zeroed account closes at once; one whose balance needs an adjustment asks first. */
  function handleClose() {
    if (working !== 0n) return setConfirm("close");
    setEditing(false);
    void closeNow();
  }

  const reopenNow = () =>
    run(
      () => reopen.mutateAsync({ params: { path, query: { today: todayIso() } } }),
      "Account reopened",
      "Couldn't reopen the account.",
    );

  function confirmDialog() {
    if (!account) return null;
    const closing = closeAccountNotice(account.type, working);
    if (confirm === "reopen") {
      const loanName =
        accounts.data?.accounts.find((a) => a.id === account.migratedToAccountId)?.name ?? "";
      return (
        <AlertDialog open onOpenChange={(o) => !o && setConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Re-open Account</AlertDialogTitle>
              <AlertDialogDescription>
                The history in this closed account was migrated to your {loanName} loan account.
                Re-opening this account will erase the information that was migrated.
              </AlertDialogDescription>
              <AlertDialogDescription className="font-medium">
                This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={async () => {
                  setConfirm(null);
                  setEditing(false);
                  await reopenNow();
                }}
              >
                Erase &amp; Re-open
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      );
    }
    return (
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "close" ? "Close Account" : `Delete “${account.name}”?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "delete"
                ? "Only accounts with no transactions besides their starting balance can be deleted. This can't be undone."
                : `Before you can close this account, the balance will have to be zeroed out. An adjustment transaction will be created for ${show(closing.adjustment.toString())}.`}
            </AlertDialogDescription>
            {confirm === "close" && closing.removesMoneyFromPlan && (
              <Alert>
                <Info aria-hidden />
                <AlertDescription>
                  The money in this account will be removed from your plan. If you would like to
                  keep it in your plan, you can transfer it to another account before closing this
                  one.
                </AlertDescription>
              </Alert>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm === "delete" ? "destructive" : "default"}
              onClick={async () => {
                const action = confirm;
                setConfirm(null);
                setEditing(false);
                if (action === "delete") return handleDelete();
                await closeNow();
              }}
            >
              {confirm === "delete" ? "Delete account" : "Adjust Balance & Close"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  const editDialog = (
    <Dialog open={editing} onOpenChange={setEditing}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit account</DialogTitle>
        </DialogHeader>
        {account.migratedToAccountId && (
          <Alert>
            <Info aria-hidden />
            <AlertDescription>
              This account was previously updated to a loan account.
            </AlertDescription>
          </Alert>
        )}
        <EditAccountForm
          key={`${account.id}-${editing}`}
          settings={accountSettings}
          initial={account}
          workingBalance={account.closed ? null : BigInt(account.balances.working)}
          onSubmit={handleSave}
          logo={
            <AccountLogoField
              name={account.name}
              src={pictureSrc(account.logo)}
              onPick={async (blob) => {
                await uploadAccountLogo(budget.id, account.id, blob);
                await queryClient.invalidateQueries({
                  queryKey: accountsQueryOptions(budget.id).queryKey,
                });
              }}
              onRemove={async () => {
                await deleteAccountLogo(budget.id, account.id);
                await queryClient.invalidateQueries({
                  queryKey: accountsQueryOptions(budget.id).queryKey,
                });
              }}
            />
          }
        />
        {isLoan && !account.closed && (
          <section className="grid gap-2 border-t pt-4" aria-label="Paired Plan Category">
            <h3 className="font-medium text-sm">Paired Plan Category</h3>
            <p className="text-muted-foreground text-sm">
              Pairing a category helps you create realistic payoff plans, and keep track of your
              progress.
            </p>
            {account.pairedCategoryId ? (
              <Button
                variant="outline"
                size="sm"
                className="justify-self-start"
                onClick={() =>
                  run(
                    () =>
                      update.mutateAsync({
                        params: { path, query: { today: todayIso() } },
                        body: { pairedCategoryId: null },
                      }),
                    "Category unpaired",
                    "Couldn't unpair the category.",
                  )
                }
              >
                Unpair Category
              </Button>
            ) : (
              <Button
                size="sm"
                className="justify-self-start"
                disabled={!categories.data}
                onClick={() => setPairing(true)}
              >
                Pair with a Plan Category
              </Button>
            )}
          </section>
        )}
        {/* Loans stay in the budget's currency, so a liability in another one can't become one. */}
        {account.type === "liability" &&
          account.currency === budget.currency &&
          !account.closed &&
          !account.migratedToAccountId && (
            <UpdateToLoanSection
              onLearnMore={() => {
                setEditing(false);
                setUpdatingToLoan(true);
              }}
            />
          )}
        {/* An open account offers Close, or Delete while it has only its starting
            balance; a closed one offers Re-open and Delete, disabled while it has history. */}
        <div className="flex flex-wrap gap-2 border-t pt-4">
          {account.closed && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                account.migratedToAccountId ? setConfirm("reopen") : void reopenNow()
              }
            >
              Re-open
            </Button>
          )}
          {!account.closed && account.hasHistory && (
            <Button variant="outline" size="sm" onClick={handleClose}>
              Close Account
            </Button>
          )}
          {(account.closed || !account.hasHistory) && (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* A disabled button gets no pointer events; the wrapper shows the tooltip. */}
                <span className="inline-flex" tabIndex={account.hasHistory ? 0 : undefined}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    disabled={account.hasHistory}
                    onClick={() => setConfirm("delete")}
                  >
                    {account.closed ? "Delete" : "Delete Account"}
                  </Button>
                </span>
              </TooltipTrigger>
              {account.hasHistory && (
                <TooltipContent className="max-w-xs">
                  If you want to delete this account, first delete all of the transactions in it and
                  transfers pointing to it. Be cautious, as this will potentially change your plan
                  values.
                </TooltipContent>
              )}
            </Tooltip>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );

  const pairDialog = pairing && categories.data && (
    <PairCategoryDialog
      open
      onOpenChange={setPairing}
      list={categories.data}
      onSave={async (choice) => {
        try {
          const pairedCategoryId = await pairCategory(choice);
          await update.mutateAsync({
            params: { path, query: { today: todayIso() } },
            body: { pairedCategoryId },
          });
          await refresh();
          return null;
        } catch (error) {
          return apiErrorMessage(error, "Couldn't pair the category.");
        }
      }}
    />
  );

  const updateToLoanDialog = updatingToLoan && (
    <UpdateToLoanDialog
      open
      onOpenChange={setUpdatingToLoan}
      account={account}
      settings={budget}
      categories={categories.data}
      format={(minorUnits) => show(minorUnits)}
      onSubmit={async ({ pairing: choice, ...values }) => {
        try {
          const pairedCategoryId = await pairCategory(choice);
          const { loan } = await updateToLoan.mutateAsync({
            params: { path },
            body: { ...values, pairedCategoryId, date: todayIso() },
          });
          // Its scheduled transactions are gone too.
          await Promise.all([
            refresh(),
            queryClient.invalidateQueries({ queryKey: scheduledQueryPrefix }),
          ]);
          return { loanId: loan.id };
        } catch (error) {
          return { error: apiErrorMessage(error, "Couldn't update the account.") };
        }
      }}
      onDone={(loanId) => {
        setUpdatingToLoan(false);
        void navigate({
          to: "/budgets/$budgetId/accounts/$accountId",
          params: { budgetId: budget.id, accountId: loanId },
          search: {},
        });
      }}
    />
  );

  if (isLoan) {
    return (
      <>
        <LoanPage
          account={account}
          accounts={accounts.data?.accounts ?? []}
          onEdit={() => setEditing(true)}
        />
        {editDialog}
        {pairDialog}
        {confirmDialog()}
      </>
    );
  }

  return (
    <div className="grid gap-6">
      <ReviewBanner count={account.toReview} onView={() => onSearchChange({ q: REVIEW_SEARCH })} />
      <PageTitle name={account.name} />
      <PageHeader
        title={account.name}
        meta={
          <>
            {!readOnly && (
              <StarButton
                budgetId={budget.id}
                account={account}
                accounts={accounts.data?.accounts ?? []}
              />
            )}
            {account.closed && <Badge variant="secondary">Closed</Badge>}
            <span className="hidden min-w-0 items-center gap-x-3 truncate text-muted-foreground text-sm md:inline-flex">
              <span>
                {ACCOUNT_TYPE_LABELS[account.type]}
                {isOnBudget(account.type) ? "" : " · off budget"}
              </span>
              {reconcilable && (
                <span className="inline-flex items-center gap-1">
                  <Lock className="size-3.5" aria-hidden />
                  {reconciledLabel(account.lastReconciledAt)}
                </span>
              )}
            </span>
          </>
        }
        actions={
          <>
            {account.migratedToAccountId && (
              <Button variant="link" size="sm" asChild>
                <Link
                  to="/budgets/$budgetId/accounts/$accountId"
                  params={{ budgetId: budget.id, accountId: account.migratedToAccountId }}
                >
                  Go to Loan Account
                </Link>
              </Button>
            )}
            {!readOnly && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil /> Edit account
              </Button>
            )}
            {reconcilable && !readOnly && (
              <ReconcilePopover
                account={account}
                settings={accountSettings}
                open={reconcileOpen}
                onOpenChange={setReconcileOpen}
                show={show}
                pending={reconcile.isPending}
                onConfirm={() => void finishReconciling(BigInt(account.balances.cleared))}
                onStart={(balance) => {
                  setReconcileOpen(false);
                  setReconcilingTo(balance);
                }}
              />
            )}
          </>
        }
      />
      {account.note && <p className="max-w-prose text-sm">{account.note}</p>}

      <dl className="flex flex-wrap items-end gap-x-8 gap-y-2 rounded-lg border px-4 py-3 tabular-nums">
        <Balance label="Cleared Balance" value={show(account.balances.cleared)} />
        <Balance label="Uncleared Balance" value={show(account.balances.uncleared)} operator="+" />
        <Balance
          operator="="
          label="Working Balance"
          value={show(account.balances.working)}
          negative={working < 0n}
          strong
        />
        {account.currency !== budget.currency && (
          <UnrealizedGain
            account={account}
            budgetCurrency={budget.currency}
            format={(m) => showBudget(m)}
            pending={revalue.isPending}
            onRevalue={handleRevalue}
          />
        )}
        {cardPayment && (
          <div className="ml-auto flex items-end gap-4">
            <OverspendingFigure
              amount={cardPayment.creditOverspending}
              month={cardPayment.month}
              format={showBudget}
            />
            <PaymentFigure
              categoryId={cardPayment.categoryId}
              available={cardPayment.available}
              caution={cardPayment.caution}
              format={showBudget}
            />
          </div>
        )}
      </dl>

      {reconcilingTo !== null && (
        <ReconcileBanner
          difference={reconcilingTo - BigInt(account.balances.cleared)}
          show={show}
          pending={reconcile.isPending}
          onCancel={() => setReconcilingTo(null)}
          onFinish={() => void finishReconciling(reconcilingTo)}
        />
      )}

      <BalanceHistory
        key={`history-${accountId}`}
        budgetId={budget.id}
        accountId={accountId}
        currency={account.currency}
      />

      <Register
        key={accountId}
        accountId={accountId}
        focusId={transaction}
        search={registerSearch}
        onSearchChange={onSearchChange}
        recordPayment={
          isCard
            ? () =>
                cardPaymentDraft({
                  card: account,
                  accounts: accounts.data?.accounts ?? [],
                  available: cardPayment?.available ?? 0n,
                  settings: budget,
                  today: todayIso(),
                })
            : undefined
        }
        // The prefill needs the card's payment Available and the accounts.
        openRecordPayment={openPayment === true && cardPayment !== null && accounts.isSuccess}
        onRecordPaymentOpened={onRecordPaymentOpened}
      />

      {editDialog}
      {updateToLoanDialog}

      {confirmDialog()}
    </div>
  );
}

function Balance({
  label,
  value,
  negative = false,
  strong = false,
  operator,
}: {
  label: string;
  value: string;
  negative?: boolean;
  strong?: boolean;
  /** The "+" or "=" before it, drawn by CSS: a list of terms can't hold loose text. */
  operator?: "+" | "=";
}) {
  return (
    <div
      className={cn(
        "relative grid",
        operator &&
          "before:absolute before:-left-5 before:bottom-0.5 before:text-muted-foreground before:content-[var(--operator)]",
      )}
      style={operator ? ({ "--operator": `"${operator}"` } as React.CSSProperties) : undefined}
    >
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd
        className={cn(
          // One line height (/7) for every figure, so the larger Working Balance doesn't lift its
          // label above the others.
          strong ? "font-semibold text-lg/7" : "text-base/7",
          negative && "text-destructive",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
