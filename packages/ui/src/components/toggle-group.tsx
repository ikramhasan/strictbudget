"use client";

import { toggleVariants } from "@strictbudget/ui/components/toggle";
import { cn } from "@strictbudget/ui/lib/utils";
import { type VariantProps } from "class-variance-authority";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import * as React from "react";

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number;
    orientation?: "horizontal" | "vertical";
  }
>({
  size: "default",
  variant: "default",
  spacing: 2,
  orientation: "horizontal",
});

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 2,
  orientation = "horizontal",
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleVariants> & {
    spacing?: number;
    orientation?: "horizontal" | "vertical";
  }) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      orientation={orientation}
      style={{ "--gap": spacing } as React.CSSProperties}
      className={cn(
        "group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] rounded-lg data-[size=sm]:rounded-[min(var(--radius-md),10px)] data-vertical:flex-col data-vertical:items-stretch",
        // Joined (spacing 0) with the default variant, the group is the Tabs
        // track: recessed, 3px padding, the same outer height as a Toggle.
        "data-[spacing=0]:not-data-[variant=outline]:bg-linear-to-b data-[spacing=0]:not-data-[variant=outline]:from-[color-mix(in_oklch,var(--muted),var(--foreground)_7%)] data-[spacing=0]:not-data-[variant=outline]:to-muted data-[spacing=0]:not-data-[variant=outline]:p-[3px] data-[spacing=0]:not-data-[variant=outline]:shadow-[inset_0_1px_2px_rgb(0_0_0/0.1),inset_0_0_0_1px_rgb(0_0_0/0.05),0_1px_0_rgb(255_255_255/0.9)] dark:data-[spacing=0]:not-data-[variant=outline]:from-[color-mix(in_oklch,var(--muted),black_35%)] dark:data-[spacing=0]:not-data-[variant=outline]:shadow-[inset_0_1px_2px_rgb(0_0_0/0.6),inset_0_0_0_1px_rgb(0_0_0/0.25),0_1px_0_rgb(255_255_255/0.07)]",
        className,
      )}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size, spacing, orientation }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  );
}

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext);

  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        "shrink-0 group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:px-2 focus:z-10 focus-visible:z-10 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-end]:pr-1.5 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-start]:pl-1.5 group-data-horizontal/toggle-group:data-[spacing=0]:first:rounded-l-lg group-data-vertical/toggle-group:data-[spacing=0]:first:rounded-t-lg group-data-horizontal/toggle-group:data-[spacing=0]:last:rounded-r-lg group-data-vertical/toggle-group:data-[spacing=0]:last:rounded-b-lg group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:border-l-0 group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:border-t-0 group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-l group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-t",
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        // In the Tabs track (joined, default variant) items are 6px shorter
        // and fully rounded, concentric with the track (radius − 3px), and
        // the pressed item rises as the Tabs chip instead of sinking. Text is
        // darkened for 4.5:1 on the track, and the focus ring is inset.
        "data-[spacing=0]:not-data-[variant=outline]:rounded-[calc(var(--radius-lg)-3px)]! data-[spacing=0]:not-data-[variant=outline]:text-[color-mix(in_oklch,var(--muted-foreground),var(--foreground)_20%)] data-[spacing=0]:not-data-[variant=outline]:hover:text-foreground data-[spacing=0]:not-data-[variant=outline]:data-[state=on]:text-foreground data-[spacing=0]:not-data-[variant=outline]:focus-visible:ring-inset data-[spacing=0]:not-data-[variant=outline]:focus-visible:ring-offset-0 dark:data-[spacing=0]:not-data-[variant=outline]:text-muted-foreground dark:data-[spacing=0]:not-data-[variant=outline]:hover:text-foreground dark:data-[spacing=0]:not-data-[variant=outline]:data-[state=on]:text-foreground data-[spacing=0]:not-data-[variant=outline]:hover:bg-transparent data-[spacing=0]:not-data-[variant=outline]:data-[size=default]:h-[26px] data-[spacing=0]:not-data-[variant=outline]:data-[size=default]:min-w-[26px] data-[spacing=0]:not-data-[variant=outline]:data-[size=sm]:h-[22px] data-[spacing=0]:not-data-[variant=outline]:data-[size=sm]:min-w-[22px] data-[spacing=0]:not-data-[variant=outline]:data-[size=sm]:rounded-[calc(min(var(--radius-md),10px)-3px)]! data-[spacing=0]:not-data-[variant=outline]:data-[size=lg]:h-[30px] data-[spacing=0]:not-data-[variant=outline]:data-[size=lg]:min-w-[30px]",
        "data-[spacing=0]:not-data-[variant=outline]:before:from-background data-[spacing=0]:not-data-[variant=outline]:before:to-[color-mix(in_oklch,var(--background),var(--secondary)_60%)] data-[spacing=0]:not-data-[variant=outline]:before:shadow-[0_1px_2px_rgb(0_0_0/0.1),0_0_0_1px_rgb(0_0_0/0.07),inset_0_-1px_0_rgb(0_0_0/0.03)] dark:data-[spacing=0]:not-data-[variant=outline]:before:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_9%)] dark:data-[spacing=0]:not-data-[variant=outline]:before:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] dark:data-[spacing=0]:not-data-[variant=outline]:before:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.06),inset_0_1px_0_rgb(255_255_255/0.07)]",
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
}

export { ToggleGroup, ToggleGroupItem };
