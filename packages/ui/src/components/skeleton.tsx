import { cn } from "@strictbudget/ui/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        // An empty slot pressed into the surface, waiting for its content:
        // the Kbd's well at a whisper (a soft lip, a faint hairline). It
        // breathes with the pulse; reduced motion holds it still.
        "animate-pulse rounded-md bg-linear-to-b from-[color-mix(in_oklch,var(--muted),var(--foreground)_5%)] to-muted shadow-[inset_0_1px_1px_rgb(0_0_0/0.06),inset_0_0_0_1px_rgb(0_0_0/0.03)] motion-reduce:animate-none dark:from-[color-mix(in_oklch,var(--muted),black_25%)] dark:shadow-[inset_0_1px_1px_rgb(0_0_0/0.4),inset_0_0_0_1px_rgb(0_0_0/0.2)]",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
