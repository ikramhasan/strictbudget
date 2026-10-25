import { Button } from "@strictbudget/ui/components/button";
import { cn } from "@strictbudget/ui/lib/utils";
import { XIcon } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
import * as React from "react";

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/10 duration-250 ease-[cubic-bezier(0.23,1,0.32,1)] supports-backdrop-filter:backdrop-blur-xs data-[state=closed]:duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 dark:bg-black/40",
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left";
  showCloseButton?: boolean;
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          // The Dialog's frame on an edge: a muted shell holding a raised
          // card (the ::before, spanning every grid row above `footer`), with
          // SheetFooter on the shell. The shell's 4px padding insets the card
          // and the footer buttons alike; the card is rounded 10px. A 1fr
          // filler row stretches the card down to the footer.
          "fixed z-50 grid grid-cols-1 grid-rows-[repeat(16,auto)_1fr_[footer]_auto] bg-muted p-1 text-sm text-popover-foreground shadow-[0_8px_32px_rgb(0_0_0/0.12)] duration-250 ease-[cubic-bezier(0.23,1,0.32,1)] outline-none before:absolute before:inset-0 before:-z-1 before:col-[1/2] before:row-[1/footer] before:rounded-lg before:border before:border-border before:bg-popover before:shadow-[0_1px_2px_rgb(0_0_0/0.04)] data-[state=closed]:duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 dark:bg-[color-mix(in_oklch,var(--popover),black_20%)] dark:shadow-[0_8px_32px_rgb(0_0_0/0.5)] dark:before:shadow-[0_1px_2px_rgb(0_0_0/0.4)] [&>:not(:first-child,[data-slot=sheet-footer],[data-slot=sheet-close])]:mt-4",
          // Without a footer the card fills the whole edge.
          "not-has-data-[slot=sheet-footer]:grid-rows-[repeat(16,auto)_1fr] not-has-data-[slot=sheet-footer]:before:row-[1/-1]",
          // Sides: a 1px border on the open edge; the panel slides 40px in.
          "data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=bottom]:data-[state=open]:slide-in-from-bottom-10 data-[side=bottom]:data-[state=closed]:slide-out-to-bottom-10",
          "data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=top]:data-[state=open]:slide-in-from-top-10 data-[side=top]:data-[state=closed]:slide-out-to-top-10",
          "data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=left]:data-[state=open]:slide-in-from-left-10 data-[side=left]:data-[state=closed]:slide-out-to-left-10 data-[side=left]:sm:max-w-sm",
          "data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:data-[state=open]:slide-in-from-right-10 data-[side=right]:data-[state=closed]:slide-out-to-right-10 data-[side=right]:sm:max-w-sm",
          "motion-reduce:[--tw-enter-translate-x:0]! motion-reduce:[--tw-enter-translate-y:0]! motion-reduce:[--tw-exit-translate-x:0]! motion-reduce:[--tw-exit-translate-y:0]!",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button variant="ghost" className="absolute top-4.5 right-5" size="icon-sm">
              <XIcon />
              <span className="sr-only">Close</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      // 16px inside the card; the right side clears the close button.
      className={cn("flex flex-col gap-1 p-4 in-data-[slot=sheet-content]:pr-12", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      // On the shell, below the card: 4px from the card and the edges, so
      // the 10px buttons are concentric with the shell's corners.
      className={cn("row-start-[footer] mt-auto flex flex-col gap-2 pt-1", className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-heading text-base font-medium text-foreground", className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};
