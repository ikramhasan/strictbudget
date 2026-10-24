import { cn } from "@strictbudget/ui/lib/utils";
import type * as React from "react";

// The register's table parts, in the shared Table's look (a muted tray, its rows on a raised card)
// but sized for the register: its fixed column widths are built for px-2 cells without a minimum
// height, and its rows show hover, an open menu and selection on every cell, pinned ones included
// (PINNED_BG only adds their opaque resting colour). States are a step deeper than the shared
// Table's so rows read apart on a dense page.

/** A raised card behind the rows, drawn by `before:` so the header can sit on the tray above it. */
function RegisterBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      className={cn(
        "relative before:pointer-events-none before:absolute before:-inset-px before:-z-1 before:rounded-[10px] before:border before:border-border before:bg-background before:shadow-[0_1px_2px_rgb(0_0_0/0.04)] empty:before:hidden dark:before:shadow-[0_1px_2px_rgb(0_0_0/0.4)]",
        // Corner cells round with the card, so opaque cells (pinned, hovered, selected) don't
        // cover its corners.
        "[&>tr:first-child>:first-child]:rounded-tl-[9px] [&>tr:first-child>:last-child]:rounded-tr-[9px] [&>tr:last-child>:first-child]:rounded-bl-[9px] [&>tr:last-child>:last-child]:rounded-br-[9px]",
        // Two bodies (scheduled, then transactions) read as one card: square where they join.
        "[&:has(+tbody:not(:empty))]:before:rounded-b-none [tbody:not(:empty)+&]:before:rounded-t-none [tbody:not(:empty)+&]:before:border-t-0 [&:has(+tbody:not(:empty))>tr:last-child>*]:rounded-b-none [tbody:not(:empty)+&>tr:first-child>*]:rounded-t-none",
        className,
      )}
      {...props}
    />
  );
}

const ROW_STATES =
  "hover:*:bg-accent has-aria-expanded:*:bg-accent data-[state=selected]:*:bg-[color-mix(in_oklch,var(--primary)_8%,var(--background))] data-[state=selected]:hover:*:bg-[color-mix(in_oklch,var(--primary)_12%,var(--background))] dark:data-[state=selected]:*:bg-[color-mix(in_oklch,var(--primary)_16%,var(--background))] dark:data-[state=selected]:hover:*:bg-[color-mix(in_oklch,var(--primary)_20%,var(--background))]";

function RegisterRow({
  className,
  still = false,
  ...props
}: React.ComponentProps<"tr"> & {
  /** No hover or selection states (the inline editor's rows). */
  still?: boolean;
}) {
  return (
    <tr
      className={cn(
        "*:transition-colors *:duration-100 not-last:*:border-b",
        !still && ROW_STATES,
        className,
      )}
      {...props}
    />
  );
}

function RegisterHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function RegisterCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      className={cn(
        "border-border p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

export { RegisterBody, RegisterCell, RegisterHead, RegisterRow };
