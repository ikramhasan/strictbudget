import { Button } from "@strictbudget/ui/components/button";
import { Field, FieldError, FieldLabel } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { type FormEvent, type ReactNode, useState } from "react";

export interface SignInValues {
  email: string;
  password: string;
}

export function SignInForm({
  onSubmit,
  forgotPassword,
}: {
  onSubmit: (values: SignInValues) => Promise<string | null>;
  forgotPassword?: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const message = await onSubmit({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    setPending(false);
    setError(message);
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <Field>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field>
        <div className="flex items-center justify-between">
          <FieldLabel htmlFor="password">Password</FieldLabel>
          {forgotPassword}
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      {error && <FieldError>{error}</FieldError>}
      <Button type="submit" disabled={pending}>
        {pending && <Spinner />}
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
