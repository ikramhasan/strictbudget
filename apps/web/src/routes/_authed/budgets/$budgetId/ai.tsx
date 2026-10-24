import { Button } from "@strictbudget/ui/components/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@strictbudget/ui/components/drawer";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@strictbudget/ui/components/empty";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { useIsMobile } from "@strictbudget/ui/hooks/use-mobile";
import { createFileRoute, Link } from "@tanstack/react-router";
import { History, SquarePen } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { AiConversation } from "@/components/ai-conversation";
import { AiHistory } from "@/components/ai-history";
import { PageHeader } from "@/components/page-header";
import { PageTitle } from "@/components/page-title";
import { useAiSettings } from "@/lib/ai";
import { useBudget } from "@/lib/budget-context";

export const Route = createFileRoute("/_authed/budgets/$budgetId/ai")({
  validateSearch: z.object({
    // The open conversation; none for a new chat.
    c: z.string().optional().catch(undefined),
    // A question to start a new chat with (the command palette's "Ask AI").
    ask: z.string().optional().catch(undefined),
  }),
  component: AiPage,
});

/**
 * The AI assistant as a page, in the sidebar whenever the budget has AI on, whether or not the
 * floating chat button shows: a new chat, or one from the history beside it (a drawer on a phone).
 */
function AiPage() {
  const { budget, readOnly } = useBudget();
  const settings = useAiSettings(budget.id);
  const { c: openId, ask } = Route.useSearch();
  const navigate = Route.useNavigate();
  const phone = useIsMobile();
  const [historyOpen, setHistoryOpen] = useState(false);
  // A chat started here gets its id in the URL without reloading the conversation showing it.
  const [newChat, setNewChat] = useState(0);
  const [startedId, setStartedId] = useState<string | null>(null);
  const chatKey = !openId || openId === startedId ? `new-${newChat}` : openId;
  const enabled = settings.data?.enabled && !readOnly;
  // A question asked from elsewhere starts a new chat with it; the URL then drops it, so a reload
  // or Back doesn't ask it again.
  const [question, setQuestion] = useState<string>();
  useEffect(() => {
    if (!ask) return;
    setQuestion(ask);
    setStartedId(null);
    setNewChat((n) => n + 1);
    void navigate({ search: {}, replace: true });
  }, [ask, navigate]);

  function open(id: string | undefined) {
    setQuestion(undefined);
    if (!id) {
      setStartedId(null);
      setNewChat((n) => n + 1);
    }
    setHistoryOpen(false);
    void navigate({ search: id ? { c: id } : {} });
  }

  const history = (
    <AiHistory
      budgetId={budget.id}
      activeId={openId}
      onSelect={open}
      onDeleted={(id) => id === openId && open(undefined)}
    />
  );

  return (
    // Fills the space between the top bar and the page's padding (and, on a phone, the bottom
    // navigation), so the conversation scrolls on its own with the input in view.
    <div className="flex h-[calc(100svh-3.5rem-2rem-5rem-env(safe-area-inset-bottom))] w-full flex-col gap-4 md:h-[calc(100svh-3.5rem-2.5rem)]">
      <PageTitle name="AI assistant" />
      <PageHeader
        title="AI assistant"
        actions={
          enabled && (
            <>
              {phone && (
                <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
                  <History /> History
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => open(undefined)}>
                <SquarePen /> New chat
              </Button>
            </>
          )
        }
      />
      {!settings.data ? (
        <Skeleton className="flex-1" />
      ) : enabled ? (
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border">
          {!phone && (
            <aside
              aria-label="History"
              className="flex w-64 shrink-0 flex-col overflow-y-auto border-r"
            >
              <h2 className="px-4 pt-3 font-medium text-muted-foreground text-xs">History</h2>
              {history}
            </aside>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <AiConversation
              key={chatKey}
              budgetId={budget.id}
              conversationId={chatKey.startsWith("new-") ? undefined : chatKey}
              initialMessage={question}
              onStarted={(id) => {
                setQuestion(undefined);
                setStartedId(id);
                void navigate({ search: { c: id }, replace: true });
              }}
            />
          </div>
          {phone && (
            <Drawer open={historyOpen} onOpenChange={setHistoryOpen}>
              <DrawerContent className="max-h-[80dvh]">
                <DrawerHeader className="group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
                  <DrawerTitle>History</DrawerTitle>
                </DrawerHeader>
                <div className="overflow-y-auto pb-[env(safe-area-inset-bottom)]">{history}</div>
              </DrawerContent>
            </Drawer>
          )}
        </div>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>AI is off for this budget</EmptyTitle>
            <EmptyDescription>
              {readOnly
                ? "You can view this budget but not use its AI features."
                : "Turn on AI features in budget settings to chat with this budget."}
            </EmptyDescription>
          </EmptyHeader>
          {!readOnly && (
            <EmptyContent>
              <Button asChild variant="outline">
                <Link
                  to="/budgets/$budgetId/settings"
                  params={{ budgetId: budget.id }}
                  search={{ tab: "ai" }}
                >
                  Budget settings
                </Link>
              </Button>
            </EmptyContent>
          )}
        </Empty>
      )}
    </div>
  );
}
