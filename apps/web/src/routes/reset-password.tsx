import { Button } from "@strictbudget/ui/components/button";
import { FieldError } from "@strictbudget/ui/components/field";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { NewPasswordFields, readNewPassword } from "@/components/new-password-fields";
import { PageTitle } from "@/components/page-title";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { useLinkParams } from "@/lib/link-params";

export const Route = createFileRoute("/reset-password")({
  component: () => (
    <>
      <PageTitle name="Reset password" />
      <ResetPasswordPage />
    </>
  ),
});

function ResetPasswordPage() {
  const { token, opened } = useLinkParams();
  return <ResetPassword key={opened} token={token} />;
}

function ResetPassword({ token }: { token: string | null }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [linkDead, setLinkDead] = useState(false);

  const footer = (
    <Link to="/sign-in" className="text-foreground underline underline-offset-4">
      Back to sign in
    </Link>
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const read = readNewPassword(new FormData(event.currentTarget));
    if ("error" in read) return setError(read.error);
    setState("pending");
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword: read.password, token });
    if (error) {
      setState("idle");
      setLinkDead(error.code === "INVALID_TOKEN");
      setError(authErrorMessage(error, "Couldn't reset the password. Try again."));
      return;
    }
    // Every session was signed out, this browser's included.
    queryClient.clear();
    setState("done");
  }

  if (state === "done") {
    return (
      <AuthCard
        title="Password changed"
        description="Your password has been reset and every device has been signed out."
        footer={footer}
      >
        <Button asChild className="w-full">
          <Link to="/sign-in">Sign in</Link>
        </Button>
      </AuthCard>
    );
  }
  if (!token || linkDead) {
    return (
      <AuthCard
        title="Reset link not valid"
        description="This link has expired or was already used. Reset links work once, for 1 hour."
        footer={footer}
      >
        <Button asChild className="w-full">
          <Link to="/forgot-password">Send a new link</Link>
        </Button>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title="Choose a new password"
      description="You'll be signed out everywhere and can sign in with the new password."
      footer={footer}
    >
      <form onSubmit={handleSubmit} className="grid gap-4">
        <NewPasswordFields />
        {error && <FieldError>{error}</FieldError>}
        <Button type="submit" disabled={state === "pending"}>
          {state === "pending" && <Spinner />}
          Reset password
        </Button>
      </form>
    </AuthCard>
  );
}
