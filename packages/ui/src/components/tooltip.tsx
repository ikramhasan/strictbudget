import { cn } from "@strictbudget/ui/lib/utils";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import * as React from "react";

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

// Opacity + scale out of the trigger; skipped entirely when Radix opens it
// instantly (moving between tooltips in a group, or keyboard focus).
// The arrow is a 10px square turned 45°, centered 4px inside the edge, so its
// tip stops short of the trigger.
function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 inline-flex w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-[0_1px_2px_rgb(0_0_0/0.1),0_4px_12px_rgb(0_0_0/0.1)] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] has-data-[slot=kbd]:py-1 has-data-[slot=kbd]:pr-1 data-[state=closed]:duration-100 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-96 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-96 motion-reduce:data-[state=delayed-open]:zoom-in-100 motion-reduce:data-[state=closed]:zoom-out-100 dark:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_4px_12px_rgb(0_0_0/0.4)] **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-[4px]",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_4px)] rotate-45 rounded-[2px] bg-foreground fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
