import type { components } from "@strictbudget/api-client";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPES, type AccountType } from "@strictbudget/engine";
import { Alert, AlertDescription, AlertTitle } from "@strictbudget/ui/components/alert";
import { Button } from "@strictbudget/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
import { apiClient } from "@/lib/api";
import { apiErrorMessage, invalidateBudgets } from "@/lib/budgets";
import { BudgetForm, type BudgetFormValues } from "./budget-form";

type Report = components["schemas"]["ExternalImportReport"];
type Plan = components["schemas"]["ExternalPlanList"]["plans"][number];
type PreviewAccount = components["schemas"]["ExternalFilesPreview"]["accounts"][number];

const COUNT_LABELS: Record<string, string> = {
  accounts: "accounts",
  categories: "categories",
  transactions: "transactions",
  scheduledTransactions: "scheduled transactions",
  assignments: "assigned amounts",
  targets: "targets",
};

function ImportReport({
  report,
  onOpen,
  onReplace,
}: {
  report: Report;
  onOpen: () => void;
  /** Offered when this source was imported before. */
  onReplace?: () => void;
}) {
  const counts = report.counts
    ? Object.entries(COUNT_LABELS)
        .map(([key, label]) => `${report.counts?.[key] ?? 0} ${label}`)
        .join(" · ")
    : null;
  return (
    <div className="grid gap-4">
      {report.reused ? (
        <Alert>
          <AlertTitle>You imported this before</AlertTitle>
          <AlertDescription>
            "{report.budget.name}" came from the same source. Open it, or import again to replace it
            with a fresh copy.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-1">
          <p className="font-medium">Imported "{report.budget.name}".</p>
          {counts && <p className="text-muted-foreground text-sm">{counts}</p>}
        </div>
      )}
      {report.warnings.length > 0 && (
        <div className="grid gap-2">
          <p className="font-medium text-sm">Couldn't come over as it was</p>
          <ul className="grid max-h-48 list-disc gap-1 overflow-y-auto pl-5 text-muted-foreground text-sm">
            {report.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <DialogFooter>
        {report.reused && onReplace && (
          <Button variant="outline" onClick={onReplace}>
            Import again
          </Button>
        )}
        <Button onClick={onOpen}>Open budget</Button>
      </DialogFooter>
    </div>
  );
}

function useOpenBudget(onDone: () => void) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async (budgetId: string) => {
    await invalidateBudgets(queryClient);
    onDone();
    await navigate({ to: "/budgets/$budgetId", params: { budgetId } });
  };
}

/** The personal access token is sent with each request and never kept. */
export function ExternalApiImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [token, setToken] = useState("");
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [planId, setPlanId] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const tokenId = useId();
  const planFieldId = useId();
  const openBudget = useOpenBudget(() => onOpenChange(false));

  const reset = () => {
    setToken("");
    setPlans(null);
    setPlanId("");
    setReport(null);
    setError(null);
  };

  async function findPlans(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const { data, error } = await apiClient.POST("/v1/budgets/import/external/plans", {
      body: { token: token.trim() },
    });
    setPending(false);
    if (!data) {
      setError(apiErrorMessage(error, "Couldn't reach YNAB. Try again."));
      return;
    }
    setPlans(data.plans);
    setPlanId(data.plans[0]?.id ?? "");
  }

  async function runImport(replace = false) {
    setPending(true);
    setError(null);
    const { data, error } = await apiClient.POST("/v1/budgets/import/external", {
      body: { token: token.trim(), planId, replace },
    });
    setPending(false);
    if (!data) {
      setError(apiErrorMessage(error, "Couldn't import the plan. Try again."));
      return;
    }
    setReport(data);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from YNAB</DialogTitle>
          <DialogDescription>
            Bring a whole YNAB plan over as a new budget: accounts, categories, targets, payees,
            transactions, assigned money and scheduled transactions.
          </DialogDescription>
        </DialogHeader>
        {report ? (
          <ImportReport
            report={report}
            onOpen={() => void openBudget(report.budget.id)}
            onReplace={() => void runImport(true)}
          />
        ) : plans === null ? (
          <form onSubmit={(e) => void findPlans(e)} className="grid gap-4">
            <Field>
              <FieldLabel htmlFor={tokenId}>Personal access token</FieldLabel>
              <Input
                id={tokenId}
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
              />
              <FieldDescription>
                Make one in YNAB under Account Settings → Developer Settings. strictbudget uses it
                for this import only and doesn't keep it.
              </FieldDescription>
            </Field>
            {error && <FieldError>{error}</FieldError>}
            <DialogFooter>
              <Button type="submit" disabled={pending || !token.trim()}>
                {pending && <Spinner />}
                Find my plans
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="grid gap-4">
            {plans.length === 0 ? (
              <p className="text-muted-foreground text-sm">That token has no plans.</p>
            ) : (
              <Field>
                <FieldLabel htmlFor={planFieldId}>Plan</FieldLabel>
                <NativeSelect
                  id={planFieldId}
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                >
                  {plans.map((p) => (
                    <NativeSelectOption key={p.id} value={p.id}>
                      {p.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {error && <FieldError>{error}</FieldError>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setPlans(null)} disabled={pending}>
                Back
              </Button>
              <Button onClick={() => void runImport()} disabled={pending || !planId}>
                {pending && <Spinner />}
                {pending ? "Importing…" : "Import"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const DEFAULT_SETTINGS: BudgetFormValues = {
  name: "",
  currency: "USD",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
};

/** The export files don't say what type each account is, so the user picks it. */
export function ExternalFilesImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [files, setFiles] = useState<{ plan: string | null; register: string | null }>({
    plan: null,
    register: null,
  });
  const [settings, setSettings] = useState<BudgetFormValues | null>(null);
  const [accounts, setAccounts] = useState<PreviewAccount[] | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const planId = useId();
  const registerId = useId();
  const openBudget = useOpenBudget(() => onOpenChange(false));

  const reset = () => {
    setFiles({ plan: null, register: null });
    setSettings(null);
    setAccounts(null);
    setReport(null);
    setError(null);
  };

  async function preview(values: BudgetFormValues): Promise<string | null> {
    if (!files.plan || !files.register) return "Choose both files first.";
    const { data, error } = await apiClient.POST("/v1/budgets/import/external-files", {
      body: { ...values, plan: files.plan, register: files.register, dryRun: true },
    });
    if (!data || !("accounts" in data)) {
      return apiErrorMessage(error, "Couldn't read the files.");
    }
    setSettings(values);
    setAccounts(data.accounts);
    return null;
  }

  async function runImport(replace = false) {
    if (!settings || !accounts || !files.plan || !files.register) return;
    setPending(true);
    setError(null);
    const { data, error } = await apiClient.POST("/v1/budgets/import/external-files", {
      body: {
        ...settings,
        plan: files.plan,
        register: files.register,
        accountTypes: Object.fromEntries(accounts.map((a) => [a.name, a.type])),
        replace,
      },
    });
    setPending(false);
    if (!data || !("budget" in data)) {
      setError(apiErrorMessage(error, "Couldn't import the files. Try again."));
      return;
    }
    setReport(data);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import YNAB's exported files</DialogTitle>
          <DialogDescription>
            The two files YNAB's Export Plan saves (Plan and Register). They carry your categories,
            assigned money and transactions, but not targets, scheduled transactions or account
            types.
          </DialogDescription>
        </DialogHeader>
        {report ? (
          <ImportReport
            report={report}
            onOpen={() => void openBudget(report.budget.id)}
            onReplace={() => void runImport(true)}
          />
        ) : accounts === null ? (
          <div className="grid gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={planId}>Plan file</FieldLabel>
                <Input
                  id={planId}
                  type="file"
                  accept=".csv,.tsv,text/csv,text/tab-separated-values"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    setFiles((f) => ({ ...f, plan: null }));
                    void file?.text().then((text) => setFiles((f) => ({ ...f, plan: text })));
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={registerId}>Register file</FieldLabel>
                <Input
                  id={registerId}
                  type="file"
                  accept=".csv,.tsv,text/csv,text/tab-separated-values"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    setFiles((f) => ({ ...f, register: null }));
                    void file?.text().then((text) => setFiles((f) => ({ ...f, register: text })));
                  }}
                />
              </Field>
            </div>
            <p className="text-muted-foreground text-sm">
              Set the plan's currency and formats as YNAB showed them, so amounts and dates read
              right.
            </p>
            <BudgetForm
              defaultValues={settings ?? DEFAULT_SETTINGS}
              submitLabel="Continue"
              pendingLabel="Reading…"
              onSubmit={preview}
            />
          </div>
        ) : (
          <div className="grid gap-4">
            <p className="text-sm">
              YNAB's files don't say what kind each account is. Check the guesses:
            </p>
            <div className="grid max-h-80 gap-2 overflow-y-auto">
              {accounts.map((a, i) => (
                <div key={a.name} className="grid grid-cols-[1fr_12rem] items-center gap-3">
                  <span className="truncate text-sm">{a.name}</span>
                  <NativeSelect
                    aria-label={`Type of ${a.name}`}
                    value={a.type}
                    onChange={(e) =>
                      setAccounts((list) =>
                        (list ?? []).map((x, j) =>
                          j === i
                            ? { ...x, type: e.target.value as AccountType, guessed: false }
                            : x,
                        ),
                      )
                    }
                  >
                    {ACCOUNT_TYPES.map((t) => (
                      <NativeSelectOption key={t} value={t}>
                        {ACCOUNT_TYPE_LABELS[t]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              ))}
            </div>
            {error && <FieldError>{error}</FieldError>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setAccounts(null)} disabled={pending}>
                Back
              </Button>
              <Button onClick={() => void runImport()} disabled={pending}>
                {pending && <Spinner />}
                {pending ? "Importing…" : "Import"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
