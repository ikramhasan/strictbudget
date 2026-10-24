"use client";

import { cn } from "@strictbudget/ui/lib/utils";
import * as ResizablePrimitive from "react-resizable-panels";

function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn("flex h-full w-full aria-[orientation=vertical]:flex-col", className)}
      {...props}
    />
  );
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean;
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      // The engraved Separator: a 1px border line with a 1px highlight beside
      // it (a shadow, so it takes no layout). Hover and drag darken the line
      // like the Sidebar rail. The hit area is 9px across (after:), and focus
      // is the 2px ring around the line.
      className={cn(
        "relative flex w-px items-center justify-center bg-border shadow-[1px_0_0_rgb(255_255_255/0.8)] transition-colors duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-[9px] after:-translate-x-1/2 focus-visible:ring-2 focus-visible:ring-ring data-[separator=active]:bg-[color-mix(in_oklch,var(--border),var(--foreground)_20%)] data-[separator=hover]:bg-[color-mix(in_oklch,var(--border),var(--foreground)_12%)] aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:shadow-[0_1px_0_rgb(255_255_255/0.8)] aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-[9px] aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 dark:bg-black/40 dark:shadow-[1px_0_0_rgb(255_255_255/0.05)] dark:data-[separator=active]:bg-[color-mix(in_oklch,var(--border),var(--foreground)_25%)] dark:data-[separator=hover]:bg-[color-mix(in_oklch,var(--border),var(--foreground)_15%)] dark:aria-[orientation=horizontal]:shadow-[0_1px_0_rgb(255_255_255/0.05)] [&[aria-orientation=horizontal]>div]:rotate-90",
        className,
      )}
      {...props}
    >
      {withHandle && (
        // A raised grip (the Slider thumb as a pill): 8×24, white, hairline
        // and a soft lift, centered on the line.
        <div className="z-10 flex h-6 w-2 shrink-0 rounded-full bg-linear-to-b from-white to-[color-mix(in_oklch,white,black_5%)] shadow-[0_1px_2px_rgb(0_0_0/0.16),0_0_0_0.5px_rgb(0_0_0/0.14),inset_0_-1px_0_rgb(0_0_0/0.04)] dark:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_12%)] dark:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.6),0_0_0_0.5px_rgb(0_0_0/0.5),inset_0_1px_0_rgb(255_255_255/0.08)]" />
      )}
    </ResizablePrimitive.Separator>
  );
}

// strictbudget: re-exported so apps save layouts without depending on the library themselves.
const { useDefaultLayout } = ResizablePrimitive;

export { ResizableHandle, ResizablePanel, ResizablePanelGroup, useDefaultLayout };
