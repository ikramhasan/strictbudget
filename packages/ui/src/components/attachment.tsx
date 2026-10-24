import { Button } from "@strictbudget/ui/components/button";
import { cn } from "@strictbudget/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";

const attachmentVariants = cva(
  // A muted chip with a hairline, holding a raised media tile. Each size
  // pairs its radius with its inset, so the tile is concentric: 18 − 8 = 10
  // (default), 14 − 6 = 8 (sm), 10 − 4 = 6 (xs). Horizontal chips are
  // 56 / 44 / 36px tall with or without media; without it, the text sits
  // 12 / 10 / 8px in.
  "group/attachment relative flex w-fit max-w-full min-w-0 shrink-0 flex-wrap border border-border bg-muted text-foreground transition-[background-color,border-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] has-[>a,>button]:hover:border-input has-[>a,>button]:hover:bg-[color-mix(in_oklch,var(--muted),var(--background)_60%)] dark:has-[>a,>button]:hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_4%)] has-[>[data-slot=attachment-trigger]:focus-visible]:ring-2 has-[>[data-slot=attachment-trigger]:focus-visible]:ring-ring has-[>[data-slot=attachment-trigger]:focus-visible]:ring-inset data-[state=error]:border-destructive/30 data-[state=idle]:border-dashed data-[state=idle]:border-[color-mix(in_oklch,var(--input),var(--foreground)_15%)] dark:data-[state=error]:border-destructive/40",
  {
    variants: {
      size: {
        default:
          "gap-3 rounded-2xl p-[7px] data-[orientation=horizontal]:min-h-14 text-sm leading-5 not-has-data-[slot=attachment-media]:px-[11px] not-has-data-[slot=attachment-media]:py-2 data-[orientation=horizontal]:has-data-[slot=attachment-content]:not-has-data-[slot=attachment-actions]:pe-[11px]",
        sm: "gap-2.5 rounded-xl p-[5px] data-[orientation=horizontal]:min-h-11 text-xs leading-4 not-has-data-[slot=attachment-media]:px-[9px] not-has-data-[slot=attachment-media]:py-1 data-[orientation=horizontal]:has-data-[slot=attachment-content]:not-has-data-[slot=attachment-actions]:pe-[9px]",
        xs: "gap-2 rounded-lg p-[3px] data-[orientation=horizontal]:min-h-9 text-xs leading-4 not-has-data-[slot=attachment-media]:px-[7px] not-has-data-[slot=attachment-media]:py-0 data-[orientation=horizontal]:has-data-[slot=attachment-content]:not-has-data-[slot=attachment-actions]:pe-[7px]",
      },
      orientation: {
        horizontal: "min-w-40 items-center",
        vertical: "w-24 flex-col has-data-[slot=attachment-content]:w-30",
      },
    },
  },
);

function Attachment({
  className,
  state = "done",
  size = "default",
  orientation = "horizontal",
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof attachmentVariants> & {
    state?: "idle" | "uploading" | "processing" | "error" | "done";
  }) {
  return (
    <div
      data-slot="attachment"
      data-state={state}
      data-size={size}
      data-orientation={orientation}
      className={cn(attachmentVariants({ size, orientation }), className)}
      {...props}
    />
  );
}

const attachmentMediaVariants = cva(
  "relative flex aspect-square w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg text-foreground group-data-[orientation=vertical]/attachment:w-full group-data-[size=sm]/attachment:w-8 group-data-[size=sm]/attachment:rounded-md group-data-[size=xs]/attachment:w-7 group-data-[size=xs]/attachment:rounded-sm group-data-[orientation=vertical]/attachment:*:data-[slot=spinner]:size-6! [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 group-data-[orientation=vertical]/attachment:[&_svg:not([class*='size-'])]:size-6 group-data-[size=xs]/attachment:[&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        // The secondary Button skin: a white key raised out of the chip.
        // Errors flatten it to the destructive tint.
        icon: "border border-input bg-linear-to-b from-background to-secondary shadow-[0_1px_2px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] group-data-[state=error]/attachment:border-transparent group-data-[state=error]/attachment:bg-destructive/10 group-data-[state=error]/attachment:bg-none group-data-[state=error]/attachment:text-[color-mix(in_oklch,var(--destructive),black_12%)] group-data-[state=error]/attachment:shadow-none dark:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_4%)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.4),inset_0_1px_0_rgb(255_255_255/0.06)] dark:group-data-[state=error]/attachment:bg-destructive/20 dark:group-data-[state=error]/attachment:text-[color-mix(in_oklch,var(--destructive),white_25%)]",
        // Images get a 1px low-opacity outline (pure black / white) and dim
        // while they upload.
        image:
          "bg-background opacity-60 transition-opacity duration-150 group-data-[state=done]/attachment:opacity-100 group-data-[state=idle]/attachment:opacity-100 after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:ring-black/10 after:ring-inset *:[img]:aspect-square *:[img]:w-full *:[img]:object-cover dark:after:ring-white/10",
      },
    },
    defaultVariants: {
      variant: "icon",
    },
  },
);

function AttachmentMedia({
  className,
  variant = "icon",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof attachmentMediaVariants>) {
  return (
    <div
      data-slot="attachment-media"
      data-variant={variant}
      className={cn(attachmentMediaVariants({ variant }), className)}
      {...props}
    />
  );
}

function AttachmentContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-content"
      className={cn(
        "max-w-full min-w-0 flex-1 group-data-[orientation=vertical]/attachment:px-1 group-data-[orientation=vertical]/attachment:pb-1",
        className,
      )}
      {...props}
    />
  );
}

function AttachmentTitle({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="attachment-title"
      className={cn(
        "block max-w-full min-w-0 truncate font-medium group-data-[state=processing]/attachment:shimmer group-data-[state=uploading]/attachment:shimmer",
        className,
      )}
      {...props}
    />
  );
}

function AttachmentDescription({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="attachment-description"
      className={cn(
        "mt-0.5 block min-w-0 truncate text-xs leading-4 group-data-[size=sm]/attachment:mt-0 group-data-[size=xs]/attachment:mt-0 text-muted-foreground group-data-[state=error]/attachment:text-[color-mix(in_oklch,var(--destructive),black_12%)] dark:group-data-[state=error]/attachment:text-[color-mix(in_oklch,var(--destructive),white_25%)]",
        "max-w-full",
        className,
      )}
      {...props}
    />
  );
}

function AttachmentActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-actions"
      className={cn(
        "relative z-20 flex shrink-0 items-center group-data-[orientation=vertical]/attachment:absolute group-data-[orientation=vertical]/attachment:top-3 group-data-[orientation=vertical]/attachment:right-3 group-data-[orientation=vertical]/attachment:gap-1",
        className,
      )}
      {...props}
    />
  );
}

function AttachmentAction({
  className,
  variant,
  size = "icon-xs",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="attachment-action"
      variant={variant ?? "ghost"}
      size={size}
      // The hit area reaches 40px tall without overlapping its neighbors.
      className={cn("relative after:absolute after:-inset-y-2", className)}
      {...props}
    />
  );
}

function AttachmentTrigger({
  className,
  asChild = false,
  type,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="attachment-trigger"
      type={asChild ? undefined : (type ?? "button")}
      className={cn(
        "absolute inset-0 z-10 cursor-pointer rounded-[inherit] outline-none",
        className,
      )}
      {...props}
    />
  );
}

function AttachmentGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-group"
      className={cn(
        "flex min-w-0 scroll-fade-x snap-x snap-mandatory scroll-px-1 scrollbar-none gap-3 overflow-x-auto overscroll-x-contain py-1 *:data-[slot=attachment]:flex-none *:data-[slot=attachment]:snap-start",
        className,
      )}
      {...props}
    />
  );
}

export {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
};
