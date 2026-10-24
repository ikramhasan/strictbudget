import { Button } from "@strictbudget/ui/components/button";
import { FieldError } from "@strictbudget/ui/components/field";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { createFileRoute } from "@tanstack/react-router";
import { Eye, PencilLine } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { AuthCard } from "@/components/auth-card";
import { PageTitle } from "@/components/page-title";
import { authPost, requireSignIn } from "@/lib/agents";
import { $api } from "@/lib/api";
import { apiErrorMessage } from "@/lib/budgets";

/**
 * Where an Agent Auth agent sends the person to approve what it asks to do (the plugin's device
 * authorization page): the link carries the agent and the code it shows them.
 */
export const Route = createFileRoute("/agents/approve")({
  validateSearch: z.object({ agent_id: z.string().catch(""), code: z.string().catch("") }),
  beforeLoad: async ({ context, location }) => ({
    session: await requireSignIn(context.queryClient, location.href),
  }),
  component: ApprovePage,
});

function ApprovePage() {
  const { agent_id: agentId, code } = Route.useSearch();
  const request = $api.useQuery(
    "get",
    "/v1/me/agent-approvals/{agentId}",
    { params: { path: { agentId }, query: { code } } },
    { enabled: Boolean(agentId && code), retry: false },
  );
  const [answered, setAnswered] = useState<"approved" | "denied" | null>(null);
  const [pending, setPending] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function answer(action: "approve" | "deny") {
    setPending(action);
    setError(null);
    try {
      await authPost("/agent/approve-capability", { agent_id: agentId, action, user_code: code });
      setAnswered(action === "approve" ? "approved" : "denied");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
    setPending(null);
  }

  if (answered) {
    return (
      <>
        <PageTitle name="Agent approval" />
        <AuthCard
          title={answered === "approved" ? "Approved" : "Denied"}
          description={
            answered === "approved"
              ? `${request.data?.name ?? "The agent"} can now do what it asked. Go back to it to carry on.`
              : "The agent wasn't given access. You can close this tab."
          }
          footer={<span>Manage connected agents in Account settings.</span>}
        >
          {null}
        </AuthCard>
      </>
    );
  }

  const data = request.data;
  const reads = data?.capabilities.filter((c) => c.readOnly) ?? [];
  const writes = data?.capabilities.filter((c) => !c.readOnly) ?? [];
  return (
    <>
      <PageTitle name="Agent approval" />
      <AuthCard
        title={data ? `Approve ${data.name}?` : "Approve an agent"}
        description={
          data
            ? `Check the code ${code} matches the one the agent shows${data.hostName ? ` (on ${data.hostName})` : ""}. It will act for you, and what it does shows as its own, on your behalf.`
            : "An agent asked to act for you."
        }
        footer={<span>You can disconnect it any time in Account settings.</span>}
      >
        {!agentId || !code ? (
          <FieldError>
            This link is missing the agent or its code. Open the agent's link again.
          </FieldError>
        ) : request.isPending ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : request.isError || !data ? (
          <FieldError>
            {apiErrorMessage(request.error, "That request has expired or was already answered.")}
          </FieldError>
        ) : (
          <div className="grid gap-5">
            <CapabilityList icon={Eye} title="See" items={reads.map((c) => c.title)} />
            <CapabilityList icon={PencilLine} title="Change" items={writes.map((c) => c.title)} />
            {error && <FieldError>{error}</FieldError>}
            <div className="grid gap-2">
              <Button onClick={() => answer("approve")} disabled={pending !== null}>
                {pending === "approve" && <Spinner />} Approve
              </Button>
              <Button variant="outline" onClick={() => answer("deny")} disabled={pending !== null}>
                {pending === "deny" && <Spinner />} Deny
              </Button>
            </div>
          </div>
        )}
      </AuthCard>
    </>
  );
}

function CapabilityList({
  icon: Icon,
  title,
  items,
}: {
  icon: typeof Eye;
  title: string;
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="grid gap-2">
      <h2 className="flex items-center gap-2 font-medium text-sm">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        {title}
      </h2>
      <ul className="grid max-h-48 list-disc gap-1 overflow-y-auto pl-9 text-muted-foreground text-sm">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
