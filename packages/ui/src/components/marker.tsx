import { cn } from "@strictbudget/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";

const markerVariants = cva(
  "group/marker relative flex min-h-5 w-full items-center gap-2 text-left text-sm leading-5 text-muted-foreground outline-none [&_svg:not([class*='size-'])]:size-4 [a]:underline [a]:underline-offset-3 [a,button]:cursor-pointer [a,button]:rounded-sm [a,button]:transition-colors [a,button]:duration-150 [a,button]:hover:text-foreground [a,button]:focus-visible:ring-2 [a,button]:focus-visible:ring-ring [a,button]:focus-visible:ring-offset-2 [a,button]:focus-visible:ring-offset-background",
  {
    variants: {
      variant: {
        default: "",
        // The engraved Separator line on each side: a hairline with a 1px
        // highlight under it.
        separator:
          "before:mr-1 before:h-px before:min-w-0 before:flex-1 before:bg-border before:shadow-[0_1px_0_rgb(255_255_255/0.8)] after:ml-1 after:h-px after:min-w-0 after:flex-1 after:bg-border after:shadow-[0_1px_0_rgb(255_255_255/0.8)] dark:before:bg-black/40 dark:before:shadow-[0_1px_0_rgb(255_255_255/0.05)] dark:after:bg-black/40 dark:after:shadow-[0_1px_0_rgb(255_255_255/0.05)]",
        border:
          "border-b border-border pb-2 shadow-[0_1px_0_rgb(255_255_255/0.8)] dark:border-black/40 dark:shadow-[0_1px_0_rgb(255_255_255/0.05)]",
      },
    },
  },
);

function Marker({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof markerVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "div";

  return (
    <Comp
      data-slot="marker"
      data-variant={variant}
      className={cn(markerVariants({ variant, className }))}
      {...props}
    />
  );
}

function MarkerIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="marker-icon"
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function MarkerContent({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="marker-content"
      className={cn(
        "min-w-0 wrap-break-word group-data-[variant=separator]/marker:flex-none group-data-[variant=separator]/marker:text-center *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Marker, MarkerContent, MarkerIcon, markerVariants };
