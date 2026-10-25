import { DropdownMenuContent } from "@strictbudget/ui/components/dropdown-menu";
import { useSidebar } from "@strictbudget/ui/components/sidebar";
import { cn } from "@strictbudget/ui/lib/utils";
import type { ComponentProps } from "react";

/**
 * A sidebar button's menu: as wide as the button, and at least readable. From the icon rail the
 * button is just an icon, so the menu opens beside it instead of being squeezed to its width.
 */
export function SidebarDropdownContent({
  side,
  align,
  railAlign = "start",
  className,
  ...props
}: ComponentProps<typeof DropdownMenuContent> & { railAlign?: "start" | "end" }) {
  const { state, isMobile } = useSidebar();
  const railed = state === "collapsed" && !isMobile;
  return (
    <DropdownMenuContent
      side={railed ? "right" : side}
      align={railed ? railAlign : align}
      className={cn("w-(--radix-dropdown-menu-trigger-width) min-w-56", className)}
      {...props}
    />
  );
}
