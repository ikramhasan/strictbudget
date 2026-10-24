"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { Button } from "@strictbudget/ui/components/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@strictbudget/ui/components/input-group";
import { cn } from "@strictbudget/ui/lib/utils";
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import * as React from "react";

const Combobox = ComboboxPrimitive.Root;

function ComboboxValue({ ...props }: ComboboxPrimitive.Value.Props) {
  return <ComboboxPrimitive.Value data-slot="combobox-value" {...props} />;
}

function ComboboxTrigger({ className, children, ...props }: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn("[&_svg:not([class*='size-'])]:size-4", className)}
      {...props}
    >
      {children}
      <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
    </ComboboxPrimitive.Trigger>
  );
}

function ComboboxClear({ className, ...props }: ComboboxPrimitive.Clear.Props) {
  return (
    <ComboboxPrimitive.Clear
      data-slot="combobox-clear"
      render={<InputGroupButton variant="ghost" size="icon-xs" />}
      className={cn(className)}
      {...props}
    >
      <XIcon className="pointer-events-none" />
    </ComboboxPrimitive.Clear>
  );
}

function ComboboxInput({
  className,
  children,
  disabled = false,
  showTrigger = true,
  showClear = false,
  ...props
}: ComboboxPrimitive.Input.Props & {
  showTrigger?: boolean;
  showClear?: boolean;
}) {
  return (
    // Base UI's InputGroup makes the whole frame the popup's anchor, so the
    // popup lines up with the field's outer edge rather than the input's.
    <ComboboxPrimitive.InputGroup render={<InputGroup className={cn("w-auto", className)} />}>
      <ComboboxPrimitive.Input render={<InputGroupInput disabled={disabled} />} {...props} />
      <InputGroupAddon align="inline-end">
        {showTrigger && (
          <InputGroupButton
            size="icon-xs"
            variant="ghost"
            asChild
            data-slot="input-group-button"
            className="group-has-data-[slot=combobox-clear]/input-group:hidden data-pressed:bg-transparent"
            disabled={disabled}
          >
            <ComboboxTrigger />
          </InputGroupButton>
        )}
        {showClear && <ComboboxClear disabled={disabled} />}
      </InputGroupAddon>
      {children}
    </ComboboxPrimitive.InputGroup>
  );
}

function ComboboxContent({
  className,
  side = "bottom",
  sideOffset = 6,
  align = "start",
  alignOffset = 0,
  anchor,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    "side" | "align" | "sideOffset" | "alignOffset" | "anchor"
  >) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="isolate z-50"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          data-chips={!!anchor}
          className={cn(
            // The Select shell: muted, 14px radius, scaling from the field.
            // The list pads 4px, so rows are 10px (14 − 4) and their text
            // lands 11px in (4px + 7px), level with the input's text above.
            "group/combobox-content relative max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) min-w-(--anchor-width) origin-(--transform-origin) overflow-hidden rounded-xl bg-muted text-sm text-popover-foreground shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_rgb(0_0_0/0.1),inset_0_1px_0_rgb(255_255_255/0.7)] ring-1 ring-border transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] outline-none data-ending-style:scale-96 data-ending-style:opacity-0 data-ending-style:duration-100 data-starting-style:scale-96 data-starting-style:opacity-0 motion-reduce:data-ending-style:scale-100 motion-reduce:data-starting-style:scale-100 dark:bg-[color-mix(in_oklch,var(--popover),black_20%)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_8px_24px_rgb(0_0_0/0.5),inset_0_1px_0_rgb(255_255_255/0.04)]",
            // An input inside the popup is pressed into the shell, like the
            // Command's query: the Kbd's recessed well, 4px from the edges
            // (radius 14 − 4), with its text on the rows' 11px column. It
            // holds focus while open, so it has no ring.
            "*:data-[slot=input-group]:m-1 *:data-[slot=input-group]:mb-0 *:data-[slot=input-group]:h-8 *:data-[slot=input-group]:w-auto *:data-[slot=input-group]:rounded-lg *:data-[slot=input-group]:border-0 *:data-[slot=input-group]:ring-0! *:data-[slot=input-group]:bg-linear-to-b *:data-[slot=input-group]:from-[color-mix(in_oklch,var(--muted),var(--foreground)_7%)] *:data-[slot=input-group]:to-muted *:data-[slot=input-group]:shadow-[inset_0_1px_2px_rgb(0_0_0/0.1),inset_0_0_0_1px_rgb(0_0_0/0.05),0_1px_0_rgb(255_255_255/0.9)] dark:*:data-[slot=input-group]:from-[color-mix(in_oklch,var(--muted),black_35%)] dark:*:data-[slot=input-group]:shadow-[inset_0_1px_2px_rgb(0_0_0/0.6),inset_0_0_0_1px_rgb(0_0_0/0.25),0_1px_0_rgb(255_255_255/0.07)] **:data-[slot=input-group-control]:pl-[7px] **:data-[slot=input-group-control]:caret-primary **:data-[slot=input-group-control]:placeholder:text-[color-mix(in_oklch,var(--muted-foreground),var(--foreground)_20%)] dark:**:data-[slot=input-group-control]:placeholder:text-muted-foreground",
            className,
          )}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn(
        "no-scrollbar max-h-[min(calc(--spacing(72)---spacing(9)),calc(var(--available-height)---spacing(9)))] scroll-py-1 overflow-y-auto overscroll-contain p-1 data-empty:p-0",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxItem({ className, children, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        // The Select row: 32px, and the highlighted row (pointer or arrows,
        // while focus stays in the input) lifts out of the shell as a raised
        // card, instantly.
        "relative flex min-h-8 w-full cursor-default items-center gap-2 rounded-lg py-1.5 pr-8 pl-[7px] text-sm outline-hidden select-none data-highlighted:bg-linear-to-b data-highlighted:from-background data-highlighted:to-[color-mix(in_oklch,var(--background),var(--secondary)_60%)] data-highlighted:text-accent-foreground data-highlighted:shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] dark:data-highlighted:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_7%)] dark:data-highlighted:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_3%)] dark:data-highlighted:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.05),inset_0_1px_0_rgb(255_255_255/0.06)] data-highlighted:[&_svg:not([class*='text-'])]:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator
        keepMounted
        render={
          // The tick draws itself, like Select and Checkbox.
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center [&_path]:transition-[stroke-dashoffset] [&_path]:duration-200 [&_path]:ease-[cubic-bezier(0.23,1,0.32,1)] [&_path]:[stroke-dasharray:24] not-data-[selected]:[&_path]:duration-100 not-data-[selected]:[&_path]:[stroke-dashoffset:-24] data-[selected]:[&_path]:[stroke-dashoffset:0] motion-reduce:[&_path]:transition-none" />
        }
      >
        <CheckIcon className="pointer-events-none stroke-[2.5] text-primary dark:text-[color-mix(in_oklch,var(--primary),white_35%)]" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  );
}

function ComboboxGroup({ className, ...props }: ComboboxPrimitive.Group.Props) {
  return (
    <ComboboxPrimitive.Group data-slot="combobox-group" className={cn(className)} {...props} />
  );
}

function ComboboxLabel({ className, ...props }: ComboboxPrimitive.GroupLabel.Props) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="combobox-label"
      className={cn("px-[7px] py-1.5 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

function ComboboxCollection({ ...props }: ComboboxPrimitive.Collection.Props) {
  return <ComboboxPrimitive.Collection data-slot="combobox-collection" {...props} />;
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn(
        // A 40px state, the height of a one-row list (4 + 32 + 4).
        "hidden w-full justify-center py-2.5 text-center text-sm text-muted-foreground group-data-empty/combobox-content:flex",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxSeparator({ className, ...props }: ComboboxPrimitive.Separator.Props) {
  return (
    <ComboboxPrimitive.Separator
      data-slot="combobox-separator"
      // Engraved, like Separator: a hairline with a highlight under it.
      className={cn(
        "pointer-events-none -mx-1 my-1 h-px bg-border shadow-[0_1px_0_rgb(255_255_255/0.8)] dark:bg-black/40 dark:shadow-[0_1px_0_rgb(255_255_255/0.05)]",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxChips({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof ComboboxPrimitive.Chips> & ComboboxPrimitive.Chips.Props) {
  return (
    <ComboboxPrimitive.Chips
      data-slot="combobox-chips"
      className={cn(
        // The Input frame. Its text sits 11px in (1px border + 10px); with
        // chips the padding drops to 3px, so 24px chips are inset 3px on
        // every side with a 6px radius (10 − 1 − 3), like the buttons in an
        // Input Group.
        "flex min-h-8 flex-wrap items-center gap-1 rounded-lg border border-input bg-background px-2.5 py-[3px] text-sm shadow-xs transition-[color,border-color,box-shadow] hover:border-[color-mix(in_oklch,var(--input),var(--foreground)_10%)] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30 has-disabled:opacity-50 has-aria-invalid:border-destructive has-aria-invalid:focus-within:ring-destructive/25 has-data-[slot=combobox-chip]:px-[3px] dark:shadow-[0_1px_2px_rgb(0_0_0/0.4)] dark:focus-within:ring-ring/40 dark:has-aria-invalid:focus-within:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxChip({
  className,
  children,
  showRemove = true,
  ...props
}: ComboboxPrimitive.Chip.Props & {
  showRemove?: boolean;
}) {
  return (
    <ComboboxPrimitive.Chip
      data-slot="combobox-chip"
      className={cn(
        // A small secondary Button: the raised gradient, hairline and lift.
        "flex h-6 w-fit items-center justify-center gap-1 rounded-sm border border-input bg-linear-to-b from-background to-secondary px-[7px] text-xs font-medium whitespace-nowrap text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] has-disabled:pointer-events-none has-disabled:cursor-not-allowed has-data-[slot=combobox-chip-remove]:pr-0 dark:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_4%)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.4),inset_0_1px_0_rgb(255_255_255/0.06)]",
        className,
      )}
      {...props}
    >
      {children}
      {showRemove && (
        <ComboboxPrimitive.ChipRemove
          render={<Button variant="ghost" size="icon-xs" />}
          // Fills the chip's inner height (24 − 2), concentric with its
          // corners (6 − 1); the hit area stays 24px through the border.
          className="-ml-1 size-[22px] rounded-[5px] hover:[&_svg]:text-foreground [&_svg:not([class*='size-'])]:size-3"
          data-slot="combobox-chip-remove"
        >
          <XIcon className="pointer-events-none" />
        </ComboboxPrimitive.ChipRemove>
      )}
    </ComboboxPrimitive.Chip>
  );
}

function ComboboxChipsInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-chip-input"
      className={cn(
        "h-6 min-w-16 flex-1 bg-transparent outline-none placeholder:text-muted-foreground not-first:pl-1 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  );
}

function useComboboxAnchor() {
  return React.useRef<HTMLDivElement | null>(null);
}

export {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxAnchor,
};
