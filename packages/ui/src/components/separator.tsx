"use client";

import { cn } from "@strictbudget/ui/lib/utils";
import { Separator as SeparatorPrimitive } from "radix-ui";
import * as React from "react";

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        // Engraved (the Dropdown Menu separator): a hairline with a 1px
        // highlight under it, or to its right when vertical. The highlight is
        // a shadow, so the separator still takes 1px of layout.
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-horizontal:shadow-[0_1px_0_rgb(255_255_255/0.8)] data-vertical:w-px data-vertical:self-stretch data-vertical:shadow-[1px_0_0_rgb(255_255_255/0.8)] dark:bg-black/40 dark:data-horizontal:shadow-[0_1px_0_rgb(255_255_255/0.05)] dark:data-vertical:shadow-[1px_0_0_rgb(255_255_255/0.05)]",
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
