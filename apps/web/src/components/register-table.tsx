import { Spinner } from "@strictbudget/ui/components/spinner";
import { cn } from "@strictbudget/ui/lib/utils";
import { Check, Lock } from "lucide-react";
import type * as React from "react";
import { AccountLogo } from "./accounts-nav";

// The register's table parts, in the shared Table's look (a muted tray, its rows on a raised card)
// but sized for the register: its fixed column widths are built for px-2 cells without a minimum
// height, and its rows show hover, an open menu and selection on every cell, pinned ones included
// (PINNED_BG only adds their opaque resting colour). States are a step deeper than the shared
// Table's so rows read apart on a dense page.

/** The tray's colour, on the scroll area and its sticky header cells (which must be opaque). */
const REGISTER_TRAY = "bg-muted dark:bg-[color-mix(in_oklch,var(--background),black_20%)]";

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
  "hover:*:bg-accent has-[[aria-haspopup][aria-expanded=true]]:*:bg-accent data-[state=selected]:*:bg-[color-mix(in_oklch,var(--primary)_8%,var(--background))] data-[state=selected]:hover:*:bg-[color-mix(in_oklch,var(--primary)_12%,var(--background))] dark:data-[state=selected]:*:bg-[color-mix(in_oklch,var(--primary)_16%,var(--background))] dark:data-[state=selected]:hover:*:bg-[color-mix(in_oklch,var(--primary)_20%,var(--background))]";

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
        "group/row *:transition-colors *:duration-100 not-last:*:border-b",
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
        "h-9 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
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

/**
 * A control that's only noise while unset (an empty flag, no attachment): hidden until its row is
 * hovered, focused or selected, or its menu is open. Still in the Tab order, and always shown on a
 * touch screen, which has no hover.
 */
const REVEAL_ON_ROW =
  "opacity-0 transition-opacity duration-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 group-data-[state=selected]/row:opacity-100 group-data-selected/row:opacity-100 has-[[data-state=open],[role=status]]:opacity-100 [@media(hover:none)]:opacity-100";

/** The icon columns' buttons fill their narrow cells, so those cells keep little padding. */
const ICON_CELL: Partial<Record<string, string>> = {
  flag: "px-0",
  attachment: "px-0.5",
  cleared: "px-1",
  actions: "px-1 py-1",
};

/**
 * An editor's cell: inputs nearly fill it, their text where a read row's is (8px in), so nothing
 * shifts when a row turns into its editor.
 */
const EDITOR_CELL =
  "px-0.5 [&_[data-slot=input-group-control]]:pl-[5px]! [&_[data-slot=input]]:px-[5px]!";

/**
 * A date field (the date and its calendar button) slimmed to the register's date column, with the
 * calendar button tucked against its right edge, its figures proportional like the read row's so
 * the date doesn't move as the row opens. On top of EDITOR_CELL.
 */
const DATE_EDITOR_FIT =
  "[&_[data-slot=input-group-control]]:normal-nums! [&_[data-slot=input-group-control]]:pr-0.5! [&_[data-slot=input-group-addon]]:pr-px! [&_[data-slot=input-group-addon]>button]:size-5";

/**
 * A transaction's cleared state at a glance: a solid green check once the bank has it, an empty
 * ring until then, a lock once reconciled. Decorative: the button or label around it names it.
 */
function ClearedMark({
  state,
  className,
}: {
  state: "cleared" | "uncleared" | "reconciled";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-cleared={state}
      className={cn(
        "inline-flex size-[18px] shrink-0 items-center justify-center rounded-full transition-colors",
        state === "cleared" && "bg-success text-background",
        state === "uncleared" &&
          "border-[1.5px] border-muted-foreground/45 group-hover/cleared:border-success/70",
        state === "reconciled" && "bg-success/15 text-success",
        className,
      )}
    >
      {/* `text-current` keeps a surrounding button's icon colour off the mark's own glyph. */}
      {state === "cleared" && <Check className="size-3 text-current!" strokeWidth={3} />}
      {state === "reconciled" && <Lock className="size-2.5 text-current!" strokeWidth={2.75} />}
    </span>
  );
}

/**
 * A row whose save hasn't come back yet, in its cleared column. A new row shows it at once; an edit
 * only once it's taking a moment, so a quick save doesn't flicker.
 */
function PendingMark({ delayed = false, className }: { delayed?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-[18px] items-center justify-center align-middle text-muted-foreground",
        delayed && "animate-in fade-in-0 fill-mode-backwards delay-300 duration-200",
        className,
      )}
    >
      <Spinner className="size-3.5" aria-label="Saving" />
    </span>
  );
}

/**
 * An account's logo in the register's account column, or an empty slot of its size, so every
 * name starts in the same place (the sidebar's way, without the initials' tiles).
 */
function AccountMark({ logo }: { logo: string | null }) {
  return logo ? (
    <AccountLogo name="" logo={logo} />
  ) : (
    <span aria-hidden className="size-4 shrink-0" />
  );
}

export {
  AccountMark,
  ClearedMark,
  DATE_EDITOR_FIT,
  EDITOR_CELL,
  ICON_CELL,
  PendingMark,
  REGISTER_TRAY,
  REVEAL_ON_ROW,
  RegisterBody,
  RegisterCell,
  RegisterHead,
  RegisterRow,
};
