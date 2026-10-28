import { badgeVariants } from "@strictbudget/ui/components/badge";
import { buttonVariants } from "@strictbudget/ui/components/button";
import { cn } from "@strictbudget/ui/lib/utils";

/**
 * The design system's Button classes for a link. "main" is the page's call to action (40px, 16px
 * semibold); "small" sits in the navigation (36px, 14px semibold).
 */
export function buttonClass(
  variant: "default" | "outline" | "ghost",
  size: "main" | "small",
  className?: string,
) {
  return cn(
    buttonVariants({ variant, size: "lg" }),
    size === "main" ? "h-10 gap-2 px-3 text-base font-semibold" : "h-9 px-3 text-sm font-semibold",
    className,
  );
}

/** The design system's default Badge. */
export const badgeClass = (className?: string) => cn(badgeVariants(), className);

export { cn };
