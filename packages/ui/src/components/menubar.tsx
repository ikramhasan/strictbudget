"use client";

import { cn } from "@strictbudget/ui/lib/utils";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { Menubar as MenubarPrimitive } from "radix-ui";
import * as React from "react";

function Menubar({ className, ...props }: React.ComponentProps<typeof MenubarPrimitive.Root>) {
  return (
    <MenubarPrimitive.Root
      data-slot="menubar"
      className={cn(
        // A raised strip (the secondary Button skin), 32px: 1px border + 3px
        // padding leave 24px triggers, rounded 6px (10 − 4, concentric).
        "flex h-8 items-center gap-0.5 rounded-lg border border-input bg-linear-to-b from-background to-secondary p-[3px] shadow-[0_1px_2px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] dark:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_4%)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.4),inset_0_1px_0_rgb(255_255_255/0.06)]",
        className,
      )}
      {...props}
    />
  );
}

function MenubarMenu({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Menu>) {
  return <MenubarPrimitive.Menu data-slot="menubar-menu" {...props} />;
}

function MenubarGroup({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Group>) {
  return <MenubarPrimitive.Group data-slot="menubar-group" {...props} />;
}

function MenubarPortal({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Portal>) {
  return <MenubarPrimitive.Portal data-slot="menubar-portal" {...props} />;
}

function MenubarRadioGroup({ ...props }: React.ComponentProps<typeof MenubarPrimitive.RadioGroup>) {
  return <MenubarPrimitive.RadioGroup data-slot="menubar-radio-group" {...props} />;
}

function MenubarTrigger({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Trigger>) {
  return (
    <MenubarPrimitive.Trigger
      data-slot="menubar-trigger"
      className={cn(
        // Hover is a flat fill; the open menu's trigger is pressed into the
        // strip (the Toggle's recessed well, fading in on ::before).
        "relative isolate flex h-6 items-center rounded-[calc(var(--radius-lg)-4px)] px-2 text-sm font-medium outline-hidden transition-colors duration-150 select-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset aria-expanded:bg-transparent aria-expanded:before:opacity-100 before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:bg-linear-to-b before:from-[color-mix(in_oklch,var(--muted),var(--foreground)_7%)] before:to-muted before:opacity-0 before:shadow-[inset_0_1px_2px_rgb(0_0_0/0.1),inset_0_0_0_1px_rgb(0_0_0/0.05)] before:transition-opacity before:duration-150 before:ease-[cubic-bezier(0.23,1,0.32,1)] dark:before:from-[color-mix(in_oklch,var(--muted),black_35%)] dark:before:shadow-[inset_0_1px_2px_rgb(0_0_0/0.6),inset_0_0_0_1px_rgb(0_0_0/0.25)]",
        className,
      )}
      {...props}
    />
  );
}

function MenubarContent({
  className,
  align = "start",
  alignOffset = -4,
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Content>) {
  return (
    <MenubarPortal>
      <MenubarPrimitive.Content
        data-slot="menubar-content"
        align={align}
        alignOffset={alignOffset}
        sideOffset={sideOffset}
        className={cn(
          // The Dropdown Menu shell. alignOffset −4 (1px border + 3px padding)
          // lines the first menu up with the strip's edge; sideOffset 8 from the
          // trigger opens it 4px below the strip.
          "z-50 max-h-(--radix-menubar-content-available-height) w-auto min-w-36 origin-(--radix-menubar-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-xl bg-muted p-1 text-sm text-popover-foreground shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_rgb(0_0_0/0.1),inset_0_1px_0_rgb(255_255_255/0.7)] ring-1 ring-border outline-none dark:bg-[color-mix(in_oklch,var(--popover),black_20%)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_8px_24px_rgb(0_0_0/0.5),inset_0_1px_0_rgb(255_255_255/0.04)] [scrollbar-color:color-mix(in_oklch,var(--muted-foreground),transparent_50%)_transparent] [scrollbar-width:thin] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-96 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-96 data-[state=closed]:duration-100 motion-reduce:data-[state=open]:zoom-in-100 motion-reduce:data-[state=closed]:zoom-out-100",
          className,
        )}
        {...props}
      />
    </MenubarPortal>
  );
}

function MenubarItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Item> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <MenubarPrimitive.Item
      data-slot="menubar-item"
      data-inset={inset || undefined}
      data-variant={variant}
      className={cn(
        // 32px rows: 20px line + 2 × 6px. Inset = 8px padding + 16px icon +
        // 8px gap, so inset text lines up with text after an icon.
        "group/menubar-item relative flex min-h-8 cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-hidden select-none focus:bg-linear-to-b focus:from-background focus:to-[color-mix(in_oklch,var(--background),var(--secondary)_60%)] focus:text-accent-foreground focus:shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] dark:focus:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_7%)] dark:focus:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_3%)] dark:focus:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.05),inset_0_1px_0_rgb(255_255_255/0.06)] not-data-[variant=destructive]:focus:[&_svg:not([class*='text-'])]:text-foreground data-inset:pl-8 data-[variant=destructive]:text-[color-mix(in_oklch,var(--destructive),black_12%)] data-[variant=destructive]:focus:from-[color-mix(in_oklch,var(--background),var(--destructive)_4%)] data-[variant=destructive]:focus:to-[color-mix(in_oklch,var(--background),var(--destructive)_9%)] data-[variant=destructive]:focus:shadow-[0_1px_2px_rgb(160_30_30/0.12),0_0_0_1px_color-mix(in_oklch,var(--destructive),transparent_80%),inset_0_-1px_0_rgb(0_0_0/0.03)] dark:data-[variant=destructive]:text-[color-mix(in_oklch,var(--destructive),white_25%)] dark:data-[variant=destructive]:focus:from-[color-mix(in_oklch,var(--secondary),var(--destructive)_16%)] dark:data-[variant=destructive]:focus:to-[color-mix(in_oklch,var(--secondary),var(--destructive)_11%)] dark:data-[variant=destructive]:focus:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_0_0_1px_color-mix(in_oklch,var(--destructive),transparent_75%),inset_0_1px_0_rgb(255_255_255/0.06)] data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground data-[variant=destructive]:[&_svg:not([class*='text-'])]:text-current",
        className,
      )}
      {...props}
    />
  );
}

function MenubarCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.CheckboxItem> & {
  inset?: boolean;
}) {
  return (
    <MenubarPrimitive.CheckboxItem
      data-slot="menubar-checkbox-item"
      data-inset={inset || undefined}
      className={cn(
        // The Dropdown Menu row with the check on the left, 8px in: text at
        // 32px (8 + 16 + 8), level with inset items.
        "relative flex min-h-8 cursor-default items-center gap-2 rounded-lg py-1.5 pr-2 pl-8 text-sm outline-hidden select-none focus:bg-linear-to-b focus:from-background focus:to-[color-mix(in_oklch,var(--background),var(--secondary)_60%)] focus:text-accent-foreground focus:shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] dark:focus:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_7%)] dark:focus:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_3%)] dark:focus:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.05),inset_0_1px_0_rgb(255_255_255/0.06)] not-data-[variant=destructive]:focus:[&_svg:not([class*='text-'])]:text-foreground data-inset:pl-8 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-4 items-center justify-center">
        <MenubarPrimitive.ItemIndicator
          forceMount
          // The tick draws itself, like Checkbox.
          className="flex [&_path]:transition-[stroke-dashoffset] [&_path]:duration-200 [&_path]:ease-[cubic-bezier(0.23,1,0.32,1)] [&_path]:[stroke-dasharray:24] data-[state=checked]:[&_path]:[stroke-dashoffset:0] data-[state=unchecked]:[&_path]:duration-100 data-[state=unchecked]:[&_path]:[stroke-dashoffset:-24] motion-reduce:[&_path]:transition-none"
        >
          <CheckIcon className="stroke-[2.5] text-primary dark:text-[color-mix(in_oklch,var(--primary),white_35%)]" />
        </MenubarPrimitive.ItemIndicator>
      </span>
      {children}
    </MenubarPrimitive.CheckboxItem>
  );
}

function MenubarRadioItem({
  className,
  children,
  inset,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.RadioItem> & {
  inset?: boolean;
}) {
  return (
    <MenubarPrimitive.RadioItem
      data-slot="menubar-radio-item"
      data-inset={inset || undefined}
      className={cn(
        // The Dropdown Menu row with the check on the left, 8px in: text at
        // 32px (8 + 16 + 8), level with inset items.
        "relative flex min-h-8 cursor-default items-center gap-2 rounded-lg py-1.5 pr-2 pl-8 text-sm outline-hidden select-none focus:bg-linear-to-b focus:from-background focus:to-[color-mix(in_oklch,var(--background),var(--secondary)_60%)] focus:text-accent-foreground focus:shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] dark:focus:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_7%)] dark:focus:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_3%)] dark:focus:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.05),inset_0_1px_0_rgb(255_255_255/0.06)] not-data-[variant=destructive]:focus:[&_svg:not([class*='text-'])]:text-foreground data-inset:pl-8 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-4 items-center justify-center">
        <MenubarPrimitive.ItemIndicator
          forceMount
          // The tick draws itself, like Checkbox.
          className="flex [&_path]:transition-[stroke-dashoffset] [&_path]:duration-200 [&_path]:ease-[cubic-bezier(0.23,1,0.32,1)] [&_path]:[stroke-dasharray:24] data-[state=checked]:[&_path]:[stroke-dashoffset:0] data-[state=unchecked]:[&_path]:duration-100 data-[state=unchecked]:[&_path]:[stroke-dashoffset:-24] motion-reduce:[&_path]:transition-none"
        >
          <CheckIcon className="stroke-[2.5] text-primary dark:text-[color-mix(in_oklch,var(--primary),white_35%)]" />
        </MenubarPrimitive.ItemIndicator>
      </span>
      {children}
    </MenubarPrimitive.RadioItem>
  );
}

function MenubarLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Label> & {
  inset?: boolean;
}) {
  return (
    <MenubarPrimitive.Label
      data-slot="menubar-label"
      data-inset={inset || undefined}
      className={cn(
        "px-2 py-1.5 text-xs font-medium text-muted-foreground data-inset:pl-8",
        className,
      )}
      {...props}
    />
  );
}

function MenubarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Separator>) {
  return (
    <MenubarPrimitive.Separator
      data-slot="menubar-separator"
      // Engraved into the shell: a hairline with a highlight under it.
      className={cn(
        "-mx-1 my-1 h-px bg-border shadow-[0_1px_0_rgb(255_255_255/0.8)] dark:bg-black/40 dark:shadow-[0_1px_0_rgb(255_255_255/0.05)]",
        className,
      )}
      {...props}
    />
  );
}

function MenubarShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="menubar-shortcut"
      className={cn(
        // A recessed keycap (the Kbd recipe), 20px on the 20px text line.
        "ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-linear-to-b from-[color-mix(in_oklch,var(--muted),var(--foreground)_7%)] to-muted px-1 text-xs font-medium tracking-widest text-muted-foreground shadow-[inset_0_1px_1.5px_rgb(0_0_0/0.12),inset_0_0_0_1px_rgb(0_0_0/0.05),0_1px_0_rgb(255_255_255/0.9)] dark:from-[color-mix(in_oklch,var(--muted),black_35%)] dark:shadow-[inset_0_1px_1.5px_rgb(0_0_0/0.6),inset_0_0_0_1px_rgb(0_0_0/0.25),0_1px_0_rgb(255_255_255/0.07)]",
        className,
      )}
      {...props}
    />
  );
}

function MenubarSub({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Sub>) {
  return <MenubarPrimitive.Sub data-slot="menubar-sub" {...props} />;
}

function MenubarSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.SubTrigger> & {
  inset?: boolean;
}) {
  return (
    <MenubarPrimitive.SubTrigger
      data-slot="menubar-sub-trigger"
      data-inset={inset || undefined}
      className={cn(
        "flex min-h-8 cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-hidden select-none focus:bg-linear-to-b focus:from-background focus:to-[color-mix(in_oklch,var(--background),var(--secondary)_60%)] focus:text-accent-foreground focus:shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] dark:focus:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_7%)] dark:focus:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_3%)] dark:focus:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.05),inset_0_1px_0_rgb(255_255_255/0.06)] not-data-[variant=destructive]:focus:[&_svg:not([class*='text-'])]:text-foreground data-inset:pl-8 data-[state=open]:bg-linear-to-b data-[state=open]:from-background data-[state=open]:to-[color-mix(in_oklch,var(--background),var(--secondary)_60%)] data-[state=open]:text-accent-foreground data-[state=open]:shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] dark:data-[state=open]:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_7%)] dark:data-[state=open]:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_3%)] dark:data-[state=open]:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.05),inset_0_1px_0_rgb(255_255_255/0.06)] data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </MenubarPrimitive.SubTrigger>
  );
}

function MenubarSubContent({
  className,
  alignOffset = -4,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.SubContent>) {
  return (
    <MenubarPrimitive.SubContent
      data-slot="menubar-sub-content"
      // alignOffset −4 = −padding (the ring is a shadow, not a border): the
      // first sub item lines up with its trigger.
      alignOffset={alignOffset}
      className={cn(
        "z-50 max-h-(--radix-menubar-content-available-height) w-auto min-w-32 origin-(--radix-menubar-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-xl bg-muted p-1 text-sm text-popover-foreground shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_rgb(0_0_0/0.1),inset_0_1px_0_rgb(255_255_255/0.7)] ring-1 ring-border outline-none dark:bg-[color-mix(in_oklch,var(--popover),black_20%)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_8px_24px_rgb(0_0_0/0.5),inset_0_1px_0_rgb(255_255_255/0.04)] [scrollbar-color:color-mix(in_oklch,var(--muted-foreground),transparent_50%)_transparent] [scrollbar-width:thin] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-96 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-96 data-[state=closed]:duration-100 motion-reduce:data-[state=open]:zoom-in-100 motion-reduce:data-[state=closed]:zoom-out-100",
        className,
      )}
      {...props}
    />
  );
}

export {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarPortal,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
};
