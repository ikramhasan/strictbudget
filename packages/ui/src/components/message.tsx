import { cn } from "@strictbudget/ui/lib/utils";
import * as React from "react";

function MessageGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-group"
      className={cn("flex min-w-0 flex-col gap-2", className)}
      {...props}
    />
  );
}

function Message({
  className,
  align = "start",
  ...props
}: React.ComponentProps<"div"> & { align?: "start" | "end" }) {
  return (
    <div
      data-slot="message"
      data-align={align}
      className={cn(
        "group/message relative flex w-full min-w-0 gap-2 text-sm data-[align=end]:flex-row-reverse",
        className,
      )}
      {...props}
    />
  );
}

function MessageAvatar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-avatar"
      className={cn(
        // Sits 2px above the bottom, so a 32px avatar centers on a one-line
        // (36px) bubble. With a footer it rises by the footer (28px) and the
        // gap (8px), staying level with the bubble. A low-opacity outline
        // keeps photos from bleeding into the page.
        "relative mb-0.5 flex w-fit min-w-8 shrink-0 items-center justify-center self-end overflow-hidden rounded-full bg-muted text-xs font-medium text-muted-foreground after:pointer-events-none after:absolute after:inset-0 after:rounded-full after:ring-1 after:ring-black/5 after:ring-inset group-has-data-[slot=message-footer]/message:-translate-y-9 dark:after:ring-white/10",
        className,
      )}
      {...props}
    />
  );
}

function MessageContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-content"
      className={cn(
        "flex w-full min-w-0 flex-col gap-2 wrap-break-word group-data-[align=end]/message:*:data-slot:self-end",
        className,
      )}
      {...props}
    />
  );
}

function MessageHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-header"
      className={cn(
        // 14px in, level with the bubble's text.
        "flex max-w-full min-w-0 items-center px-3.5 text-xs font-medium text-muted-foreground group-has-data-[variant=ghost]/message:px-0",
        className,
      )}
      {...props}
    />
  );
}

function MessageFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-footer"
      className={cn(
        // A 28px row: text or ghost icon-sm actions. Text sits 14px in, level
        // with the bubble's text; with buttons the padding drops to 8px so
        // the first icon's ink (6px inside its button) lands on that line.
        "flex h-7 max-w-full min-w-0 items-center gap-0.5 px-3.5 text-xs font-medium text-muted-foreground group-data-[align=end]/message:justify-end has-[>button]:px-2 group-has-data-[variant=ghost]/message:px-0 group-has-data-[variant=ghost]/message:has-[>button]:-mx-1.5",
        className,
      )}
      {...props}
    />
  );
}

export { Message, MessageAvatar, MessageContent, MessageFooter, MessageGroup, MessageHeader };
