import { Button } from "@strictbudget/ui/components/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@strictbudget/ui/components/field";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { Switch } from "@strictbudget/ui/components/switch";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { PageTitle } from "@/components/page-title";
import { authGet, authPost, requireSignIn } from "@/lib/agents";

const READ = "strictbudget:read";
const WRITE = "strictbudget:write";

/**
 * Asks the signed-in person whether an MCP client may act for them (the API's `consentPage`).
 * Reading is the minimum; making changes can be turned off, leaving the client read-only.
 */
export const Route = createFileRoute("/oauth/consent")({
  beforeLoad: async ({ context, location }) => ({
    session: await requireSignIn(context.queryClient, location.href),
  }),
  component: ConsentPage,
});

type PublicClient = { client_id: string; client_name?: string | null; client_uri?: string | null };

function ConsentPage() {
  const { session } = Route.useRouteContext();
  const params = new URLSearchParams(window.location.search);
  const clientId = params.get("client_id") ?? "";
  const requested = (params.get("scope") ?? "").split(" ").filter(Boolean);
  const wantsWrite = requested.includes(WRITE);
  const [allowWrite, setAllowWrite] = useState(wantsWrite);
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const client = useQuery({
    queryKey: ["oauth-client", clientId],
    queryFn: () =>
      authGet<PublicClient>(`/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`),
    enabled: Boolean(clientId),
  });
  const name = client.data?.client_name || "An app";

  async function answer(accept: boolean) {
    setPending(accept ? "allow" : "deny");
    setError(null);
    // Everything asked for but writing, which the person may leave out.
    const scope = [...new Set([...requested.filter((s) => s !== WRITE), READ])];
    if (allowWrite) scope.push(WRITE);
    try {
      const { url } = await authPost<{ url: string }>("/oauth2/consent", {
        accept,
        ...(accept ? { scope: scope.join(" ") } : {}),
        oauth_query: window.location.search.slice(1),
      });
      window.location.assign(url);
    } catch (e) {
      setPending(null);
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  return (
    <>
      <PageTitle name="Allow access" />
      <AuthCard
        title={client.isPending ? "Allow access?" : `Allow ${name} to use strictbudget?`}
        description={`It will act for you, ${session.user.email}. What it does shows as ${name}'s, on your behalf.`}
        footer={<span>You can disconnect it any time in Account settings.</span>}
      >
        <div className="grid gap-5">
          {client.isError && <FieldError>This app isn't registered (any more).</FieldError>}
          <ul className="grid gap-2 text-sm">
            <li className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-primary-text" aria-hidden />
              See your budgets, accounts, transactions, attachments and reports
            </li>
          </ul>
          {wantsWrite && (
            <Field orientation="horizontal" className="items-start">
              <Switch id="allow-write" checked={allowWrite} onCheckedChange={setAllowWrite} />
              <div className="grid gap-1">
                <FieldLabel htmlFor="allow-write">Let it make changes</FieldLabel>
                <FieldDescription>
                  Add and edit transactions, assign money, upload attachments and anything else you
                  can do. Off, it can only look.
                </FieldDescription>
              </div>
            </Field>
          )}
          {error && <FieldError>{error}</FieldError>}
          <div className="grid gap-2">
            <Button onClick={() => answer(true)} disabled={pending !== null || client.isError}>
              {pending === "allow" && <Spinner />} Allow
            </Button>
            <Button variant="outline" onClick={() => answer(false)} disabled={pending !== null}>
              {pending === "deny" && <Spinner />} Deny
            </Button>
          </div>
        </div>
      </AuthCard>
    </>
  );
}
