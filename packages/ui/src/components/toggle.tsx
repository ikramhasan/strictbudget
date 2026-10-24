import { cn } from "@strictbudget/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Toggle as TogglePrimitive } from "radix-ui";
import * as React from "react";

const toggleVariants = cva(
  // Off is flat (or raised, for outline); on is pressed into the surface: the
  // Kbd's recessed skin fades in on ::before, under the content (gradients
  // can't transition, opacity can).
  "group/toggle relative isolate inline-flex items-center justify-center gap-1 rounded-lg text-sm font-medium whitespace-nowrap text-muted-foreground transition-[color,background-color,box-shadow,scale] duration-150 ease-out-quint outline-none select-none before:absolute before:-z-1 before:rounded-[inherit] before:bg-linear-to-b before:from-[color-mix(in_oklch,var(--muted),var(--foreground)_7%)] before:to-muted before:opacity-0 before:shadow-[inset_0_1px_2px_rgb(0_0_0/0.1),inset_0_0_0_1px_rgb(0_0_0/0.05),0_1px_0_rgb(255_255_255/0.9)] before:transition-opacity before:duration-150 before:ease-out-quint hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 data-[state=on]:text-foreground data-[state=on]:before:opacity-100 motion-reduce:active:scale-100 dark:before:from-[color-mix(in_oklch,var(--muted),black_35%)] dark:before:shadow-[inset_0_1px_2px_rgb(0_0_0/0.6),inset_0_0_0_1px_rgb(0_0_0/0.25),0_1px_0_rgb(255_255_255/0.07)] dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent before:inset-0 hover:bg-accent",
        // The secondary Button skin when off; pressed, the well covers the
        // border too and the lift drops away.
        outline:
          "border border-input bg-linear-to-b from-background to-secondary shadow-[0_1px_2px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] before:-inset-px hover:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] data-[state=on]:shadow-none dark:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_4%)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.4),inset_0_1px_0_rgb(255_255_255/0.06)] dark:hover:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_8%)]",
      },
      size: {
        default:
          "h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-7 min-w-7 rounded-[min(var(--radius-md),12px)] px-2.5 text-[13px] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
