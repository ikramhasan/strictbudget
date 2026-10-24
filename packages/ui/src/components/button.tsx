import { cn } from "@strictbudget/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";

// strictbudget: presses scale to 0.97 (not translate-y-px) and only named properties transition, not `all`.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm leading-4 font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,filter,scale] duration-150 ease-out-quint outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:scale-[0.97] active:not-aria-[haspopup]:shadow-none motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-[color-mix(in_oklch,var(--primary),black_15%)] bg-linear-to-b from-[color-mix(in_oklch,var(--primary),white_15%)] to-primary text-primary-foreground shadow-[0_1px_2px_rgb(30_60_160/0.28),inset_0_1px_0_rgb(255_255_255/0.22)] hover:brightness-106 aria-expanded:brightness-106 dark:shadow-[0_1px_2px_rgb(0_0_0/0.45),inset_0_1px_0_rgb(255_255_255/0.22)]",
        outline:
          "border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground dark:shadow-[0_1px_2px_rgb(0_0_0/0.4)]",
        secondary:
          "border-input bg-linear-to-b from-background to-secondary text-secondary-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] hover:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] dark:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_4%)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.4),inset_0_1px_0_rgb(255_255_255/0.06)] dark:hover:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_8%)] dark:aria-expanded:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_8%)]",
        ghost:
          "hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground [&_svg]:text-muted-foreground",
        destructive:
          "bg-destructive/10 text-[color-mix(in_oklch,var(--destructive),black_12%)] hover:bg-destructive/20 focus-visible:ring-destructive dark:bg-destructive/20 dark:text-[color-mix(in_oklch,var(--destructive),white_25%)] dark:hover:bg-destructive/30",
        link: "text-primary underline-offset-4 hover:underline dark:text-[color-mix(in_oklch,var(--primary),white_35%)]",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 rounded-md px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-7 gap-1.5 px-2.5 text-[13px] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-9 gap-2 px-3.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-md in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    compoundVariants: [
      // Ghost buttons sit flush in toolbars, so they run tighter than filled ones.
      {
        variant: "ghost",
        size: "default",
        className: "px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
      },
      {
        variant: "ghost",
        size: "sm",
        className: "px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
      },
      {
        variant: "ghost",
        size: "lg",
        className: "px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
      },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
