import type { components } from "@strictbudget/api-client";
import {
  applyStatementOptions,
  CSV_DATE_FORMATS,
  type CsvDateFormat,
  type CsvMapping,
  csvColumnNames,
  csvRows,
  type ImportRow,
  ofxRows,
  parseCsvText,
  possibleDateFormats,
  qifRows,
  readOfx,
  readQif,
  type StatementOptions,
} from "@strictbudget/engine";
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
import { Label } from "@strictbudget/ui/components/label";
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import { cn } from "@strictbudget/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, CircleAlert, FileUp, Info } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { accountsQueryOptions } from "@/lib/accounts";
import { $api } from "@/lib/api";
import { useBudget } from "@/lib/budget-context";
import { todayIso } from "@/lib/dates";
import {
  type CsvSetup,
  dateCandidates,
  dateFormatChoices,
  hideIntro,
  IMPORT_FILE_ACCEPT,
  type ImportFileKind,
  importFileKind,
  initialCsvSetup,
  introHidden,
} from "@/lib/file-import";
import { refreshTransactions } from "@/lib/transactions";

interface LoadedFile {
  name: string;
  kind: ImportFileKind;
  text: string;
}

/**
 * The register's File Import: an explainer (unless turned off),
 * then the file picker, then Import Transactions for the chosen account.
 */
export function FileImportButton({ accountId }: { accountId?: string }) {
  const [introOpen, setIntroOpen] = useState(false);
  const [file, setFile] = useState<LoadedFile | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function pick(chosen: File | undefined) {
    if (!chosen) return;
    const kind = importFileKind(chosen.name);
    if (!kind) {
      toast.error("Choose a CSV, TSV, OFX, QFX or QIF file");
      return;
    }
    setFile({ name: chosen.name, kind, text: await chosen.text() });
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => (introHidden() ? input.current?.click() : setIntroOpen(true))}
      >
        <FileUp /> File Import
      </Button>
      <input
        ref={input}
        type="file"
        accept={IMPORT_FILE_ACCEPT}
        className="hidden"
        aria-label="Import file"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <FileImportIntro
        open={introOpen}
        onOpenChange={setIntroOpen}
        onChoose={(dontShow) => {
          if (dontShow) hideIntro();
          setIntroOpen(false);
          input.current?.click();
        }}
      />
      {file && (
        <ImportTransactionsDialog
          file={file}
          initialAccountId={accountId}
          onClose={() => setFile(null)}
        />
      )}
    </>
  );
}

/**
 * A File Import starts when a file is dropped anywhere in the app: into the open account's
 * register, or with no account picked.
 */
export function FileDropImport() {
  const { accountId } = useParams({ strict: false }) as { accountId?: string };
  const [file, setFile] = useState<LoadedFile | null>(null);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const chosen = e.dataTransfer?.files[0];
      if (!chosen) return;
      const kind = importFileKind(chosen.name);
      if (!kind) {
        toast.error("Choose a CSV, TSV, OFX, QFX or QIF file");
        return;
      }
      setFile({ name: chosen.name, kind, text: await chosen.text() });
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);
  if (!file) return null;
  return (
    <ImportTransactionsDialog
      file={file}
      initialAccountId={accountId}
      onClose={() => setFile(null)}
    />
  );
}

function FileImportIntro({
  open,
  onOpenChange,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (dontShowAgain: boolean) => void;
}) {
  const [dontShow, setDontShow] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>File Import</DialogTitle>
          <DialogDescription>
            To import transactions without linking your financial institution, first download a set
            of transactions from your bank or credit card website.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1 text-sm">
          <p>Recommended formats: OFX and QFX</p>
          <p>Supported formats: QIF and CSV</p>
        </div>
        <div className="flex gap-3 rounded-md bg-muted p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0" />
          <p>
            Worried about duplicates? Transactions entered by you will match automatically, and ones
            you've already imported are skipped.
          </p>
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <Label className="font-normal">
            <Checkbox checked={dontShow} onCheckedChange={(v) => setDontShow(v === true)} />
            Don't show again
          </Label>
          <Button onClick={() => onChoose(dontShow)}>Choose File</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Result = { title: string; message: string };

function ImportTransactionsDialog(props: {
  file: LoadedFile;
  initialAccountId?: string;
  onClose: () => void;
}) {
  return props.file.kind === "csv" ? (
    <CsvImportDialog {...props} />
  ) : (
    <StatementImportDialog {...props} />
  );
}

/**
 * What both Import Transactions dialogs share: the account choice, its import
 * context (start date, last reconciliation, remembered settings), the "dated before" cutoff and
 * the import itself, after which everything the new transactions show up in refetches.
 */
function useFileImport(initialAccountId: string | undefined) {
  const { budget } = useBudget();
  const queryClient = useQueryClient();
  const accounts = useQuery(accountsQueryOptions(budget.id));
  const open = (accounts.data?.accounts ?? []).filter((a) => !a.closed);
  const [accountId, setAccountId] = useState(initialAccountId ?? "");
  const account = open.find((a) => a.id === accountId);
  const context = $api.useQuery(
    "get",
    "/v1/budgets/{budgetId}/accounts/{accountId}/import-context",
    { params: { path: { budgetId: budget.id, accountId } } },
    { enabled: accountId !== "" },
  );
  const submit = $api.useMutation("post", "/v1/budgets/{budgetId}/accounts/{accountId}/import");
  const [result, setResult] = useState<Result | null>(null);
  const [includeEarly, setIncludeEarly] = useState(false);
  const cutoff = laterOf(context.data?.startDate ?? null, context.data?.reconciledThrough ?? null);

  /** The file's rows dated before the cutoff, and the ones to import. */
  function byCutoff(all: readonly ImportRow[]) {
    if (!account) return { early: [], rows: [] };
    const early = cutoff ? all.filter((r) => r.date < cutoff) : [];
    const rows = includeEarly ? [...all] : all.filter((r) => !cutoff || r.date >= cutoff);
    return { early, rows };
  }

  async function run(rows: readonly ImportRow[], settings: ImportSettings) {
    if (!account) return;
    try {
      const done = await submit.mutateAsync({
        params: {
          path: { budgetId: budget.id, accountId: account.id },
          query: { today: todayIso() },
        },
        body: {
          transactions: rows.map((r) => ({ ...r, amount: r.amount.toString() })),
          ...settings,
        },
      });
      await Promise.all([
        refreshTransactions(queryClient, budget.id),
        queryClient.invalidateQueries({
          queryKey: ["get", "/v1/budgets/{budgetId}/accounts/{accountId}/import-context"],
        }),
      ]);
      setResult(resultMessage(rows.length, done.imported, done.matched));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
    }
  }

  return {
    accounts: open,
    accountId,
    account,
    /** Another account brings its own remembered settings and start date. */
    chooseAccount: (id: string) => {
      setAccountId(id);
      setIncludeEarly(false);
    },
    context: context.data,
    /** The start date or last reconciliation, whichever is later: rows before it are skipped. */
    cutoff,
    includeEarly,
    setIncludeEarly,
    byCutoff,
    run,
    pending: submit.isPending,
    result,
  };
}

type ImportSettings = Pick<
  components["schemas"]["ImportTransactions"],
  "csvSettings" | "statementSettings"
>;

function ResultDialog({ result, onClose }: { result: Result; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{result.title}</DialogTitle>
          <DialogDescription>{result.message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountSelect({
  accounts,
  value,
  onChange,
}: {
  accounts: readonly { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <NativeSelect aria-label="Account" value={value} onChange={(e) => onChange(e.target.value)}>
      <NativeSelectOption value="">Select an account...</NativeSelectOption>
      {accounts.map((a) => (
        <NativeSelectOption key={a.id} value={a.id}>
          {a.name}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

function CsvImportDialog({
  file,
  initialAccountId,
  onClose,
}: {
  file: LoadedFile;
  initialAccountId?: string;
  onClose: () => void;
}) {
  const { budget, formatAmount, formatDate } = useBudget();
  const fileImport = useFileImport(initialAccountId);
  const { account, context, cutoff, includeEarly, setIncludeEarly, result } = fileImport;

  const table = useMemo(() => (file.kind === "csv" ? parseCsvText(file.text) : []), [file]);
  const [setup, setSetup] = useState<CsvSetup | null>(null);
  // The account's remembered settings arrive with its context; until then, a guess from the file.
  const current = setup ?? initialCsvSetup(table, context?.csvSettings ?? null);
  const update = (patch: Partial<CsvSetup>) => setSetup({ ...current, ...patch });
  const [remember, setRemember] = useState(true);
  const [skippedOpen, setSkippedOpen] = useState(true);

  const columns = csvColumnNames(table, current.noHeaderRow);
  const candidates = dateCandidates(table, current.mapping.date, current.noHeaderRow);
  const firstDate =
    current.mapping.date === null
      ? ""
      : (table[current.noHeaderRow ? 0 : 1]?.[current.mapping.date] ?? "");
  const dateUnclear = current.mapping.date !== null && current.dateFormat === null;
  const mapped =
    current.mapping.date !== null &&
    current.mapping.payee !== null &&
    current.mapping.outflow !== null &&
    current.mapping.inflow !== null &&
    current.dateFormat !== null;
  const read =
    account && mapped
      ? csvRows(table, current.mapping, current, account.currency, budget.numberFormat)
      : { rows: [], errors: [] };

  const { early, rows } = fileImport.byCutoff(read.rows);
  const skipped = read.rows.length - rows.length;

  async function runImport() {
    const settings = {
      columns,
      mapping: current.mapping,
      noHeaderRow: current.noHeaderRow,
      swapInflowOutflow: current.swapInflowOutflow,
      dateFormat: current.dateFormat,
    };
    await fileImport.run(rows, remember ? { csvSettings: settings } : {});
  }

  if (result) return <ResultDialog result={result} onClose={onClose} />;

  const amountCell = (r: ImportRow) =>
    `${r.amount < 0n ? "-" : "+"}${formatAmount({
      amount: r.amount < 0n ? -r.amount : r.amount,
      currency: account?.currency ?? budget.currency,
    })}`;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Transactions</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 text-sm">
          <div className="grid gap-2">
            <p>
              {rows.length} {rows.length === 1 ? "Transaction" : "Transactions"} from{" "}
              <strong>{file.name}</strong> will be imported into
            </p>
            <AccountSelect
              accounts={fileImport.accounts}
              value={fileImport.accountId}
              onChange={(id) => {
                fileImport.chooseAccount(id);
                setSetup(null);
              }}
            />
          </div>
          {file.kind === "csv" ? (
            <div className="grid gap-2">
              <p>Choose the CSV column to match the field.</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {(["date", "payee", "memo", "outflow", "inflow"] as const).map((field) => (
                  <div key={field} className="grid gap-1">
                    <Label
                      htmlFor={`csv-${field}`}
                      className={cn(
                        field === "date" && dateUnclear && "text-amber-700 dark:text-amber-400",
                      )}
                    >
                      {FIELD_LABELS[field]}
                      {field === "date" && dateUnclear && <CircleAlert className="size-3.5" />}
                    </Label>
                    <NativeSelect
                      id={`csv-${field}`}
                      value={current.mapping[field] === null ? "" : String(current.mapping[field])}
                      onChange={(e) => {
                        const value = e.target.value === "" ? null : Number(e.target.value);
                        const mapping: CsvMapping = { ...current.mapping, [field]: value };
                        if (field !== "date") return update({ mapping });
                        const found = dateCandidates(table, value, current.noHeaderRow);
                        update({
                          mapping,
                          dateFormat: found.length === 1 ? (found[0] ?? null) : null,
                        });
                      }}
                    >
                      <NativeSelectOption value="">Select...</NativeSelectOption>
                      {columns.map((name, i) => (
                        <NativeSelectOption key={`${i}-${name}`} value={String(i)}>
                          {name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>
                ))}
              </div>
              {dateUnclear && (
                <DateFormatPrompt
                  // A new set of choices starts the select over.
                  key={`${firstDate}|${candidates.join(",")}`}
                  fileName={file.name}
                  first={firstDate}
                  candidates={candidates}
                  onSave={(dateFormat) => update({ dateFormat })}
                />
              )}
            </div>
          ) : null}
          <div className="max-h-56 overflow-auto rounded-md border">
            {rows.length === 0 ? (
              <div className="m-4 grid gap-1 rounded-md bg-muted p-3 text-center">
                <p className="font-medium">No Transactions to import.</p>
                <p>
                  This can happen if transactions are being skipped. See section below for more
                  info.
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${i}-${r.date}`} className="border-b last:border-0">
                      <td
                        className={cn(
                          "px-2 py-1.5 whitespace-nowrap",
                          cutoff && r.date < cutoff && "text-amber-700 dark:text-amber-400",
                        )}
                      >
                        {formatDate(r.date)}
                      </td>
                      <td className="max-w-40 truncate px-2 py-1.5">{r.payee}</td>
                      <td className="max-w-40 truncate px-2 py-1.5">{r.memo}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {r.amount < 0n ? amountCell(r) : ""}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {r.amount > 0n ? amountCell(r) : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {read.errors.length > 0 && (
            <p className="text-muted-foreground">
              {read.errors.length === 1 ? "1 row" : `${read.errors.length} rows`} can't be read
              (line {read.errors.map((e) => e.line).join(", ")}) and won't be imported.
            </p>
          )}
          {early.length > 0 && (
            <div className="grid gap-2">
              <button
                type="button"
                className="flex items-center gap-1 justify-self-start"
                aria-expanded={skippedOpen}
                onClick={() => setSkippedOpen((v) => !v)}
              >
                {skipped} {skipped === 1 ? "transaction" : "transactions"} will be skipped
                {skippedOpen ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
              </button>
              {skippedOpen && (
                <div className="grid gap-2 rounded-md bg-amber-50 p-3 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
                  <p>
                    This file has transactions dated before the account's start date or last
                    reconciliation. Importing them will modify the start date for this account.
                  </p>
                  <Label className="font-normal">
                    <Checkbox
                      checked={includeEarly}
                      onCheckedChange={(v) => setIncludeEarly(v === true)}
                    />
                    Include {early.length} {early.length === 1 ? "transaction" : "transactions"}{" "}
                    dated before account start date or last reconciliation
                  </Label>
                </div>
              )}
            </div>
          )}
          {file.kind === "csv" && (
            <div className="grid gap-2">
              <p className="font-medium">Options</p>
              <Label className="font-normal">
                <Checkbox
                  checked={current.noHeaderRow}
                  onCheckedChange={(v) => {
                    const noHeaderRow = v === true;
                    const found = dateCandidates(table, current.mapping.date, noHeaderRow);
                    update({
                      noHeaderRow,
                      dateFormat: found.length === 1 ? (found[0] ?? null) : null,
                    });
                  }}
                />
                No header row
              </Label>
              <Label className="font-normal">
                <Checkbox
                  checked={current.swapInflowOutflow}
                  onCheckedChange={(v) => update({ swapInflowOutflow: v === true })}
                />
                Swap Inflow and Outflow
              </Label>
              <Label className="font-normal">
                <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
                Remember setting for this account
              </Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={runImport}
            disabled={!account || rows.length === 0 || fileImport.pending}
          >
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Import Transactions for an OFX/QFX or QIF file: "N
 * transactions will be imported from CHECKING: ***2345 into", the skip notice on top, the
 * preview with unsigned amounts, then Import Memos, Swap Payee and Memo, Swap Inflow and
 * Outflow and Remember setting for this account. A QIF file's unclear dates are asked about
 * as in a CSV.
 */
function StatementImportDialog({
  file,
  initialAccountId,
  onClose,
}: {
  file: LoadedFile;
  initialAccountId?: string;
  onClose: () => void;
}) {
  const { budget, formatAmount, formatDate } = useBudget();
  const fileImport = useFileImport(initialAccountId);
  const { account, context, includeEarly, setIncludeEarly, result } = fileImport;
  const currency = account?.currency ?? budget.currency;
  const [options, setOptions] = useState<StatementOptions | null>(null);
  const current = options ?? context?.statementSettings ?? DEFAULT_STATEMENT_OPTIONS;
  const set = (patch: Partial<StatementOptions>) => setOptions({ ...current, ...patch });
  const [remember, setRemember] = useState(true);
  const [qifFormat, setQifFormat] = useState<CsvDateFormat | null>(null);

  const read = useMemo(() => {
    try {
      const statement =
        file.kind === "ofx"
          ? readOfx(file.text, currency)
          : readQif(file.text, currency, budget.numberFormat);
      return { statement, error: null };
    } catch (error) {
      return { statement: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [file, currency, budget.numberFormat]);
  const statement = read.statement;
  const qifCandidates =
    statement && file.kind === "qif"
      ? possibleDateFormats(statement.entries.map((e) => e.date))
      : [];
  const dateFormat = qifFormat ?? (qifCandidates.length === 1 ? (qifCandidates[0] ?? null) : null);
  const dateUnclear =
    file.kind === "qif" && statement !== null && statement.entries.length > 0 && !dateFormat;
  let parsed: ImportRow[] = [];
  if (statement && file.kind === "ofx") parsed = ofxRows(statement);
  else if (statement && dateFormat) parsed = qifRows(statement, dateFormat);
  const all = applyStatementOptions(parsed, current);
  const { early, rows } = fileImport.byCutoff(all);

  async function runImport() {
    await fileImport.run(rows, remember ? { statementSettings: current } : {});
  }

  if (result) return <ResultDialog result={result} onClose={onClose} />;
  const money = (amount: bigint) =>
    formatAmount({ amount: amount < 0n ? -amount : amount, currency });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Transactions</DialogTitle>
        </DialogHeader>
        {read.error ? (
          <p className="text-destructive text-sm">
            {file.name} couldn't be read: {read.error}
          </p>
        ) : (
          <div className="grid gap-4 text-sm">
            <div className="grid gap-2">
              <p>
                {rows.length} {rows.length === 1 ? "transaction" : "transactions"} will be imported
                from <strong>{statement?.source}</strong> into
              </p>
              <AccountSelect
                accounts={fileImport.accounts}
                value={fileImport.accountId}
                onChange={fileImport.chooseAccount}
              />
            </div>
            {early.length > 0 && (
              <div className="grid gap-2 rounded-md bg-amber-50 p-3 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
                <p className="italic">
                  This file has transactions dated before the account's start date or last
                  reconciliation. Importing them will modify the start date for this account.
                </p>
                <Label className="font-normal">
                  <Checkbox
                    checked={includeEarly}
                    onCheckedChange={(v) => setIncludeEarly(v === true)}
                  />
                  Include {early.length} {early.length === 1 ? "transaction" : "transactions"} dated
                  before account start date or last reconciliation
                </Label>
              </div>
            )}
            {dateUnclear && statement && (
              <DateFormatPrompt
                key={qifCandidates.join(",")}
                fileName={file.name}
                first={statement.entries[0]?.date ?? ""}
                candidates={qifCandidates}
                onSave={setQifFormat}
              />
            )}
            <div className="grid gap-1">
              <p className="font-medium">Preview</p>
              <div className="max-h-56 overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-xs uppercase">
                      <th className="px-2 py-1 text-left font-medium">Date</th>
                      <th className="px-2 py-1 text-left font-medium">Payee</th>
                      <th className="px-2 py-1 text-left font-medium">Memo</th>
                      <th className="px-2 py-1 text-right font-medium">Outflow</th>
                      <th className="px-2 py-1 text-right font-medium">Inflow</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-2 py-2">
                          No transactions to import
                        </td>
                      </tr>
                    ) : (
                      rows.map((r, i) => (
                        <tr key={`${i}-${r.date}`} className="border-b last:border-0">
                          <td className="whitespace-nowrap px-2 py-1.5">{formatDate(r.date)}</td>
                          <td className="max-w-40 truncate px-2 py-1.5">{r.payee}</td>
                          <td className="max-w-40 truncate px-2 py-1.5">{r.memo}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {r.amount < 0n ? money(r.amount) : ""}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {r.amount > 0n ? money(r.amount) : ""}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="grid gap-2">
              <p className="font-medium">Options</p>
              <Label className="font-normal">
                <Checkbox
                  checked={current.importMemos}
                  onCheckedChange={(v) => set({ importMemos: v === true })}
                />
                Import Memos
              </Label>
              <Label className="font-normal">
                <Checkbox
                  checked={current.swapPayeeMemo}
                  onCheckedChange={(v) => set({ swapPayeeMemo: v === true })}
                />
                Swap Payee and Memo
              </Label>
              <Label className="font-normal">
                <Checkbox
                  checked={current.swapInflowOutflow}
                  onCheckedChange={(v) => set({ swapInflowOutflow: v === true })}
                />
                Swap Inflow and Outflow
              </Label>
              <Label className="font-normal">
                <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
                Remember setting for this account
              </Label>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={runImport}
            disabled={!account || rows.length === 0 || fileImport.pending}
          >
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const DEFAULT_STATEMENT_OPTIONS: StatementOptions = {
  importMemos: true,
  swapPayeeMemo: false,
  swapInflowOutflow: false,
};

const FIELD_LABELS = {
  date: "Date",
  payee: "Payee",
  memo: "Memo (optional)",
  outflow: "Outflow",
  inflow: "Inflow",
} as const;

/** The "The date format of … is unclear" prompt. */
function DateFormatPrompt({
  fileName,
  first,
  candidates,
  onSave,
}: {
  fileName: string;
  first: string;
  candidates: readonly CsvDateFormat[];
  onSave: (format: CsvDateFormat) => void;
}) {
  const choices = dateFormatChoices(first, candidates, CSV_DATE_FORMATS);
  const [choice, setChoice] = useState<CsvDateFormat | "">(choices[0]?.format ?? "");
  return (
    <fieldset
      className="grid max-w-sm gap-2 rounded-md border bg-popover p-3 shadow-sm"
      aria-label="Date format"
    >
      <p>
        The date format of <strong>{fileName}</strong> is unclear. The first transaction reads{" "}
        {first || "nothing"}. What date is this?
      </p>
      <NativeSelect
        aria-label="Date format"
        value={choice}
        onChange={(e) => setChoice(e.target.value as CsvDateFormat)}
      >
        {choices.map((c) => (
          <NativeSelectOption key={c.format} value={c.format}>
            {c.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Button
        size="sm"
        className="justify-self-end"
        disabled={!choice}
        onClick={() => choice && onSave(choice)}
      >
        Save
      </Button>
    </fieldset>
  );
}

function laterOf(a: string | null, b: string | null) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * The result dialogs: "Import Matched" when nothing new came in, otherwise "Import
 * Successful", with how many entered transactions were matched.
 */
export function resultMessage(sent: number, imported: number, matched = 0): Result {
  if (imported === 0 && sent > 0) {
    return {
      title: "Import Matched",
      message: `${sent} ${sent === 1 ? "transaction has" : "transactions have"} been successfully imported. All transactions were matched to already entered or imported transactions, so there's nothing else for you to do!`,
    };
  }
  const base = `${imported} ${imported === 1 ? "transaction has" : "transactions have"} been successfully imported.`;
  const extra =
    matched === 0
      ? ""
      : ` ${matched} previously imported ${matched === 1 ? "transaction has" : "transactions have"} been matched.`;
  return { title: "Import Successful", message: base + extra };
}
