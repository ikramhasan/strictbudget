import { Button } from "@strictbudget/ui/components/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@strictbudget/ui/components/drawer";
import { Popover, PopoverContent, PopoverTrigger } from "@strictbudget/ui/components/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@strictbudget/ui/components/tooltip";
import { useIsMobile } from "@strictbudget/ui/hooks/use-mobile";
import { useMatchRoute } from "@tanstack/react-router";
import { MessageCircle, Sparkles, SquarePen } from "lucide-react";
import { useState } from "react";
import { AiConversation } from "@/components/ai-conversation";
import { useAiSettings } from "@/lib/ai";
import { useBudget } from "@/lib/budget-context";

/**
 * The floating AI chat button, on every page of a budget that turned AI and the button on. Each
 * time it opens, the chat starts a new conversation.
 */
export function AiAssistant() {
  const { budget, readOnly } = useBudget();
  const settings = useAiSettings(budget.id);
  const phone = useIsMobile();
  const [open, setOpen] = useState(false);
  // Not on the assistant's own page, where the chat is the page.
  const onAiPage = useMatchRoute()({ to: "/budgets/$budgetId/ai", fuzzy: true });
  if (readOnly || !settings.data?.assistantButton || onAiPage) return null;

  const trigger = (
    <Button
      size="icon-lg"
      aria-label="Ask AI"
      className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 size-12 rounded-full shadow-lg md:right-6 md:bottom-6"
      onClick={phone ? () => setOpen(true) : undefined}
    >
      <MessageCircle className="size-5" />
    </Button>
  );

  if (phone) {
    return (
      <>
        {trigger}
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="h-[85dvh]">
            {/* Mounted only while open, so every opening is a new conversation. */}
            {open && <AiChat budgetId={budget.id} budgetName={budget.name} drawer />}
          </DrawerContent>
        </Drawer>
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="left">Ask AI</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={12}
        className="h-[min(36rem,calc(100dvh-8rem))] w-[26rem] gap-0 p-0"
      >
        <AiChat budgetId={budget.id} budgetName={budget.name} />
      </PopoverContent>
    </Popover>
  );
}

function AiChat({
  budgetId,
  budgetName,
  drawer = false,
}: {
  budgetId: string;
  budgetName: string;
  drawer?: boolean;
}) {
  // A new key resets the conversation ("New chat").
  const [session, setSession] = useState(0);
  const Title = drawer ? DrawerTitle : "h2";
  const Description = drawer ? DrawerDescription : "p";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Sparkles aria-hidden className="size-4 text-muted-foreground" />
        <div className="grid min-w-0 flex-1">
          <Title className="font-medium text-sm">AI assistant</Title>
          <Description className="truncate text-muted-foreground text-xs">{budgetName}</Description>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="New chat"
          onClick={() => setSession((s) => s + 1)}
        >
          <SquarePen />
        </Button>
      </div>
      <AiConversation key={session} budgetId={budgetId} />
    </div>
  );
}
