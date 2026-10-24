import { cn } from "@strictbudget/ui/lib/utils";
import { ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";
import { Slot } from "radix-ui";
import * as React from "react";

// A link lifts a white key out of the surface on hover (the secondary Button
// skin). The skin is a ::before bleeding 6px left/right and 2px up/down, so
// crumb text stays on the text edge and the 20px line.
const crumbSkin =
  "relative isolate rounded-md before:absolute before:-inset-x-1.5 before:-inset-y-0.5 before:-z-1 before:rounded-[inherit] before:transition-[opacity,box-shadow] before:duration-150 before:ease-[cubic-bezier(0.23,1,0.32,1)]";

function Breadcrumb({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav aria-label="breadcrumb" data-slot="breadcrumb" className={cn(className)} {...props} />
  );
}

function BreadcrumbList({ className, ...props }: React.ComponentProps<"ol">) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm wrap-break-word text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function BreadcrumbItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

function BreadcrumbLink({
  asChild,
  className,
  ...props
}: React.ComponentProps<"a"> & {
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot.Root : "a";

  return (
    <Comp
      data-slot="breadcrumb-link"
      className={cn(
        crumbSkin,
        "inline-flex items-center gap-1.5 transition-[color,translate] after:absolute after:-inset-x-1.5 after:-inset-y-2.5 duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] outline-none before:border before:border-input before:bg-linear-to-b before:from-background before:to-secondary before:opacity-0 before:shadow-[0_1px_2px_rgb(0_0_0/0.08),inset_0_-1px_0_rgb(0_0_0/0.03)] hover:text-foreground hover:before:opacity-100 aria-expanded:text-foreground aria-expanded:before:opacity-100 focus-visible:text-foreground focus-visible:before:opacity-100 focus-visible:before:ring-2 focus-visible:before:ring-ring active:translate-y-[0.5px] active:before:shadow-none motion-reduce:active:translate-y-0 dark:before:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)] dark:before:shadow-[0_1px_2px_rgb(0_0_0/0.4),inset_0_1px_0_rgb(255_255_255/0.06)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function BreadcrumbPage({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-page"
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={cn(
        "inline-flex items-center gap-1.5 font-medium text-foreground [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function BreadcrumbSeparator({ children, className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      className={cn("flex items-center justify-center [&>svg]:size-3.5", className)}
      {...props}
    >
      {children ?? <ChevronRightIcon />}
    </li>
  );
}

function BreadcrumbEllipsis({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-ellipsis"
      role="presentation"
      aria-hidden="true"
      className={cn("flex size-5 items-center justify-center [&>svg]:size-4", className)}
      {...props}
    >
      <MoreHorizontalIcon />
      <span className="sr-only">More</span>
    </span>
  );
}

export {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
};
