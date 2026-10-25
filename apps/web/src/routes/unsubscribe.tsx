import { Button } from "@strictbudget/ui/components/button";
import { FieldError } from "@strictbudget/ui/components/field";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { PageTitle } from "@/components/page-title";
import { $api } from "@/lib/api";
import { useLinkParams } from "@/lib/link-params";

export const Route = createFileRoute("/unsubscribe")({
  component: () => (
    <>
      <PageTitle name="Unsubscribe" />
      <UnsubscribePage />
    </>
  ),
});

function UnsubscribePage() {
  const { token, opened } = useLinkParams();
  return <Unsubscribe key={opened} token={token} />;
}

/**
 * From a monthly summary's "Unsubscribe" link. Like every emailed link, opening it
 * changes nothing: only the button does, so a mail scanner can't unsubscribe anyone.
 */
function Unsubscribe({ token }: { token: string | null }) {
  const unsubscribe = $api.useMutation("post", "/v1/email/unsubscribe");
  const [error, setError] = useState<string | null>(null);
  const [linkDead, setLinkDead] = useState(!token);

  const footer = (
    <Link
      to="/account"
      search={{ tab: "notifications" }}
      hash="settings-notifications"
      className="text-foreground underline underline-offset-4"
    >
      Notification settings
    </Link>
  );

  const home = (
    <Button asChild variant="outline" className="w-full">
      <Link to="/">Open strictbudget</Link>
    </Button>
  );

  async function confirm() {
    if (!token) return;
    setError(null);
    try {
      await unsubscribe.mutateAsync({ params: { query: { token } } });
    } catch (e) {
      const code = (e as { error?: { code?: string } } | undefined)?.error?.code;
      if (code === "INVALID_TOKEN") return setLinkDead(true);
      setError("Couldn't unsubscribe. Try again.");
    }
  }

  if (linkDead) {
    return (
      <AuthCard
        title="Link not valid"
        description="This unsubscribe link isn't one of ours. Turn emails off in your notification settings instead."
        footer={footer}
      >
        {home}
      </AuthCard>
    );
  }
  if (unsubscribe.isSuccess) {
    return (
      <AuthCard
        title="You're unsubscribed"
        description="You won't get monthly summaries any more. You can turn them back on in your notification settings."
        footer={footer}
      >
        {home}
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title="Unsubscribe from monthly summaries"
      description="Stop the email strictbudget sends on the 1st of each month with an overview of your budgets."
      footer={footer}
    >
      <div className="grid gap-3">
        {error && <FieldError>{error}</FieldError>}
        <Button className="w-full" disabled={unsubscribe.isPending} onClick={confirm}>
          {unsubscribe.isPending && <Spinner />}
          Unsubscribe
        </Button>
      </div>
    </AuthCard>
  );
}
