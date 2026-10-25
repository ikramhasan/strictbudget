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
import { Button } from "@strictbudget/ui/components/button";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { cn } from "@strictbudget/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { AiConversationSummary } from "@/lib/ai";
import { $api } from "@/lib/api";
import { apiErrorMessage } from "@/lib/budgets";

const LIST = "/v1/budgets/{budgetId}/ai/conversations" as const;
const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** Today's conversations by time, older ones by day. */
function when(iso: string) {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString() ? time.format(date) : day.format(date);
}

export function AiHistory({
  budgetId,
  activeId,
  onSelect,
  onDeleted,
}: {
  budgetId: string;
  activeId: string | undefined;
  onSelect: (id: string) => void;
  onDeleted: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const list = $api.useQuery("get", LIST, { params: { path: { budgetId } } });
  const remove = $api.useMutation(
    "delete",
    "/v1/budgets/{budgetId}/ai/conversations/{conversationId}",
  );
  const [confirm, setConfirm] = useState<AiConversationSummary | null>(null);

  async function deleteConversation() {
    if (!confirm) return;
    const { id } = confirm;
    setConfirm(null);
    try {
      await remove.mutateAsync({ params: { path: { budgetId, conversationId: id } } });
      onDeleted(id);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't delete the conversation. Try again."));
    }
    await queryClient.invalidateQueries({ queryKey: ["get", LIST] });
  }

  const conversations = list.data?.conversations ?? [];
  return (
    <>
      {list.isPending ? (
        <div className="grid gap-2 p-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : list.isError ? (
        <p className="p-3 text-muted-foreground text-sm">Couldn't load your conversations.</p>
      ) : conversations.length === 0 ? (
        <p className="p-3 text-muted-foreground text-sm">
          No conversations yet. Your chats show here.
        </p>
      ) : (
        <ul aria-label="Previous conversations" className="grid gap-0.5 p-2">
          {conversations.map((c) => (
            <li key={c.id} className="group/row relative">
              <button
                type="button"
                aria-current={c.id === activeId || undefined}
                onClick={() => onSelect(c.id)}
                className={cn(
                  "grid w-full gap-0.5 rounded-md py-2 pr-9 pl-2.5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                  c.id === activeId && "bg-muted",
                )}
              >
                <span className="truncate text-sm">{c.title}</span>
                <span className="text-muted-foreground text-xs">{when(c.updatedAt)}</span>
              </button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Delete “${c.title}”`}
                onClick={() => setConfirm(c)}
                className="absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              “{confirm?.title}” and its messages are deleted for good.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={deleteConversation}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
