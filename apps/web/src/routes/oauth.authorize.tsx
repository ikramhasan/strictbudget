import { Spinner } from "@strictbudget/ui/components/spinner";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { AuthCard } from "@/components/auth-card";
import { PageTitle } from "@/components/page-title";
import { authorizeUrl, requireSignIn } from "@/lib/agents";

/**
 * Where the API sends an MCP client's authorization when nobody is signed in (`loginPage`): sign
 * in (two-step verification included) and come back here, which hands the request back to the
 * API to continue to the consent page.
 */
export const Route = createFileRoute("/oauth/authorize")({
  beforeLoad: ({ context, location }) => requireSignIn(context.queryClient, location.href),
  component: ContinueAuthorization,
});

function ContinueAuthorization() {
  useEffect(() => {
    window.location.replace(authorizeUrl(window.location.search));
  }, []);
  return (
    <>
      <PageTitle name="Connecting an app" />
      <AuthCard
        title="Connecting an app"
        description="Taking you to the next step…"
        footer={<span>You can close this tab if nothing happens.</span>}
      >
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      </AuthCard>
    </>
  );
}
