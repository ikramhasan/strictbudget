import { cn } from "@strictbudget/ui/lib/utils";
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";
import * as React from "react";

// strictbudget: `viewportRef`/`viewportClassName`/`viewportProps` expose the scrolling element (for
// virtualized rows, a sticky header, the router's scroll reset), and `scrollbars` adds the
// horizontal bar for wide content.
function ScrollArea({
  className,
  children,
  viewportRef,
  viewportClassName,
  scrollbars = "vertical",
  viewportProps,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  viewportRef?: React.Ref<HTMLDivElement>;
  viewportClassName?: string;
  viewportProps?: React.HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string>;
  scrollbars?: "vertical" | "horizontal" | "both";
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        {...viewportProps}
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        // An outline, not a ring: it paints above the scrolled content.
        className={cn(
          "size-full rounded-[inherit] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring",
          viewportClassName,
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {scrollbars !== "horizontal" && <ScrollBar />}
      {scrollbars !== "vertical" && <ScrollBar orientation="horizontal" />}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        // A 6px thumb centered in a 10px track; it widens to 8px while hovered
        // or dragged. The 2px end gap keeps its round ends inside a rounded-lg
        // corner. strictbudget: Radix marks the axis with data-orientation="…", not the bare
        // data-horizontal / data-vertical attributes.
        "group/scrollbar flex touch-none p-0.5 transition-[padding] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] select-none data-[orientation=horizontal]:h-2.5 data-[orientation=horizontal]:flex-col data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2.5 data-[orientation=horizontal]:hover:py-px data-[orientation=horizontal]:has-active:py-px data-[orientation=vertical]:hover:px-px data-[orientation=vertical]:has-active:px-px motion-reduce:transition-none",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-[color-mix(in_oklch,var(--muted-foreground),transparent_50%)] transition-colors duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover/scrollbar:bg-[color-mix(in_oklch,var(--muted-foreground),transparent_25%)] active:bg-[color-mix(in_oklch,var(--muted-foreground),transparent_25%)]"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar };
