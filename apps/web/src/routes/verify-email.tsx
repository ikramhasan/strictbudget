import { Button } from "@strictbudget/ui/components/button";
import { FieldError } from "@strictbudget/ui/components/field";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { CheckInbox } from "@/components/check-inbox";
import { PageTitle } from "@/components/page-title";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { useLinkParams } from "@/lib/link-params";
import { refreshSession, sessionQueryOptions } from "@/lib/session";

export const Route = createFileRoute("/verify-email")({
  component: () => (
    <>
      <PageTitle name="Confirm email" />
      <VerifyEmailPage />
    </>
  ),
});

type Step = "confirm" | "approve" | "change";

const COPY: Record<
  Step,
  { title: string; description: string; button: string; doneTitle: string; done: string }
> = {
  confirm: {
    title: "Confirm your email",
    doneTitle: "Email confirmed",
    description: "Confirm this address to finish setting up your account.",
    button: "Confirm email",
    done: "Your email is confirmed. Sign in to start budgeting.",
  },
  approve: {
    title: "Approve your email change",
    doneTitle: "Change approved",
    description:
      "Approve changing your account's email address. We'll then send a confirmation link to the new address.",
    button: "Approve change",
    done: "Approved. We've sent a confirmation link to the new address: open it to finish the change.",
  },
  change: {
    title: "Confirm your new email",
    doneTitle: "Email changed",
    description:
      "Confirm this address to make it your account's email. You need to be signed in to your account in this browser.",
    button: "Confirm new email",
    done: "Your email address has been changed.",
  },
};

function VerifyEmailPage() {
  const { token, step: rawStep, opened } = useLinkParams();
  const step: Step = rawStep === "approve" || rawStep === "change" ? rawStep : "confirm";
  const session = useQuery(sessionQueryOptions);

  if (!token) {
    // No link: a signed-in account whose address isn't confirmed lands here from the app.
    const user = session.data?.user;
    if (user && !user.emailVerified) return <UnverifiedSession email={user.email} />;
    return (
      <AuthCard
        title="Confirm your email"
        description="Open the link in the email we sent you to continue."
        footer={<BackToSignIn />}
      >
        <p className="text-muted-foreground text-sm">
          The link only works from that email. If it has expired, sign in and we'll send a new one.
        </p>
      </AuthCard>
    );
  }
  // Keyed so a new link starts from its own button, not the last link's result.
  return <ConfirmLink key={opened} token={token} step={step} />;
}

/**
 * Nothing happens until the button is pressed: mail scanners that open links to check them
 * never confirm an address or approve a change.
 */
function ConfirmLink({ token, step }: { token: string; step: Step }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[step];

  async function confirm() {
    setState("pending");
    setError(null);
    const { error } = await authClient.verifyEmail({ query: { token } });
    if (error) {
      setState("idle");
      setError(authErrorMessage(error, "Couldn't confirm the link. Try again."));
      return;
    }
    // A confirmed change updates the signed-in session's email.
    await refreshSession(queryClient);
    setState("done");
  }

  if (state === "done") {
    return (
      <AuthCard title={copy.doneTitle} description={copy.done} footer={<BackToSignIn />}>
        <Button asChild className="w-full">
          {step === "confirm" ? (
            <Link to="/sign-in">Sign in</Link>
          ) : (
            <Link to="/">Go to strictbudget</Link>
          )}
        </Button>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={copy.title} description={copy.description} footer={<BackToSignIn />}>
      <div className="grid gap-4">
        {error && <FieldError>{error}</FieldError>}
        <Button onClick={confirm} disabled={state === "pending"}>
          {state === "pending" && <Spinner />}
          {copy.button}
        </Button>
      </div>
    </AuthCard>
  );
}

function UnverifiedSession({ email }: { email: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  async function signOut() {
    await authClient.signOut();
    queryClient.clear();
    await navigate({ to: "/sign-in" });
  }
  return (
    <AuthCard
      title="Confirm your email"
      description="Your account's email address needs confirming before you can continue."
      footer={
        <button type="button" onClick={signOut} className="underline underline-offset-4">
          Sign out
        </button>
      }
    >
      <CheckInbox email={email} />
    </AuthCard>
  );
}

function BackToSignIn() {
  return (
    <Link to="/sign-in" className="text-foreground underline underline-offset-4">
      Back to sign in
    </Link>
  );
}
