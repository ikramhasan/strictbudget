import { Button } from "@strictbudget/ui/components/button";
import { FieldError } from "@strictbudget/ui/components/field";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { PageTitle } from "@/components/page-title";
import { $api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { apiErrorCode, apiErrorMessage, invalidateBudgets } from "@/lib/budgets";
import { useLinkParams } from "@/lib/link-params";
import { forgetInvitation, pendingInvitation, rememberInvitation } from "@/lib/pending-invitation";
import { refreshSession, sessionQueryOptions } from "@/lib/session";

export const Route = createFileRoute("/invitation")({
  component: () => (
    <>
      <PageTitle name="Invitation" />
      <InvitationPage />
    </>
  ),
});

function InvitationPage() {
  const { token: fromLink, opened } = useLinkParams();
  const token = fromLink ?? pendingInvitation();
  if (fromLink) rememberInvitation(fromLink);
  return <Invitation key={`${opened}:${token}`} token={token} />;
}

/**
 * Where an invitation email's link lands. Anyone with the link sees what it's for; joining needs
 * the invited address signed in, so a forwarded link can't be used by someone else.
 */
function Invitation({ token }: { token: string | null }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const session = useQuery(sessionQueryOptions);
  const view = $api.useQuery(
    "post",
    "/v1/invitations/view",
    { body: { token: token ?? "" } },
    { enabled: Boolean(token), retry: false },
  );
  const accept = $api.useMutation("post", "/v1/invitations/accept");
  const [error, setError] = useState<string | null>(null);

  // Leaving the page drops the invitation, or "/" would keep bringing the person back to it.
  const done = (
    <Link
      to="/"
      onClick={forgetInvitation}
      className="text-foreground underline underline-offset-4"
    >
      Go to strictbudget
    </Link>
  );

  if (!token || view.isError) {
    const expired = apiErrorCode(view.error) === "INVITATION_EXPIRED";
    return (
      <AuthCard
        title={expired ? "Invitation expired" : "Invitation not valid"}
        description={
          expired
            ? "This invitation has expired. Ask the person who sent it to resend it."
            : "This invitation was canceled or has already been used."
        }
        footer={done}
      >
        <Button asChild className="w-full" variant="outline">
          <Link to="/" onClick={forgetInvitation}>
            Continue
          </Link>
        </Button>
      </AuthCard>
    );
  }
  if (view.isPending || session.isPending) {
    return (
      <AuthCard title="Invitation" description="Loading the invitation…" footer={done}>
        <Skeleton className="h-10" />
      </AuthCard>
    );
  }

  const invite = view.data;
  const description = `${invite.inviterName} (${invite.inviterEmail}) invited ${invite.email} to share the budget “${invite.budgetName}”. You'll be able to see and edit its accounts, transactions and plan.`;
  const user = session.data?.user;

  if (!user) {
    return (
      <AuthCard
        title="You're invited"
        description={description}
        footer={<span>Sign in or create an account with {invite.email} to join.</span>}
      >
        <div className="grid gap-2">
          <Button asChild className="w-full">
            <Link to="/sign-in" search={{ redirect: "/invitation" }}>
              Sign in to join
            </Link>
          </Button>
          <Button asChild className="w-full" variant="outline">
            <Link to="/sign-up">Create an account</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <AuthCard
        title="Wrong account"
        description={`This invitation is for ${invite.email}, but you're signed in as ${user.email}. Sign out and sign in with ${invite.email} to join.`}
        footer={done}
      >
        <Button
          className="w-full"
          onClick={async () => {
            await authClient.signOut();
            queryClient.clear();
            await refreshSession(queryClient);
            await navigate({ to: "/sign-in", search: { redirect: "/invitation" } });
          }}
        >
          Sign out
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="You're invited" description={description} footer={done}>
      <div className="grid gap-2">
        <Button
          className="w-full"
          disabled={accept.isPending}
          onClick={async () => {
            setError(null);
            try {
              const { budgetId } = await accept.mutateAsync({ body: { token } });
              forgetInvitation();
              await invalidateBudgets(queryClient);
              await navigate({ to: "/budgets/$budgetId", params: { budgetId } });
            } catch (e) {
              setError(apiErrorMessage(e, "Couldn't join the budget. Try again."));
            }
          }}
        >
          {accept.isPending && <Spinner />} Join budget
        </Button>
        {error && <FieldError>{error}</FieldError>}
      </div>
    </AuthCard>
  );
}
