import { isDebtAccount } from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import { Checkbox } from "@strictbudget/ui/components/checkbox";
import { Field, FieldError, FieldLabel } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import { Label } from "@strictbudget/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@strictbudget/ui/components/popover";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { type FormEvent, useEffect, useId, useState } from "react";
import type { Account } from "@/lib/accounts";
import { type MoneySettings, parseMoneyInput } from "@/lib/money-input";

// The last reconciliation is worded like moment's fromNow ("a few seconds ago", "9 days ago"),
// which dayjs's relativeTime plugin matches.
dayjs.extend(relativeTime);

/** The account header's "Reconciled 9 days ago", or "Not Yet Reconciled". */
export function reconciledLabel(lastReconciledAt: string | null, now = new Date()) {
  if (!lastReconciledAt) return "Not Yet Reconciled";
  return `Reconciled ${dayjs(lastReconciledAt).from(now)}`;
}

/** "Don't Show Again" for the difference explanation is kept in the browser, for every budget. */
const SKIP_EXPLANATION_KEY = "strictbudget:skipDifferenceExplanation";

function skipsExplanation() {
  try {
    return localStorage.getItem(SKIP_EXPLANATION_KEY) === "true";
  } catch {
    return false;
  }
}

function setSkipsExplanation(skip: boolean) {
  try {
    if (skip) localStorage.setItem(SKIP_EXPLANATION_KEY, "true");
    else localStorage.removeItem(SKIP_EXPLANATION_KEY);
  } catch {
    // Blocked storage: the explanation shows again next time.
  }
}

/**
 * The bank balance typed for `account`. Debt accounts take what's owed, so "57" and "-57" both
 * mean a balance of −57.
 */
export function bankBalance(text: string, account: Pick<Account, "type">, settings: MoneySettings) {
  const parsed = parseMoneyInput(text, settings);
  if (typeof parsed === "string") return parsed;
  if (!isDebtAccount(account.type)) return parsed;
  return parsed < 0n ? parsed : -parsed;
}

type Step = { kind: "confirm" } | { kind: "enter" } | { kind: "difference"; balance: bigint };

/**
 * Yes reconciles at the cleared balance; No asks for the bank's balance, explains the difference
 * (unless "Don't Show Again" was ticked) and starts reconciling.
 */
export function ReconcilePopover({
  account,
  settings,
  open,
  onOpenChange,
  show,
  pending,
  onConfirm,
  onStart,
}: {
  account: Account;
  settings: MoneySettings;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  show: (amount: bigint) => string;
  pending: boolean;
  /** Yes: the cleared balance is right. */
  onConfirm: () => void;
  /** The bank's balance differs; reconcile against it. */
  onStart: (balance: bigint) => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "confirm" });
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [skip, setSkip] = useState(false);
  const inputId = useId();
  const skipId = useId();
  const cleared = BigInt(account.balances.cleared);

  // Every opening (the button or Shift+E) starts over at the question.
  useEffect(() => {
    if (!open) return;
    setStep({ kind: "confirm" });
    setText("");
    setError(null);
    setSkip(false);
  }, [open]);

  function submitBalance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const balance = bankBalance(text, account, settings);
    if (typeof balance === "string") return setError(balance);
    if (balance === cleared) return onConfirm();
    if (skipsExplanation()) return onStart(balance);
    setStep({ kind: "difference", balance });
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button size="sm" title="Reconcile (Shift+E)">
          Reconcile
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        {step.kind === "confirm" && (
          <div className="grid gap-4">
            <div className="grid gap-1 rounded-md bg-muted px-3 py-3 text-center">
              <span className="text-muted-foreground text-sm">Is your current balance</span>
              <span className="font-semibold text-xl tabular-nums">{show(cleared)}?</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setStep({ kind: "enter" })}>
                No
              </Button>
              <Button disabled={pending} onClick={onConfirm}>
                Yes
              </Button>
            </div>
          </div>
        )}
        {step.kind === "enter" && (
          <form className="grid gap-4" onSubmit={submitBalance}>
            <Field>
              <FieldLabel htmlFor={inputId}>Current balance at your bank</FieldLabel>
              <Input
                id={inputId}
                inputMode="decimal"
                autoFocus
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setError(null);
                }}
              />
              {error && <FieldError>{error}</FieldError>}
            </Field>
            <Button type="submit" className="justify-self-end" disabled={!text.trim() || pending}>
              Next
            </Button>
          </form>
        )}
        {step.kind === "difference" && (
          <div className="grid gap-4 text-sm">
            <div className="grid gap-0.5 rounded-md bg-muted px-3 py-3 text-center">
              <span className="font-semibold text-xl tabular-nums">
                {show(step.balance - cleared)}
              </span>
              <span className="text-muted-foreground">Difference</span>
            </div>
            <p>
              The balance recorded in strictbudget doesn't match the balance at your financial
              institution.
            </p>
            <p>
              <strong>To correct this</strong>, compare each unlocked transaction in strictbudget
              against your account to make sure they match. strictbudget will keep track of the
              current difference at the top of your register.
            </p>
            <p>
              If you can't find the difference, that's okay! We'll make an adjustment transaction
              and you can move on.
            </p>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={skipId}
                  checked={skip}
                  onCheckedChange={(checked) => setSkip(checked === true)}
                />
                <Label htmlFor={skipId} className="font-normal">
                  Don't Show Again
                </Label>
              </div>
              <Button
                onClick={() => {
                  if (skip) setSkipsExplanation(true);
                  onStart(step.balance);
                }}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function ReconcileBanner({
  difference,
  show,
  pending,
  onCancel,
  onFinish,
}: {
  /** The bank's balance minus the cleared balance. */
  difference: bigint;
  show: (amount: bigint) => string;
  pending: boolean;
  onCancel: () => void;
  onFinish: () => void;
}) {
  const same = difference === 0n;
  return (
    <section
      aria-label="Reconciling"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-primary/10 px-4 py-3 text-sm"
    >
      <p aria-live="polite">
        This account's cleared balance in strictbudget is{" "}
        {same ? (
          <strong>the same</strong>
        ) : (
          <>
            <strong className="tabular-nums">
              {show(difference < 0n ? -difference : difference)}
            </strong>{" "}
            {difference < 0n ? "higher" : "lower"}
          </>
        )}{" "}
        {same ? "as" : "than"} your actual account.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={pending} onClick={onFinish}>
          {same ? "Finish Reconciliation" : "Create Adjustment & Finish"}
        </Button>
      </div>
    </section>
  );
}
