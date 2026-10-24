import type { CurrencyCode } from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@strictbudget/ui/components/card";
import { Checkbox } from "@strictbudget/ui/components/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { $api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { preferencesQueryOptions } from "@/lib/preferences";
import { refreshSession } from "@/lib/session";
import { CurrencyPicker } from "./currency-picker";

export function NameCard({ name }: { name: string }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const trimmed = value.trim();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmed) return setError("Enter your first name.");
    setPending(true);
    setError(null);
    const { error } = await authClient.updateUser({ name: trimmed });
    setPending(false);
    if (error) return setError(authErrorMessage(error, "Couldn't save your name. Try again."));
    await refreshSession(queryClient);
    await queryClient.invalidateQueries({ queryKey: ["get", "/v1/me"] });
    // The shell reads the user from the route context, so load it again.
    await router.invalidate();
    toast.success("Name saved");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>First Name</CardTitle>
        <CardDescription>
          We use your first name to personalize strictbudget, and partners see it on budgets you
          share.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-start gap-2">
          <Field className="min-w-48 flex-1">
            <FieldLabel htmlFor="first-name" className="sr-only">
              First name
            </FieldLabel>
            <Input
              id="first-name"
              value={value}
              maxLength={100}
              autoComplete="given-name"
              onChange={(e) => setValue(e.target.value)}
            />
            {error && <FieldError>{error}</FieldError>}
          </Field>
          <Button type="submit" disabled={pending || trimmed === name}>
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** Each option saves as soon as it's ticked. */
export function OptionsCard() {
  const queryClient = useQueryClient();
  const preferences = useQuery(preferencesQueryOptions());
  const update = $api.useMutation("patch", "/v1/me/preferences");

  async function save(body: {
    openLastBudget?: boolean;
    keyboardShortcuts?: boolean;
    displayCurrency?: CurrencyCode | null;
  }) {
    try {
      const saved = await update.mutateAsync({ body });
      queryClient.setQueryData(preferencesQueryOptions().queryKey, saved);
      // Every budget's account totals are shown in it.
      if (body.displayCurrency !== undefined) {
        await queryClient.invalidateQueries({
          queryKey: ["get", "/v1/budgets/{budgetId}/accounts"],
        });
      }
      toast.success("Options have been updated.");
    } catch {
      toast.error("Couldn't update the options. Try again.");
    }
  }

  const options = [
    { key: "openLastBudget", label: "Open last used budget by default" },
    { key: "keyboardShortcuts", label: "Enable keyboard shortcuts" },
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Options</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {options.map((o) => (
          <Field key={o.key} orientation="horizontal">
            <Checkbox
              id={`option-${o.key}`}
              checked={preferences.data?.[o.key] ?? true}
              disabled={!preferences.data || update.isPending}
              onCheckedChange={(checked) => save({ [o.key]: checked === true })}
            />
            <FieldLabel htmlFor={`option-${o.key}`} className="font-normal">
              {o.label}
            </FieldLabel>
          </Field>
        ))}
        <Field>
          <FieldLabel htmlFor="option-display-currency">Show account totals in</FieldLabel>
          <CurrencyPicker
            id="option-display-currency"
            value={preferences.data?.displayCurrency ?? null}
            noneLabel="Budget's currency"
            onChange={(code) => save({ displayCurrency: code })}
            onNone={() => save({ displayCurrency: null })}
          />
          <FieldDescription>
            Sidebar totals and net worth, in every budget, converted at today's exchange rates.
          </FieldDescription>
        </Field>
      </CardContent>
    </Card>
  );
}
