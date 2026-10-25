"use client";

import { cn } from "@strictbudget/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Tabs as TabsPrimitive } from "radix-ui";
import * as React from "react";

// strictbudget: Radix marks state with data-orientation="…" and data-state="active", not the bare
// data-horizontal / data-active attributes this component was written for.
function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      orientation={orientation}
      data-orientation={orientation}
      className={cn("group/tabs flex gap-2 data-[orientation=horizontal]:flex-col", className)}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  "group/tabs-list relative isolate inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-[orientation=horizontal]/tabs:h-8 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        // A recessed track (the Kbd recipe): darker under the top lip, an
        // inner shadow and hairline, and a catch-light below the bottom edge.
        default:
          "bg-muted bg-linear-to-b text-[color-mix(in_oklch,var(--muted-foreground),var(--foreground)_20%)] dark:text-muted-foreground from-[color-mix(in_oklch,var(--muted),var(--foreground)_7%)] to-muted shadow-[inset_0_1px_2px_rgb(0_0_0/0.1),inset_0_0_0_1px_rgb(0_0_0/0.05),0_1px_0_rgb(255_255_255/0.9)] dark:from-[color-mix(in_oklch,var(--muted),black_35%)] dark:shadow-[inset_0_1px_2px_rgb(0_0_0/0.6),inset_0_0_0_1px_rgb(0_0_0/0.25),0_1px_0_rgb(255_255_255/0.07)]",
        // An engraved hairline under (or beside) the triggers.
        line: "gap-1 bg-transparent group-data-[orientation=horizontal]/tabs:shadow-[inset_0_-1px_0_var(--border)] group-data-[orientation=vertical]/tabs:shadow-[inset_-1px_0_0_var(--border)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        // 26px in a 32px track (3px padding). The hit area grows to 40px on
        // the free axis (the before: pseudo-element), never into a neighbor.
        // In the track the focus ring is inset, so it can't cover the
        // neighboring tab or the track's lip.
        "relative inline-flex flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-lg)-3px)] border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-current transition-[color,box-shadow] duration-150 outline-none select-none group-data-[orientation=horizontal]/tabs:h-full group-data-[orientation=vertical]/tabs:h-[26px] group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:flex-none group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring group-data-[variant=default]/tabs-list:focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[state=active]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "before:absolute group-data-[orientation=horizontal]/tabs:before:inset-x-0 group-data-[orientation=horizontal]/tabs:before:-inset-y-[7px] group-data-[orientation=vertical]/tabs:before:inset-y-0 group-data-[orientation=vertical]/tabs:before:-inset-x-1",
        // strictbudget: Radix Tabs has no sliding Indicator, so the library's indicator skin sits on
        // the active trigger itself (no slide between tabs). Default: a raised chip (the secondary
        // Button in white), concentric with the track.
        "group-data-[variant=default]/tabs-list:data-[state=active]:bg-linear-to-b group-data-[variant=default]/tabs-list:data-[state=active]:from-background group-data-[variant=default]/tabs-list:data-[state=active]:to-[color-mix(in_oklch,var(--background),var(--secondary)_60%)] group-data-[variant=default]/tabs-list:data-[state=active]:shadow-[0_1px_2px_rgb(0_0_0/0.1),0_0_0_1px_rgb(0_0_0/0.07),inset_0_-1px_0_rgb(0_0_0/0.03)] dark:group-data-[variant=default]/tabs-list:data-[state=active]:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_9%)] dark:group-data-[variant=default]/tabs-list:data-[state=active]:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] dark:group-data-[variant=default]/tabs-list:data-[state=active]:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.06),inset_0_1px_0_rgb(255_255_255/0.07)]",
        // Line: a 2px bar riding the list's hairline (3px out, past the list padding).
        "after:pointer-events-none after:absolute after:rounded-full after:bg-foreground after:opacity-0 group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:-bottom-[3px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-[3px] group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants };
