import { cn } from "@strictbudget/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent px-[5px] text-[13px] leading-4 font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background has-data-[icon=inline-end]:pr-[3px] has-data-[icon=inline-start]:pl-[3px] aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default:
          "[--badge-fill:color-mix(in_oklch,var(--primary)_10%,transparent)] [--badge-text:color-mix(in_oklch,var(--primary),black_12%)] dark:[--badge-fill:color-mix(in_oklch,var(--primary)_20%,transparent)] dark:[--badge-text:color-mix(in_oklch,var(--primary),white_35%)] bg-(--badge-fill) text-(--badge-text) [a]:hover:bg-[color-mix(in_oklch,currentColor_15%,transparent)]",
        secondary:
          "bg-muted text-muted-foreground [a]:hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_5%)]",
        destructive:
          "[--badge-fill:color-mix(in_oklch,var(--destructive)_10%,transparent)] [--badge-text:color-mix(in_oklch,var(--destructive),black_12%)] dark:[--badge-fill:color-mix(in_oklch,var(--destructive)_20%,transparent)] dark:[--badge-text:color-mix(in_oklch,var(--destructive),white_25%)] bg-(--badge-fill) text-(--badge-text) [a]:hover:bg-[color-mix(in_oklch,currentColor_15%,transparent)] focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline:
          "border-border text-foreground [a]:hover:bg-accent [a]:hover:text-accent-foreground",
        ghost: "text-muted-foreground [a]:hover:bg-accent [a]:hover:text-accent-foreground",
        link: "[--badge-text:var(--primary)] dark:[--badge-text:color-mix(in_oklch,var(--primary),white_35%)] text-(--badge-text) underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
