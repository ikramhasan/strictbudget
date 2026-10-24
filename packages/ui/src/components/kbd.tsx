import { cn } from "@strictbudget/ui/lib/utils";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted bg-linear-to-b from-[color-mix(in_oklch,var(--muted),var(--foreground)_7%)] to-muted px-1 font-sans shadow-[inset_0_1px_1.5px_rgb(0_0_0/0.12),inset_0_0_0_1px_rgb(0_0_0/0.05),0_1px_0_rgb(255_255_255/0.9)] dark:from-[color-mix(in_oklch,var(--muted),black_35%)] dark:shadow-[inset_0_1px_1.5px_rgb(0_0_0/0.6),inset_0_0_0_1px_rgb(0_0_0/0.25),0_1px_0_rgb(255_255_255/0.07)] text-xs font-medium text-muted-foreground select-none in-data-[slot=tooltip-content]:bg-foreground in-data-[slot=tooltip-content]:from-[color-mix(in_oklch,var(--foreground),black_35%)] in-data-[slot=tooltip-content]:to-foreground in-data-[slot=tooltip-content]:text-[color-mix(in_oklch,var(--background),var(--foreground)_20%)] in-data-[slot=tooltip-content]:shadow-[inset_0_1px_1.5px_rgb(0_0_0/0.6),inset_0_0_0_1px_rgb(0_0_0/0.25),0_1px_0_rgb(255_255_255/0.07)] dark:in-data-[slot=tooltip-content]:from-[color-mix(in_oklch,var(--foreground),var(--background)_7%)] dark:in-data-[slot=tooltip-content]:shadow-[inset_0_1px_1.5px_rgb(0_0_0/0.12),inset_0_0_0_1px_rgb(0_0_0/0.05),0_1px_0_rgb(255_255_255/0.9)] [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
