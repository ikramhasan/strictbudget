import { ACCOUNT_TYPE_LABELS, monthOf } from "@strictbudget/engine";
import { Badge } from "@strictbudget/ui/components/badge";
import { Button } from "@strictbudget/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@strictbudget/ui/components/dropdown-menu";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { cn } from "@strictbudget/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  Clock,
  Lock,
  Pencil,
  Puzzle,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { type Account, accountsQueryOptions } from "@/lib/accounts";
import { $api } from "@/lib/api";
import { useBudget } from "@/lib/budget-context";
import { apiErrorMessage } from "@/lib/budgets";
import { categoriesQueryOptions } from "@/lib/categories";
import { todayIso } from "@/lib/dates";
import { type LoanPlan, loanPlan } from "@/lib/loan-planner";
import {
  chargeNote,
  chargeShown,
  datesLabel,
  dayLabel,
  formatRate,
  hasEscrow,
  joinAnd,
  type LoanLineData,
  type LoanMonthData,
  type LoanUpcoming,
  loanQueryOptions,
  longMonth,
  newestFirst,
  OTHER_LABELS,
  otherKind,
  paymentStatus,
  shortMonth,
} from "@/lib/loans";
import { invalidateMonths, monthQueryOptions } from "@/lib/months";
import { scheduledQueryPrefix } from "@/lib/scheduled";
import { transactionsQueryPrefix } from "@/lib/transactions";
import {
  type ActivityKind,
  EditChargeDialog,
  LoanActivityDialog,
  PairCategoryDialog,
  type PairChoice,
  RecordInterestDialog,
  RecordPaymentDialog,
  UpdateBalanceDialog,
} from "./loan-dialogs";
import { LoanBanners, LoanProgressCard } from "./loan-progress";
import { AvailablePill } from "./move-money";
import { PageHeader } from "./page-header";
import { PageTitle } from "./page-title";
import { PayoffSimulator } from "./payoff-simulator";
import { reconciledLabel } from "./reconcile";
import { ShareProgressDialog } from "./share-progress";
import { UpcomingActivity, upcomingLabel } from "./upcoming-transactions";
import { OriginalHistory } from "./update-to-loan";

type Open =
  | { kind: "payment" }
  | { kind: "interest" }
  | { kind: "update" }
  | { kind: "pair" }
  | { kind: "activity"; activity: ActivityKind; line?: LoanLineData }
  | { kind: "charge"; charge: "interest" | "escrow"; month: LoanMonthData }
  | { kind: "simulator" }
  | { kind: "share" }
  | null;

/** "Updated never" / "Updated 15 minutes ago": the loan's last Update Balance. */
export const updatedLabel = (lastReconciledAt: string | null) =>
  lastReconciledAt
    ? reconciledLabel(lastReconciledAt).replace(/^Reconciled/, "Updated")
    : "Updated never";

export function useLoanRefresh(budgetId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: accountsQueryOptions(budgetId).queryKey }),
      // Registers and loan activity, and the Scheduled sections a future payment lands in.
      queryClient.invalidateQueries({ queryKey: transactionsQueryPrefix }),
      queryClient.invalidateQueries({ queryKey: scheduledQueryPrefix }),
      queryClient.invalidateQueries({ queryKey: categoriesQueryOptions(budgetId).queryKey }),
      invalidateMonths(queryClient),
    ]);
}

/**
 * Creates the new category first when there is one. A retry after a failed save passes the same
 * choice object, so it reuses the category it already made.
 */
export function usePairCategory(budgetId: string) {
  const createCategory = $api.useMutation("post", "/v1/budgets/{budgetId}/categories");
  const created = useRef(new WeakMap<object, string>());
  return async (choice: Exclude<PairChoice, null>) => {
    if ("categoryId" in choice) return choice.categoryId;
    const known = created.current.get(choice);
    if (known) return known;
    const category = await createCategory.mutateAsync({
      params: { path: { budgetId } },
      body: { name: choice.name.trim(), groupId: choice.groupId },
    });
    created.current.set(choice, category.id);
    return category.id;
  };
}

/** A starting balance that isn't the loan's oldest transaction is flagged instead of projected. */
export function startingBalanceError(months: readonly LoanMonthData[]) {
  const lines = months.flatMap((m) => m.transactions);
  const start = lines.find((t) => t.kind === "starting_balance");
  return start ? lines.some((t) => t.date < start.date) : false;
}

/** Clicking a Past Balance point moves the original schedule's start (`originalFrom`). */
export function useLoanPlan(account: Account | undefined, originalFrom?: string): LoanPlan | null {
  const { budget } = useBudget();
  const today = todayIso();
  const loan = useQuery({
    ...loanQueryOptions(budget.id, account?.id ?? "", today),
    enabled: account !== undefined,
  });
  const categories = useQuery(categoriesQueryOptions(budget.id));
  const target = categories.data?.groups
    .flatMap((g) => g.categories)
    .find((c) => account && c.id === account.pairedCategoryId)?.target;
  const targetAmount = target?.cadence === "debt_monthly" ? BigInt(target.amount) : null;
  return useMemo(
    () =>
      loan.data && account
        ? loanPlan({
            activity: loan.data,
            currency: budget.currency,
            current: monthOf(today),
            targetAmount,
            originalFrom,
          })
        : null,
    [loan.data, account, budget.currency, today, targetAmount, originalFrom],
  );
}

export function LoanPage({
  account,
  accounts,
  onEdit,
}: {
  account: Account;
  accounts: readonly Account[];
  onEdit: () => void;
}) {
  const { budget, formatAmount, formatDate, readOnly } = useBudget();
  const today = todayIso();
  const format = (minorUnits: bigint) =>
    formatAmount({ amount: minorUnits, currency: budget.currency });
  const formatText = (minorUnits: string) => format(BigInt(minorUnits));
  const path = { budgetId: budget.id, accountId: account.id };
  const loan = useQuery(loanQueryOptions(budget.id, account.id, today));
  const categories = useQuery(categoriesQueryOptions(budget.id));
  const month = useQuery(monthQueryOptions(budget.id, monthOf(today), today));
  const refresh = useLoanRefresh(budget.id);
  const pairCategory = usePairCategory(budget.id);
  const recordPayment = $api.useMutation(
    "post",
    "/v1/budgets/{budgetId}/accounts/{accountId}/loan/payments",
  );
  const setCharge = $api.useMutation(
    "put",
    "/v1/budgets/{budgetId}/accounts/{accountId}/loan/charges",
  );
  const reconcile = $api.useMutation(
    "post",
    "/v1/budgets/{budgetId}/accounts/{accountId}/reconcile",
  );
  const previewReconcile = $api.useMutation(
    "post",
    "/v1/budgets/{budgetId}/accounts/{accountId}/reconcile/preview",
  );
  const updateAccount = $api.useMutation("patch", "/v1/budgets/{budgetId}/accounts/{accountId}");
  const createTransaction = $api.useMutation("post", "/v1/budgets/{budgetId}/transactions");
  const updateTransaction = $api.useMutation(
    "patch",
    "/v1/budgets/{budgetId}/transactions/{transactionId}",
  );
  const deleteTransaction = $api.useMutation(
    "delete",
    "/v1/budgets/{budgetId}/transactions/{transactionId}",
  );
  const [open, setOpen] = useState<Open>(null);
  const close = (isOpen: boolean) => !isOpen && setOpen(null);
  const [originalFrom, setOriginalFrom] = useState<string | undefined>();
  const plan = useLoanPlan(account, originalFrom);
  const navigate = useNavigate();
  const openPairedCategory = () =>
    account.pairedCategoryId &&
    navigate({
      to: "/budgets/$budgetId",
      params: { budgetId: budget.id },
      search: { category: account.pairedCategoryId },
    });

  /** Runs a change and refreshes; resolves to an error message or null. */
  async function save(work: () => Promise<unknown>, failure: string) {
    try {
      await work();
      await refresh();
      return null;
    } catch (error) {
      return apiErrorMessage(error, failure);
    }
  }

  const settings = { ...budget, dateFormat: budget.dateFormat };
  const owed = -BigInt(account.balances.working);
  const paired = categories.data?.groups
    .flatMap((g) => g.categories.map((c) => ({ ...c, group: g.name })))
    .find((c) => c.id === account.pairedCategoryId);
  const pairedAvailable = BigInt(
    month.data?.categories.find((c) => c.categoryId === account.pairedCategoryId)?.available ?? "0",
  );
  const months = loan.data?.months ?? [];
  const current = monthOf(today);

  return (
    <div className="grid gap-6">
      <PageTitle name={account.name} />
      <PageHeader
        title={account.name}
        meta={
          <>
            {account.closed && <Badge variant="secondary">Closed</Badge>}
            <span className="hidden min-w-0 items-center gap-x-3 truncate text-muted-foreground text-sm md:inline-flex">
              <span>{ACCOUNT_TYPE_LABELS[account.type]}</span>
              <span className="inline-flex items-center gap-1">
                <Lock className="size-3.5" aria-hidden />
                {updatedLabel(account.lastReconciledAt)}
              </span>
            </span>
          </>
        }
        actions={
          !readOnly && (
            <>
              <Button variant="outline" size="sm" onClick={onEdit} aria-label="Edit account">
                <Pencil />
              </Button>
              {!account.closed && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setOpen({ kind: "update" })}>
                    Update Balance
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm">Add Activity</Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <MenuItem
                        title="Add Payment"
                        hint="For payments to reduce your balance"
                        onSelect={() => setOpen({ kind: "payment" })}
                      />
                      <MenuItem
                        title="Add Credit"
                        hint="For credits or refunds to your account"
                        onSelect={() => setOpen({ kind: "activity", activity: "credit" })}
                      />
                      <MenuItem
                        title="Add Fee or Charge"
                        hint="For late fees, annual fees, or withdrawals"
                        onSelect={() => setOpen({ kind: "activity", activity: "charge" })}
                      />
                      <MenuItem
                        title="Add Interest"
                        hint="For recording known interest accrual"
                        onSelect={() => setOpen({ kind: "interest" })}
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </>
          )
        }
      />
      {account.note && <p className="max-w-prose text-sm">{account.note}</p>}

      <dl className="flex flex-wrap gap-x-8 gap-y-3 rounded-lg border px-4 py-3 tabular-nums">
        <Figure label="Remaining Balance" value={format(owed)} />
        <Figure
          label="Interest Rate"
          value={account.interestRate ? `${formatRate(account.interestRate)}%` : "--"}
        />
        <Figure
          label="Minimum Payment"
          value={account.minimumPayment ? formatText(account.minimumPayment) : "--"}
        />
        {hasEscrow(account.type) && (
          <Figure
            label="Escrow"
            value={account.escrowAmount ? formatText(account.escrowAmount) : "--"}
          />
        )}
        <Figure
          label="Payoff Date"
          value={plan?.payoffMonth ? shortMonth(plan.payoffMonth) : "--"}
        />
      </dl>

      {plan && (
        <LoanBanners
          budgetId={budget.id}
          accountId={account.id}
          banners={loan.data?.banners}
          paidOff={plan.progress.paidOff}
          onSimulate={account.closed ? undefined : () => setOpen({ kind: "simulator" })}
        />
      )}
      {plan &&
        (startingBalanceError(months) ? (
          <section
            className="flex items-start gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm"
            aria-label="Starting balance error"
          >
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-500" aria-hidden />
            <div className="grid gap-1">
              <p className="font-semibold">
                We found an error with the starting balance of this account.
              </p>
              <p>
                The balance you entered when you added this debt account is not showing up as the
                oldest transaction. Please fix the issue to see your debt paydown estimates.
              </p>
            </div>
          </section>
        ) : (
          <LoanProgressCard
            plan={plan}
            onShare={account.closed ? undefined : () => setOpen({ kind: "share" })}
            onSimulate={account.closed ? undefined : () => setOpen({ kind: "simulator" })}
            onIncreaseTarget={account.pairedCategoryId ? openPairedCategory : undefined}
            onIncreaseMinimum={account.closed ? undefined : onEdit}
            onBaseOriginal={(m) => setOriginalFrom(m)}
          />
        ))}

      {paired ? (
        <section className="rounded-lg border" aria-label="Paired Plan Category">
          <h2 className="border-b px-4 py-3 font-semibold text-sm">Paired Plan Category</h2>
          <div className="flex flex-wrap items-end justify-between gap-4 px-4 py-3 text-sm">
            <div className="grid gap-0.5">
              <span className="text-muted-foreground text-xs">Category</span>
              <Link
                to="/budgets/$budgetId"
                params={{ budgetId: budget.id }}
                className="font-medium text-primary-text hover:underline"
              >
                {paired.group}: {paired.name}
              </Link>
            </div>
            <div className="grid justify-items-end gap-0.5">
              <span className="text-muted-foreground text-xs">Available to spend</span>
              <AvailablePill amount={pairedAvailable.toString()} format={formatText} />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm">
            <span className="text-muted-foreground text-xs">Target</span>
            {paired.target?.cadence === "debt_monthly" ? (
              <button
                type="button"
                className="font-medium text-primary-text hover:underline"
                onClick={openPairedCategory}
              >
                {formatText(paired.target.amount)} Needed Each Month
              </button>
            ) : (
              <Button size="sm" variant="secondary" onClick={openPairedCategory}>
                Create Debt Payment Target
              </Button>
            )}
          </div>
        </section>
      ) : (
        !account.closed && (
          <section
            className="flex flex-wrap items-center gap-4 rounded-lg border px-4 py-3"
            aria-label="Pair your loan"
          >
            <Puzzle className="size-8 text-primary-text" aria-hidden />
            <div className="grid flex-1 gap-1">
              <p className="font-semibold text-sm">Pair your loan and get more out of your plan</p>
              <p className="text-muted-foreground text-sm">
                Pairing your loan with a plan category helps you better keep track of your payments
                in your plan.
              </p>
            </div>
            <Button size="sm" onClick={() => setOpen({ kind: "pair" })} disabled={!categories.data}>
              Get Started
            </Button>
          </section>
        )
      )}

      <section className="grid gap-3" aria-label="Account Activity">
        <h2 className="font-semibold text-xl">Account Activity</h2>
        {loan.isPending ? (
          <Skeleton className="h-40" />
        ) : (
          [...months].reverse().map((m, index) => (
            <MonthCard
              key={m.month}
              month={m}
              first={index === months.length - 1}
              defaultOpen={m.month === current}
              upcoming={m.month === current ? (loan.data?.upcoming ?? []) : []}
              formatDate={formatDate}
              onOpenUpcoming={(u) =>
                void navigate({
                  to: "/budgets/$budgetId/accounts/$accountId",
                  params: { budgetId: budget.id, accountId: u.payingAccountId },
                  search: { transaction: u.payingRowId },
                })
              }
              accounts={accounts}
              budgetId={budget.id}
              format={format}
              onEditCharge={
                account.closed
                  ? undefined
                  : (charge) => setOpen({ kind: "charge", charge, month: m })
              }
              onEditLine={
                account.closed
                  ? undefined
                  : (line) => {
                      const kind = otherKind(line);
                      if (kind === "initial") return onEdit();
                      setOpen({
                        kind: "activity",
                        activity: kind === "adjustment" ? "adjustment" : kind,
                        line,
                      });
                    }
              }
            />
          ))
        )}
      </section>

      {loan.data?.originalHistory && (
        <OriginalHistory
          months={loan.data.originalHistory.months}
          format={format}
          onGoToAccount={() =>
            void navigate({
              to: "/budgets/$budgetId/accounts/$accountId",
              params: {
                budgetId: budget.id,
                accountId: loan.data?.originalHistory?.accountId ?? account.id,
              },
            })
          }
        />
      )}

      {open?.kind === "payment" && (
        <RecordPaymentDialog
          open
          onOpenChange={close}
          accounts={accounts}
          settings={settings}
          format={format}
          paired={paired ? { name: paired.name, available: pairedAvailable } : null}
          lastFromAccountId={account.lastPaymentFromAccountId}
          onSave={(input) =>
            save(
              () =>
                recordPayment.mutateAsync({
                  params: { path, query: { today: todayIso() } },
                  body: { ...input, amount: input.amount.toString() },
                }),
              "Couldn't record the payment.",
            )
          }
        />
      )}
      {open?.kind === "interest" && (
        <RecordInterestDialog
          open
          onOpenChange={close}
          months={months}
          settings={settings}
          format={format}
          onSave={(monthId, total) =>
            save(
              () =>
                setCharge.mutateAsync({
                  params: { path },
                  body: { month: monthId, kind: "interest", amount: total.toString(), today },
                }),
              "Couldn't record the interest.",
            )
          }
        />
      )}
      {open?.kind === "charge" && (
        <EditChargeDialog
          open
          onOpenChange={close}
          kind={open.charge}
          month={open.month.month}
          amount={BigInt(open.month[open.charge].applied)}
          settings={settings}
          onSave={(amount) =>
            save(
              () =>
                setCharge.mutateAsync({
                  params: { path },
                  body: {
                    month: open.month.month,
                    kind: open.charge,
                    amount: amount.toString(),
                    today,
                  },
                }),
              `Couldn't save the ${open.charge}.`,
            )
          }
        />
      )}
      {open?.kind === "activity" && (
        <LoanActivityDialog
          open
          onOpenChange={close}
          kind={open.activity}
          initial={
            open.line && {
              amount: BigInt(open.line.amount),
              date: open.line.date,
              memo: open.line.memo,
            }
          }
          settings={settings}
          onSave={(input) => {
            const line = open.line;
            const body = { amount: input.amount.toString(), date: input.date, memo: input.memo };
            return save(
              () =>
                line
                  ? updateTransaction.mutateAsync({
                      params: {
                        path: { budgetId: budget.id, transactionId: line.id },
                        query: { today: todayIso() },
                      },
                      body,
                    })
                  : createTransaction.mutateAsync({
                      params: { path: { budgetId: budget.id }, query: { today: todayIso() } },
                      body: {
                        ...body,
                        accountId: account.id,
                        categoryId: null,
                        payeeName: null,
                        cleared: "cleared",
                        flag: null,
                      },
                    }),
              "Couldn't save the activity.",
            );
          }}
          onDelete={
            open.line
              ? () => {
                  const id = open.line?.id ?? "";
                  return save(
                    () =>
                      deleteTransaction.mutateAsync({
                        params: { path: { budgetId: budget.id, transactionId: id } },
                      }),
                    "Couldn't delete it.",
                  );
                }
              : undefined
          }
        />
      )}
      {open?.kind === "update" && (
        <UpdateBalanceDialog
          open
          onOpenChange={close}
          account={account}
          settings={settings}
          format={format}
          month={current}
          onPreview={async (balance, loanTerms) => {
            try {
              const { adjustment } = await previewReconcile.mutateAsync({
                params: { path },
                body: { balance: balance.toString(), date: today, loanTerms },
              });
              return BigInt(adjustment);
            } catch (error) {
              return apiErrorMessage(error, "Couldn't work out the adjustment.");
            }
          }}
          onReconcile={(balance, loanTerms) =>
            save(
              () =>
                reconcile.mutateAsync({
                  params: { path },
                  body: { balance: balance.toString(), date: today, loanTerms },
                }),
              "Couldn't update the balance.",
            )
          }
        />
      )}
      {open?.kind === "simulator" && plan && (
        <PayoffSimulator
          open
          onOpenChange={close}
          plan={plan}
          pairedCategoryId={account.pairedCategoryId}
        />
      )}
      {open?.kind === "share" && plan && (
        <ShareProgressDialog open onOpenChange={close} plan={plan} loanName={account.name} />
      )}
      {open?.kind === "pair" && categories.data && (
        <PairCategoryDialog
          open
          onOpenChange={close}
          list={categories.data}
          onSave={(choice) =>
            save(async () => {
              const categoryId = await pairCategory(choice);
              await updateAccount.mutateAsync({
                params: { path, query: { today: todayIso() } },
                body: { pairedCategoryId: categoryId },
              });
              toast.success("Category paired");
            }, "Couldn't pair the category.")
          }
        />
      )}
    </div>
  );
}

function MenuItem({
  title,
  hint,
  onSelect,
}: {
  title: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="grid items-start gap-0">
      <span className="font-medium">{title}</span>
      <span className="text-muted-foreground text-xs">{hint}</span>
    </DropdownMenuItem>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid">
      <dd className="order-first font-semibold text-lg">{value}</dd>
      <dt className="text-muted-foreground text-xs">{label}</dt>
    </div>
  );
}

function Row({
  children,
  amount,
  onClick,
  className,
}: {
  children: ReactNode;
  amount?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const body = (
    <>
      <div className="grid min-w-0 flex-1 gap-0.5">{children}</div>
      {amount !== undefined && <span className="shrink-0 tabular-nums">{amount}</span>}
    </>
  );
  const classes = cn(
    "flex w-full items-center gap-3 border-t px-4 py-2.5 text-left text-sm",
    className,
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(classes, "group hover:bg-muted/60")}>
      {body}
    </button>
  ) : (
    <div className={classes}>{body}</div>
  );
}

const StatusIcon = ({ status }: { status: ReturnType<typeof paymentStatus> }) =>
  status === "none" ? (
    <Clock className="size-4 text-muted-foreground" aria-label="No payments" />
  ) : status === "partial" ? (
    <CircleDashed
      className="size-4 text-amber-600 dark:text-amber-400"
      aria-label="Partly covered"
    />
  ) : (
    <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-label="Covered" />
  );

export function MonthCard({
  month,
  first,
  defaultOpen,
  upcoming,
  formatDate,
  onOpenUpcoming,
  accounts,
  budgetId,
  format,
  onEditCharge,
  onEditLine,
}: {
  month: LoanMonthData;
  /** The loan's first month ("Initial Balance" under its total). */
  first: boolean;
  defaultOpen: boolean;
  /** This month's scheduled payments still to come (today's month only). */
  upcoming: readonly LoanUpcoming[];
  formatDate: (isoDate: string) => string;
  onOpenUpcoming: (item: LoanUpcoming) => void;
  accounts: readonly Account[];
  budgetId: string;
  format: (minorUnits: bigint) => string;
  onEditCharge?: (charge: "interest" | "escrow") => void;
  onEditLine?: (line: LoanLineData) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [showPayments, setShowPayments] = useState(true);
  const [showOther, setShowOther] = useState(true);
  const payments = newestFirst(month.transactions.filter((t) => t.kind === "payment"));
  const others = newestFirst(month.transactions.filter((t) => t.kind !== "payment"));
  const hasActivity =
    month.transactions.length > 0 || chargeShown(month.interest) || chargeShown(month.escrow);
  const nameOf = (id: string | null) =>
    accounts.find((a) => a.id === id)?.name ?? "another account";
  const signed = (amount: string) => format(BigInt(amount));
  const paymentText = (t: LoanLineData) =>
    `${signed(t.amount)} from ${nameOf(t.fromAccountId)} on ${dayLabel(t.date)}${t.memo ? `: ${t.memo}` : ""}`;
  const otherText = (t: LoanLineData) =>
    `${signed(t.amount)} ${OTHER_LABELS[otherKind(t)]} on ${dayLabel(t.date)}${t.memo ? `: ${t.memo}` : ""}`;
  const Toggle = open ? ChevronDown : ChevronRight;
  const otherTotal = others.reduce((s, t) => s + BigInt(t.amount), 0n);
  const status = paymentStatus(month);
  const upcomingTotal = upcoming.reduce((s, u) => s + BigInt(u.amount), 0n);
  const upcomingLine = (
    <>
      <UpcomingActivity
        label={upcomingLabel(upcoming.length)}
        transactions={upcoming}
        format={(m) => `+${format(BigInt(m))}`}
        formatDate={formatDate}
        onOpen={onOpenUpcoming}
        align="start"
        className="text-primary-text"
      />{" "}
      for {format(upcomingTotal)}
    </>
  );

  return (
    <div className="overflow-hidden rounded-lg border">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="flex items-center gap-1 font-semibold text-sm">
          {longMonth(month.month)}
          <Toggle className="size-4" aria-hidden />
        </span>
        {hasActivity && (
          <span className="grid justify-items-end text-sm tabular-nums">
            {format(BigInt(month.endBalance))}
            {first && <span className="text-muted-foreground text-xs">Initial Balance</span>}
          </span>
        )}
      </button>
      {open && (
        <div>
          <Row
            amount={
              payments.length > 0 ? (
                <span className="text-emerald-700 dark:text-emerald-400">
                  {format(BigInt(month.payments))}
                </span>
              ) : undefined
            }
            onClick={payments.length > 1 ? () => setShowPayments(!showPayments) : undefined}
          >
            <span className="flex items-center gap-2 font-medium">
              <StatusIcon status={status} />
              Payments
              {payments.length > 1 &&
                (showPayments ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                ))}
            </span>
            <span className="pl-6 text-muted-foreground text-xs">
              {payments.length === 0 ? (
                upcoming.length > 0 ? (
                  upcomingLine
                ) : (
                  "No payments this month"
                )
              ) : payments.length === 1 && payments[0] ? (
                <PaymentLink budgetId={budgetId} line={payments[0]}>
                  {paymentText(payments[0])}
                </PaymentLink>
              ) : (
                `From ${joinAnd([...new Set(payments.map((p) => nameOf(p.fromAccountId)))])} on ${datesLabel(payments)}`
              )}
            </span>
          </Row>
          {payments.length > 1 &&
            showPayments &&
            payments.map((p) => (
              <Row key={p.id} className="pl-12 text-muted-foreground">
                <PaymentLink budgetId={budgetId} line={p}>
                  {paymentText(p)}
                </PaymentLink>
              </Row>
            ))}
          {payments.length > 0 && upcoming.length > 0 && (
            <Row className="pl-10 text-muted-foreground text-xs">
              <span>{upcomingLine}</span>
            </Row>
          )}
          {chargeShown(month.interest) && (
            <Row
              amount={format(-BigInt(month.interest.applied))}
              onClick={onEditCharge && (() => onEditCharge("interest"))}
            >
              <span className="flex items-center gap-2 pl-6 font-medium">
                Interest Charges This Month
                {onEditCharge && <EditMark />}
              </span>
              <span className="pl-6 text-muted-foreground text-xs">
                {chargeNote("interest", month.interest, format)}
              </span>
            </Row>
          )}
          {chargeShown(month.escrow) && (
            <Row
              amount={format(-BigInt(month.escrow.applied))}
              onClick={onEditCharge && (() => onEditCharge("escrow"))}
            >
              <span className="flex items-center gap-2 pl-6 font-medium">
                Escrow Held
                {onEditCharge && <EditMark />}
              </span>
              <span className="pl-6 text-muted-foreground text-xs">
                {chargeNote("escrow", month.escrow, format)}
              </span>
            </Row>
          )}
          {others.length > 0 && (
            <>
              <Row
                amount={format(otherTotal)}
                onClick={
                  others.length > 1
                    ? () => setShowOther(!showOther)
                    : others[0] && onEditLine
                      ? () => others[0] && onEditLine(others[0])
                      : undefined
                }
              >
                <span className="flex items-center gap-2 font-medium">
                  <Badge
                    variant="secondary"
                    className="h-4 min-w-4 justify-center px-1 text-[10px]"
                  >
                    {others.length}
                  </Badge>
                  Other Activity
                  {others.length > 1 &&
                    (showOther ? (
                      <ChevronDown className="size-3.5" />
                    ) : (
                      <ChevronRight className="size-3.5" />
                    ))}
                </span>
                <span className="pl-6 text-muted-foreground text-xs">
                  {others.length === 1 && others[0]
                    ? otherText(others[0])
                    : `Activity on ${datesLabel(others)}`}
                </span>
              </Row>
              {others.length > 1 &&
                showOther &&
                others.map((t) => (
                  <Row
                    key={t.id}
                    className="pl-12 text-muted-foreground"
                    onClick={onEditLine && (() => onEditLine(t))}
                  >
                    <span>{otherText(t)}</span>
                  </Row>
                ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const EditMark = () => (
  <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
);

/** A payment line; it jumps to the paying side. */
function PaymentLink({
  budgetId,
  line,
  children,
}: {
  budgetId: string;
  line: LoanLineData;
  children: ReactNode;
}) {
  if (!line.fromAccountId || !line.otherSideId) return <span>{children}</span>;
  return (
    <Link
      to="/budgets/$budgetId/accounts/$accountId"
      params={{ budgetId, accountId: line.fromAccountId }}
      search={{ transaction: line.otherSideId }}
      title="Click to jump to the other side of this transfer"
      className="inline-flex items-center gap-1 hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      <ArrowLeftRight className="size-3" aria-hidden />
      {children}
    </Link>
  );
}
