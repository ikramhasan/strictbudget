import { cn } from "@strictbudget/ui/lib/utils";
import { Popover as PopoverPrimitive } from "radix-ui";
import * as React from "react";

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

// strictbudget: a gutter from the window's edges (`collisionPadding`) and an optional arrow.
function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  collisionPadding = 12,
  arrow = false,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  /** Points at the trigger: for a popover opened from a small control (a cell, a pill, an icon). */
  arrow?: boolean;
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "z-50 flex w-72 origin-(--radix-popover-content-transform-origin) flex-col gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground shadow-floating ring-1 ring-floating-border outline-none duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] data-[state=closed]:duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-96 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-96 motion-reduce:data-[state=open]:zoom-in-100 motion-reduce:data-[state=closed]:zoom-out-100",
          className,
        )}
        {...props}
      >
        {children}
        {arrow && <PopoverArrow />}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

/**
 * The arrow from a popover to its trigger, drawn in the popover's colours: its fill covers the
 * popover's ring where they meet, so the outline runs around both. Inside `PopoverContent` (or
 * pass `arrow` to it); Radix hides it when the trigger is too far off-centre to point at.
 */
function PopoverArrow({
  className,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Arrow>) {
  return (
    <PopoverPrimitive.Arrow data-slot="popover-arrow" width={16} height={8} asChild {...props}>
      <svg
        viewBox="0 0 16 8"
        aria-hidden
        className={cn("block overflow-visible fill-popover stroke-border", className)}
      >
        <path d="M0 -1 H16 L8 7.5 Z" stroke="none" />
        <path d="M0 0 L8 7.5 L16 0" fill="none" strokeWidth={1} />
      </svg>
    </PopoverPrimitive.Arrow>
  );
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-1 text-sm", className)}
      {...props}
    />
  );
}

function PopoverTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <div data-slot="popover-title" className={cn("font-medium", className)} {...props} />;
}

function PopoverDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Popover,
  PopoverAnchor,
  PopoverArrow,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
};
