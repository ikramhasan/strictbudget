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
import { Calendar } from "@strictbudget/ui/components/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@strictbudget/ui/components/card";
import { Checkbox } from "@strictbudget/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@strictbudget/ui/components/item";
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@strictbudget/ui/components/popover";
import { RadioGroup, RadioGroupItem } from "@strictbudget/ui/components/radio-group";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ExternalLink, KeyRound } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";
import { $api, apiBaseUrl } from "@/lib/api";
import { apiErrorMessage, budgetsQueryOptions } from "@/lib/budgets";

const DOCS_URL = `${apiBaseUrl}/docs`;
/** The longest custom lifetime the API accepts (`API_KEY_MAX_DAYS`). */
const MAX_DAYS = 5 * 365;
const DAY_MS = 24 * 60 * 60 * 1000;
const NAME_MAX = 50;

const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

type ApiKey = {
  id: string;
  name: string;
  start: string;
  access: "read" | "write";
  budgetIds: string[] | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
};

/**
 * Personal API keys: keys for the user's own scripts and tools, scoped to read-only
 * or read & write and to every budget or some, with an expiry. A key is shown once, on creation.
 */
export function ApiKeysCard() {
  const queryClient = useQueryClient();
  const keys = $api.useQuery("get", "/v1/me/api-keys");
  const budgets = useQuery(budgetsQueryOptions());
  const revoke = $api.useMutation("delete", "/v1/me/api-keys/{keyId}");
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const budgetName = new Map((budgets.data?.budgets ?? []).map((b) => [b.id, b.name]));

  async function revokeKey(key: ApiKey) {
    try {
      await revoke.mutateAsync({ params: { path: { keyId: key.id } } });
      toast.success(`“${key.name}” revoked`);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't revoke that key."));
    }
    setRevoking(null);
    await queryClient.invalidateQueries({ queryKey: ["get", "/v1/me/api-keys"] });
  }

  function scopeText(key: ApiKey) {
    const access = key.access === "write" ? "Read & write" : "Read only";
    if (key.budgetIds === null) return `${access} · All budgets`;
    const names = key.budgetIds.map((id) => budgetName.get(id)).filter(Boolean);
    // A budget deleted since the key was made just drops out of the list.
    return `${access} · ${names.length > 0 ? names.join(", ") : "No budgets"}`;
  }

  const list = keys.data?.apiKeys ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>API Keys</CardTitle>
        <CardDescription>
          Let your own scripts and tools use your budgets through the strictbudget API. Each key
          works like your account, limited to what you choose.{" "}
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4"
          >
            API reference
            <ExternalLink className="size-3.5" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {keys.isPending ? (
          <Spinner />
        ) : keys.isError ? (
          <FieldError>Couldn't load your API keys.</FieldError>
        ) : list.length === 0 ? (
          <p className="text-muted-foreground text-sm">You don't have any API keys.</p>
        ) : (
          <ItemGroup className="gap-0 rounded-lg border">
            {list.map((key) => (
              <Item
                key={key.id}
                role="listitem"
                size="sm"
                className="rounded-none border-0 border-border border-t first:border-t-0"
              >
                <ItemMedia variant="icon">
                  <KeyRound />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="flex-wrap">
                    {key.name}
                    <code className="font-mono font-normal text-muted-foreground text-xs">
                      {key.start}…
                    </code>
                  </ItemTitle>
                  <ItemDescription className="line-clamp-none">
                    {scopeText(key)}
                    <br />
                    {/* Each fact stays on one line when the row wraps on a phone. */}
                    <span className="whitespace-nowrap">
                      {key.expiresAt
                        ? `Expires ${date.format(new Date(key.expiresAt))}`
                        : "Never expires"}
                    </span>
                    {" · "}
                    <span className="whitespace-nowrap">
                      {key.lastUsedAt
                        ? `Last used ${date.format(new Date(key.lastUsedAt))}`
                        : "Never used"}
                    </span>
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button variant="outline" size="sm" onClick={() => setRevoking(key)}>
                    Revoke
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
        <div>
          <Button onClick={() => setCreating(true)}>Create API Key</Button>
        </div>
      </CardContent>
      {creating && <CreateKeyDialog onClose={() => setCreating(false)} />}
      <AlertDialog open={revoking !== null} onOpenChange={(open) => !open && setRevoking(null)}>
        {revoking && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke “{revoking.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                Anything using this key stops working right away. This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={revoke.isPending}
                onClick={() => revokeKey(revoking)}
              >
                Revoke Key
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </Card>
  );
}

type Expiry = "30" | "90" | "365" | "custom" | "never";

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Whole days from today to `day` (both local dates). */
function daysUntil(day: Date) {
  return Math.round((day.getTime() - startOfToday().getTime()) / DAY_MS);
}

function CreateKeyDialog({ onClose }: { onClose: () => void }) {
  const id = useId();
  const queryClient = useQueryClient();
  const budgets = useQuery(budgetsQueryOptions());
  const create = $api.useMutation("post", "/v1/me/api-keys");
  const [access, setAccess] = useState<"read" | "write">("read");
  const [allBudgets, setAllBudgets] = useState(true);
  const [chosen, setChosen] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<Expiry>("90");
  const [customDay, setCustomDay] = useState<Date | undefined>(undefined);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const today = startOfToday();
  const days =
    expiry === "never"
      ? null
      : expiry === "custom"
        ? customDay
          ? daysUntil(customDay)
          : undefined
        : Number(expiry);
  const expiresOn = typeof days === "number" ? new Date(Date.now() + days * DAY_MS) : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!name) return setError("Give the key a name.");
    if (!allBudgets && chosen.length === 0) return setError("Choose at least one budget.");
    if (days === undefined) return setError("Pick the day the key expires.");
    setError(null);
    try {
      const result = await create.mutateAsync({
        body: {
          name,
          access,
          budgetIds: allBudgets ? null : chosen,
          expiresInDays: days,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["get", "/v1/me/api-keys"] });
      setCreated(result.key);
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't create the key. Try again."));
    }
  }

  if (created) {
    return (
      // Only Done closes it: the key can't be shown again.
      <Dialog open onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-lg" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Copy Your API Key</DialogTitle>
            <DialogDescription>
              This is the only time the key is shown. Copy it now and keep it somewhere safe, like a
              password manager. Anyone with it can use your budgets.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="flex gap-2">
              <Input
                readOnly
                value={created}
                aria-label="API key"
                className="font-mono"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(created);
                  toast.success("API key copied");
                }}
              >
                Copy
              </Button>
            </div>
            <p className="text-muted-foreground text-sm">
              Send it in the <code className="font-mono text-foreground">Authorization</code> header
              of each request:
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
              {`curl -H "Authorization: Bearer ${created.slice(0, 10)}…" \\\n  ${apiBaseUrl}/v1/budgets`}
            </pre>
            <DialogFooter>
              <Button variant="outline" asChild>
                <a href={DOCS_URL} target="_blank" rel="noreferrer">
                  API Reference
                  <ExternalLink aria-hidden />
                </a>
              </Button>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const budgetList = budgets.data?.budgets ?? [];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create an API Key</DialogTitle>
          <DialogDescription>
            Give each tool its own key, with only the access it needs.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5">
          <Field>
            <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
            <Input
              id={`${id}-name`}
              name="name"
              required
              maxLength={NAME_MAX}
              autoFocus
              autoComplete="off"
              placeholder="e.g. Home server"
            />
          </Field>

          <FieldSet>
            <FieldLegend variant="label">Access</FieldLegend>
            <RadioGroup
              value={access}
              onValueChange={(v) => setAccess(v as "read" | "write")}
              className="grid gap-3"
            >
              <ScopeOption
                id={`${id}-read`}
                value="read"
                title="Read only"
                hint="See budgets, accounts and transactions."
              />
              <ScopeOption
                id={`${id}-write`}
                value="write"
                title="Read & write"
                hint="Also add and change transactions, categories and assignments."
              />
            </RadioGroup>
          </FieldSet>

          <FieldSet>
            <FieldLegend variant="label">Budgets</FieldLegend>
            <RadioGroup
              value={allBudgets ? "all" : "some"}
              onValueChange={(v) => setAllBudgets(v === "all")}
              className="grid gap-3"
            >
              <ScopeOption
                id={`${id}-all`}
                value="all"
                title="All budgets"
                hint="Including budgets you create or join later."
              />
              <ScopeOption
                id={`${id}-some`}
                value="some"
                title="Only the budgets I choose"
                disabled={budgetList.length === 0}
              />
            </RadioGroup>
            {!allBudgets && (
              <div className="ml-6 grid gap-2">
                {budgetList.map((b) => (
                  <div key={b.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id={`${id}-budget-${b.id}`}
                      checked={chosen.includes(b.id)}
                      onCheckedChange={(checked) =>
                        setChosen((ids) =>
                          checked ? [...ids, b.id] : ids.filter((other) => other !== b.id),
                        )
                      }
                    />
                    <label htmlFor={`${id}-budget-${b.id}`} className="min-w-0 truncate">
                      {b.name}
                    </label>
                  </div>
                ))}
              </div>
            )}
          </FieldSet>

          <Field>
            <FieldLabel htmlFor={`${id}-expiry`}>Expiration</FieldLabel>
            <div className="flex flex-wrap gap-2">
              <NativeSelect
                id={`${id}-expiry`}
                value={expiry}
                onChange={(e) => setExpiry(e.target.value as Expiry)}
              >
                <NativeSelectOption value="30">30 days</NativeSelectOption>
                <NativeSelectOption value="90">90 days</NativeSelectOption>
                <NativeSelectOption value="365">1 year</NativeSelectOption>
                <NativeSelectOption value="custom">Custom date</NativeSelectOption>
                <NativeSelectOption value="never">No expiration</NativeSelectOption>
              </NativeSelect>
              {expiry === "custom" && (
                <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" className="font-normal">
                      <CalendarDays />
                      {customDay ? date.format(customDay) : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={customDay}
                      defaultMonth={customDay ?? new Date(today.getTime() + 30 * DAY_MS)}
                      disabled={{
                        before: new Date(today.getTime() + DAY_MS),
                        after: new Date(today.getTime() + MAX_DAYS * DAY_MS),
                      }}
                      onSelect={(day) => {
                        setCustomDay(day);
                        setCalendarOpen(false);
                      }}
                    />
                  </PopoverContent>
                </Popover>
              )}
            </div>
            <FieldDescription>
              {expiry === "never"
                ? "The key works until you revoke it. A key that expires is safer."
                : expiresOn
                  ? `The key stops working on ${date.format(expiresOn)}.`
                  : "Pick the day the key stops working."}
            </FieldDescription>
          </Field>

          {error && <FieldError>{error}</FieldError>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Spinner />}
              Create Key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ScopeOption({
  id,
  value,
  title,
  hint,
  disabled,
}: {
  id: string;
  value: string;
  title: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <RadioGroupItem id={id} value={value} disabled={disabled} className="mt-0.5" />
      <label htmlFor={id} className="grid gap-0.5 text-sm has-disabled:opacity-50">
        <span className="font-medium">{title}</span>
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </label>
    </div>
  );
}
