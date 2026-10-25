"use client";

import { cn } from "@strictbudget/ui/lib/utils";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";

function Collapsible({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return <CollapsiblePrimitive.CollapsibleTrigger data-slot="collapsible-trigger" {...props} />;
}

function CollapsibleContent({
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      // The Accordion's height animation. strictbudget: Radix measures the content into
      // --radix-collapsible-content-height (read by tw-animate-css's collapsible keyframes) and
      // marks state with data-state, where Base UI uses a height transition. Clipped with a 4px
      // margin so focus rings and raised shadows at the edges still show.
      className={cn(
        "overflow-clip [overflow-clip-margin:4px] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
