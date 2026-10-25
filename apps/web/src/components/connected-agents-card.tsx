import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@strictbudget/ui/components/alert-dialog";
import { Badge } from "@strictbudget/ui/components/badge";
import { Button } from "@strictbudget/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@strictbudget/ui/components/card";
import { FieldError } from "@strictbudget/ui/components/field";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@strictbudget/ui/components/item";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { useQueryClient } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { McpSetup } from "@/components/agent-setup";
import { $api } from "@/lib/api";
import { apiErrorMessage } from "@/lib/budgets";

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** MCP clients (Claude, Cursor, …) and Agent Auth agents acting for the person. */
export function ConnectedAgentsCard() {
  const queryClient = useQueryClient();
  const agents = $api.useQuery("get", "/v1/me/agents");
  const revoke = $api.useMutation("delete", "/v1/me/agents/{agentId}");
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);
  const list = agents.data?.agents ?? [];

  async function disconnect() {
    if (!confirm) return;
    try {
      await revoke.mutateAsync({ params: { path: { agentId: confirm.id } } });
      toast.success(`${confirm.name} disconnected`);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't disconnect it."));
    }
    setConfirm(null);
    await queryClient.invalidateQueries({ queryKey: ["get", "/v1/me/agents"] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected agents</CardTitle>
        <CardDescription>
          AI apps you've allowed to use strictbudget for you. They can do what you can in your
          budgets, and their changes show as theirs, on your behalf. They can't change your sign-in
          details or delete your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <McpSetup />
        {agents.isPending ? (
          <Spinner />
        ) : agents.isError ? (
          <FieldError>Couldn't load your connected agents.</FieldError>
        ) : list.length === 0 ? (
          <p className="text-muted-foreground text-sm">No agents are connected.</p>
        ) : (
          <ItemGroup className="gap-0 rounded-lg border">
            {list.map((a) => (
              <Item
                key={a.id}
                role="listitem"
                size="sm"
                className="rounded-none border-0 border-border border-t first:border-t-0"
              >
                <ItemMedia variant="icon">
                  <Bot />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>
                    {a.name}
                    <Badge variant="secondary">{a.kind === "mcp" ? "MCP" : "Agent Auth"}</Badge>
                    <Badge variant="outline">
                      {a.access === "write" ? "Can make changes" : "Read only"}
                    </Badge>
                  </ItemTitle>
                  <ItemDescription>
                    Connected {dateTime.format(new Date(a.connectedAt))} · last used{" "}
                    {dateTime.format(new Date(a.lastUsedAt))}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirm({ id: a.id, name: a.name })}
                  >
                    Disconnect
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
      </CardContent>
      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {confirm?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It loses access at once. What it already changed stays, marked as its own. You can
              connect it again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={disconnect}>
              {revoke.isPending && <Spinner />} Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
