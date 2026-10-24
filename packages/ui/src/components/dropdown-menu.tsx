import { cn } from "@strictbudget/ui/lib/utils";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import * as React from "react";

function DropdownMenu({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  className,
  align = "start",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        align={align}
        className={cn(
          // The Dialog's muted shell: 14px radius, 4px padding, so items are
          // 10px (14 − 4); the highlighted row lifts out of it as a raised
          // card. Scales from the trigger.
          "z-50 max-h-(--radix-dropdown-menu-content-available-height) w-(--radix-dropdown-menu-trigger-width) min-w-32 origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-xl bg-muted p-1 text-sm text-popover-foreground shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_rgb(0_0_0/0.1),inset_0_1px_0_rgb(255_255_255/0.7)] ring-1 ring-border outline-none dark:bg-[color-mix(in_oklch,var(--popover),black_20%)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_8px_24px_rgb(0_0_0/0.5),inset_0_1px_0_rgb(255_255_255/0.04)] [scrollbar-color:color-mix(in_oklch,var(--muted-foreground),transparent_50%)_transparent] [scrollbar-width:thin] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-96 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-96 data-[state=closed]:duration-100 motion-reduce:data-[state=open]:zoom-in-100 motion-reduce:data-[state=closed]:zoom-out-100 data-[state=closed]:overflow-hidden",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuGroup({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset || undefined}
      data-variant={variant}
      className={cn(
        // 32px rows: 20px line + 2 × 6px. Inset = 8px padding + 16px icon +
        // 8px gap, so inset text lines up with text after an icon.
        "group/dropdown-menu-item relative flex min-h-8 cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-hidden select-none focus:bg-linear-to-b focus:from-background focus:to-[color-mix(in_oklch,var(--background),var(--secondary)_60%)] focus:text-accent-foreground focus:shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] dark:focus:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_7%)] dark:focus:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_3%)] dark:focus:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.05),inset_0_1px_0_rgb(255_255_255/0.06)] not-data-[variant=destructive]:focus:[&_svg:not([class*='text-'])]:text-foreground data-inset:pl-8 data-[variant=destructive]:text-[color-mix(in_oklch,var(--destructive),black_12%)] data-[variant=destructive]:focus:from-[color-mix(in_oklch,var(--background),var(--destructive)_4%)] data-[variant=destructive]:focus:to-[color-mix(in_oklch,var(--background),var(--destructive)_9%)] data-[variant=destructive]:focus:shadow-[0_1px_2px_rgb(160_30_30/0.12),0_0_0_1px_color-mix(in_oklch,var(--destructive),transparent_80%),inset_0_-1px_0_rgb(0_0_0/0.03)] dark:data-[variant=destructive]:text-[color-mix(in_oklch,var(--destructive),white_25%)] dark:data-[variant=destructive]:focus:from-[color-mix(in_oklch,var(--secondary),var(--destructive)_16%)] dark:data-[variant=destructive]:focus:to-[color-mix(in_oklch,var(--secondary),var(--destructive)_11%)] dark:data-[variant=destructive]:focus:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_0_0_1px_color-mix(in_oklch,var(--destructive),transparent_75%),inset_0_1px_0_rgb(255_255_255/0.06)] data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground data-[variant=destructive]:[&_svg:not([class*='text-'])]:text-current",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset || undefined}
      className={cn(
        "relative flex min-h-8 cursor-default items-center gap-2 rounded-lg py-1.5 pr-8 pl-2 text-sm outline-hidden select-none focus:bg-linear-to-b focus:from-background focus:to-[color-mix(in_oklch,var(--background),var(--secondary)_60%)] focus:text-accent-foreground focus:shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] dark:focus:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_7%)] dark:focus:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_3%)] dark:focus:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.05),inset_0_1px_0_rgb(255_255_255/0.06)] not-data-[variant=destructive]:focus:[&_svg:not([class*='text-'])]:text-foreground data-inset:pl-8 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <DropdownMenuPrimitive.ItemIndicator
          forceMount
          // The tick draws itself, like Checkbox.
          className="flex [&_path]:transition-[stroke-dashoffset] [&_path]:duration-200 [&_path]:ease-[cubic-bezier(0.23,1,0.32,1)] [&_path]:[stroke-dasharray:24] data-[state=checked]:[&_path]:[stroke-dashoffset:0] data-[state=unchecked]:[&_path]:duration-100 data-[state=unchecked]:[&_path]:[stroke-dashoffset:-24] motion-reduce:[&_path]:transition-none"
        >
          <CheckIcon className="stroke-[2.5] text-primary dark:text-[color-mix(in_oklch,var(--primary),white_35%)]" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset || undefined}
      className={cn(
        "relative flex min-h-8 cursor-default items-center gap-2 rounded-lg py-1.5 pr-8 pl-2 text-sm outline-hidden select-none focus:bg-linear-to-b focus:from-background focus:to-[color-mix(in_oklch,var(--background),var(--secondary)_60%)] focus:text-accent-foreground focus:shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] dark:focus:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_7%)] dark:focus:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_3%)] dark:focus:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.05),inset_0_1px_0_rgb(255_255_255/0.06)] not-data-[variant=destructive]:focus:[&_svg:not([class*='text-'])]:text-foreground data-inset:pl-8 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <DropdownMenuPrimitive.ItemIndicator
          forceMount
          // The tick draws itself, like Checkbox.
          className="flex [&_path]:transition-[stroke-dashoffset] [&_path]:duration-200 [&_path]:ease-[cubic-bezier(0.23,1,0.32,1)] [&_path]:[stroke-dasharray:24] data-[state=checked]:[&_path]:[stroke-dashoffset:0] data-[state=unchecked]:[&_path]:duration-100 data-[state=unchecked]:[&_path]:[stroke-dashoffset:-24] motion-reduce:[&_path]:transition-none"
        >
          <CheckIcon className="stroke-[2.5] text-primary dark:text-[color-mix(in_oklch,var(--primary),white_35%)]" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset || undefined}
      className={cn(
        "px-2 py-1.5 text-xs font-medium text-muted-foreground data-inset:pl-8",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      // Engraved into the shell: a hairline with a highlight under it.
      className={cn(
        "-mx-1 my-1 h-px bg-border shadow-[0_1px_0_rgb(255_255_255/0.8)] dark:bg-black/40 dark:shadow-[0_1px_0_rgb(255_255_255/0.05)]",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        // A recessed keycap (the Kbd recipe), 20px on the 20px text line.
        "ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-linear-to-b from-[color-mix(in_oklch,var(--muted),var(--foreground)_7%)] to-muted px-1 text-xs font-medium tracking-widest text-muted-foreground shadow-[inset_0_1px_1.5px_rgb(0_0_0/0.12),inset_0_0_0_1px_rgb(0_0_0/0.05),0_1px_0_rgb(255_255_255/0.9)] dark:from-[color-mix(in_oklch,var(--muted),black_35%)] dark:shadow-[inset_0_1px_1.5px_rgb(0_0_0/0.6),inset_0_0_0_1px_rgb(0_0_0/0.25),0_1px_0_rgb(255_255_255/0.07)]",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSub({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset || undefined}
      className={cn(
        "flex min-h-8 cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-hidden select-none focus:bg-linear-to-b focus:from-background focus:to-[color-mix(in_oklch,var(--background),var(--secondary)_60%)] focus:text-accent-foreground focus:shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] dark:focus:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_7%)] dark:focus:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_3%)] dark:focus:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.05),inset_0_1px_0_rgb(255_255_255/0.06)] not-data-[variant=destructive]:focus:[&_svg:not([class*='text-'])]:text-foreground data-inset:pl-8 data-[state=open]:bg-linear-to-b data-[state=open]:from-background data-[state=open]:to-[color-mix(in_oklch,var(--background),var(--secondary)_60%)] data-[state=open]:text-accent-foreground data-[state=open]:shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] dark:data-[state=open]:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_7%)] dark:data-[state=open]:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_3%)] dark:data-[state=open]:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.05),inset_0_1px_0_rgb(255_255_255/0.06)] data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

function DropdownMenuSubContent({
  className,
  alignOffset = -4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      // alignOffset −4 = −padding (the ring is a shadow, not a border): the
      // first sub item lines up with its trigger.
      alignOffset={alignOffset}
      className={cn(
        "z-50 max-h-(--radix-dropdown-menu-content-available-height) w-auto min-w-24 origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-xl bg-muted p-1 text-sm text-popover-foreground shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_rgb(0_0_0/0.1),inset_0_1px_0_rgb(255_255_255/0.7)] ring-1 ring-border outline-none dark:bg-[color-mix(in_oklch,var(--popover),black_20%)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_8px_24px_rgb(0_0_0/0.5),inset_0_1px_0_rgb(255_255_255/0.04)] [scrollbar-color:color-mix(in_oklch,var(--muted-foreground),transparent_50%)_transparent] [scrollbar-width:thin] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-96 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-96 data-[state=closed]:duration-100 motion-reduce:data-[state=open]:zoom-in-100 motion-reduce:data-[state=closed]:zoom-out-100",
        className,
      )}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
};
