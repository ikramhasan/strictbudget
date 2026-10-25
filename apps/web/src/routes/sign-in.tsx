import { Button } from "@strictbudget/ui/components/button";
import { Field, FieldError, FieldLabel } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { z } from "zod";
import { AuthCard } from "@/components/auth-card";
import { PageTitle } from "@/components/page-title";
import { SignInForm } from "@/components/sign-in-form";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { useInstance } from "@/lib/instance";
import { safeRedirect } from "@/lib/safe-redirect";
import { refreshSession, sessionQueryOptions } from "@/lib/session";

export const Route = createFileRoute("/sign-in")({
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: async ({ context, search }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions);
    if (session) throw redirect({ href: safeRedirect(search.redirect) });
  },
  component: () => (
    <>
      <PageTitle name="Sign in" />
      <SignInPage />
    </>
  ),
});

function SignInPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { email } = useInstance();
  // Set when the password was right but the account has two-step verification on.
  const [secondStep, setSecondStep] = useState(false);

  async function finish() {
    await refreshSession(queryClient);
    await navigate({ href: safeRedirect(search.redirect) });
  }

  if (secondStep) return <TwoStepVerification onVerified={finish} />;

  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to your budget."
      footer={
        <span>
          New here?{" "}
          <Link to="/sign-up" className="text-foreground underline underline-offset-4">
            Create an account
          </Link>
        </span>
      }
    >
      <SignInForm
        forgotPassword={
          email && (
            <Link
              to="/forgot-password"
              className="text-muted-foreground text-sm underline-offset-4 hover:underline"
            >
              Forgot password?
            </Link>
          )
        }
        onSubmit={async (values) => {
          const { data, error } = await authClient.signIn.email(values);
          if (error) return authErrorMessage(error, error.message ?? "Sign in failed");
          if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
            setSecondStep(true);
            return null;
          }
          await finish();
          return null;
        }}
      />
    </AuthCard>
  );
}

/**
 * The second step of signing in with two-step verification on: the code from the verification
 * app, or, as a last resort, the emergency backup code.
 */
function TwoStepVerification({ onVerified }: { onVerified: () => Promise<void> }) {
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    setPending(true);
    setError(null);
    const { error } = backup
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code });
    if (error) {
      setPending(false);
      setError(
        error.code === "INVALID_TWO_FACTOR_COOKIE"
          ? "This sign-in took too long. Go back and sign in again."
          : authErrorMessage(
              error,
              backup
                ? "That backup code isn't right."
                : "That code isn't right. Codes change every 30 seconds.",
            ),
      );
      return;
    }
    await onVerified();
  }

  return (
    <AuthCard
      title="Two-Step Verification"
      description={
        backup
          ? "Enter the emergency backup code you saved when you set up two-step verification."
          : "Open your verification app and enter the 6-digit code for strictbudget."
      }
      footer={
        <button
          type="button"
          className="text-foreground underline underline-offset-4"
          onClick={() => {
            setBackup(!backup);
            setError(null);
          }}
        >
          {backup ? "Use a code from your app" : "Use your emergency backup code"}
        </button>
      }
    >
      <form key={String(backup)} onSubmit={handleSubmit} className="grid gap-4">
        <Field>
          <FieldLabel htmlFor="code">{backup ? "Backup code" : "6-Digit Code"}</FieldLabel>
          <Input
            id="code"
            name="code"
            autoComplete="one-time-code"
            inputMode={backup ? "text" : "numeric"}
            required
            autoFocus
          />
        </Field>
        {error && <FieldError>{error}</FieldError>}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending && <Spinner />} Verify
        </Button>
      </form>
    </AuthCard>
  );
}
