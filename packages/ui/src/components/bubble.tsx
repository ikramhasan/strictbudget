import { cn } from "@strictbudget/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";

function BubbleGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bubble-group"
      className={cn("flex min-w-0 flex-col gap-1", className)}
      {...props}
    />
  );
}

const bubbleVariants = cva(
  "group/bubble relative flex w-fit max-w-[80%] min-w-0 flex-col gap-1 group-data-[align=end]/message:self-end data-[align=end]:self-end data-[variant=ghost]:max-w-full",
  {
    variants: {
      variant: {
        // The person's own turn: an ink key, raised like the default Button
        // (lighter top stop, inner highlight, a soft lift). It inverts with
        // the theme because it is drawn from foreground and background.
        default:
          "*:data-[slot=bubble-content]:border-[color-mix(in_oklch,var(--foreground),black_20%)] *:data-[slot=bubble-content]:bg-linear-to-b *:data-[slot=bubble-content]:from-[color-mix(in_oklch,var(--foreground),var(--background)_12%)] *:data-[slot=bubble-content]:to-foreground *:data-[slot=bubble-content]:text-background *:data-[slot=bubble-content]:shadow-[0_1px_2px_rgb(0_0_0/0.16),inset_0_1px_0_rgb(255_255_255/0.14)] dark:*:data-[slot=bubble-content]:border-[color-mix(in_oklch,var(--foreground),black_12%)] dark:*:data-[slot=bubble-content]:from-foreground dark:*:data-[slot=bubble-content]:to-[color-mix(in_oklch,var(--foreground),var(--background)_10%)] dark:*:data-[slot=bubble-content]:shadow-[0_1px_2px_rgb(0_0_0/0.45),inset_0_1px_0_rgb(255_255_255/0.5)] [&>[data-slot=bubble-content]:is(button,a):hover]:brightness-115 dark:[&>[data-slot=bubble-content]:is(button,a):hover]:brightness-95",
        // The secondary Button skin: a white key with a hairline.
        secondary:
          "*:data-[slot=bubble-content]:border-input *:data-[slot=bubble-content]:bg-linear-to-b *:data-[slot=bubble-content]:from-background *:data-[slot=bubble-content]:to-secondary *:data-[slot=bubble-content]:text-secondary-foreground *:data-[slot=bubble-content]:shadow-[0_1px_2px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] dark:*:data-[slot=bubble-content]:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_4%)] dark:*:data-[slot=bubble-content]:shadow-[0_1px_2px_rgb(0_0_0/0.4),inset_0_1px_0_rgb(255_255_255/0.06)] [&>[data-slot=bubble-content]:is(button,a):hover]:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] dark:[&>[data-slot=bubble-content]:is(button,a):hover]:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_8%)]",
        muted:
          "*:data-[slot=bubble-content]:bg-muted [&>[data-slot=bubble-content]:is(button,a):hover]:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_5%)]",
        tinted:
          "*:data-[slot=bubble-content]:bg-[color-mix(in_oklch,var(--primary)_8%,var(--background))] *:data-[slot=bubble-content]:text-foreground dark:*:data-[slot=bubble-content]:bg-[color-mix(in_oklch,var(--primary)_18%,var(--background))] [&>[data-slot=bubble-content]:is(button,a):hover]:bg-[color-mix(in_oklch,var(--primary)_13%,var(--background))] dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-[color-mix(in_oklch,var(--primary)_24%,var(--background))]",
        outline:
          "*:data-[slot=bubble-content]:border-border *:data-[slot=bubble-content]:bg-background [&>[data-slot=bubble-content]:is(button,a):hover]:bg-accent [&>[data-slot=bubble-content]:is(button,a):hover]:text-accent-foreground",
        ghost:
          "border-none *:data-[slot=bubble-content]:rounded-none *:data-[slot=bubble-content]:border-0 *:data-[slot=bubble-content]:bg-transparent *:data-[slot=bubble-content]:p-0 [&>[data-slot=bubble-content]:is(button,a):hover]:bg-accent [&>[data-slot=bubble-content]:is(button,a):hover]:text-accent-foreground",
        // Text on its own tint is darkened in light and lifted in dark, so it
        // passes 4.5:1 at rest and on hover.
        destructive:
          "*:data-[slot=bubble-content]:bg-destructive/10 *:data-[slot=bubble-content]:text-[color-mix(in_oklch,var(--destructive),black_12%)] dark:*:data-[slot=bubble-content]:bg-destructive/20 dark:*:data-[slot=bubble-content]:text-[color-mix(in_oklch,var(--destructive),white_25%)] [&>[data-slot=bubble-content]:is(button,a):hover]:bg-destructive/15 dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-destructive/25",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Bubble({
  variant = "default",
  align = "start",
  className,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof bubbleVariants> & {
    align?: "start" | "end";
  }) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      data-align={align}
      className={cn(bubbleVariants({ variant }), className)}
      {...props}
    />
  );
}

function BubbleContent({
  asChild = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot.Root : "div";

  return (
    <Comp
      data-slot="bubble-content"
      className={cn(
        // One line is 36px (1px border + 7px + 20px line + 7px + 1px), so
        // the 18px radius makes it a pill; text sits 14px from the edge.
        "w-fit max-w-full min-w-0 overflow-hidden rounded-2xl border border-transparent px-[13px] py-[7px] text-sm leading-5 wrap-break-word group-data-[align=end]/bubble:self-end [button]:text-left [button,a]:cursor-pointer [button,a]:transition-[color,background-color,border-color,box-shadow,filter] [button,a]:duration-150 [button,a]:ease-[cubic-bezier(0.23,1,0.32,1)] [button,a]:outline-none [button,a]:focus-visible:ring-2 [button,a]:focus-visible:ring-ring [button,a]:focus-visible:ring-offset-2 [button,a]:focus-visible:ring-offset-background",
        // Consecutive bubbles in a group tuck their corners on the sender's
        // side (6px, rounded-sm), so the run reads as one turn.
        "not-in-data-[align=end]:[[data-slot=bubble-group]>[data-slot=bubble]:not(:first-child)>&]:rounded-ss-sm not-in-data-[align=end]:[[data-slot=bubble-group]>[data-slot=bubble]:not(:last-child)>&]:rounded-es-sm in-data-[align=end]:[[data-slot=bubble-group]>[data-slot=bubble]:not(:first-child)>&]:rounded-se-sm in-data-[align=end]:[[data-slot=bubble-group]>[data-slot=bubble]:not(:last-child)>&]:rounded-ee-sm",
        className,
      )}
      {...props}
    />
  );
}

const bubbleReactionsVariants = cva(
  // A small raised chip (the secondary Button skin) pinned over the edge.
  "absolute z-10 flex h-6 w-fit min-w-6 shrink-0 items-center justify-center gap-1 rounded-full border border-input bg-linear-to-b from-background to-secondary px-1.5 text-sm leading-5 text-secondary-foreground tabular-nums shadow-[0_1px_2px_rgb(0_0_0/0.08),inset_0_-1px_0_rgb(0_0_0/0.03)] has-[button]:p-0 has-[button]:*:rounded-full dark:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_4%)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.4),inset_0_1px_0_rgb(255_255_255/0.06)] [&>button]:h-[22px]",
  {
    variants: {
      side: {
        top: "top-0 -translate-y-3/4",
        bottom: "bottom-0 translate-y-3/4",
      },
      align: {
        start: "left-3",
        end: "right-3",
      },
    },
    defaultVariants: {
      side: "bottom",
      align: "end",
    },
  },
);

function BubbleReactions({
  side = "bottom",
  align = "end",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  align?: "start" | "end";
  side?: "top" | "bottom";
}) {
  return (
    <div
      data-slot="bubble-reactions"
      data-align={align}
      data-side={side}
      className={cn(bubbleReactionsVariants({ side, align }), className)}
      {...props}
    />
  );
}

export { Bubble, BubbleContent, BubbleGroup, BubbleReactions };
