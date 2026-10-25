"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import { InputGroup, InputGroupAddon } from "@strictbudget/ui/components/input-group";
import { cn } from "@strictbudget/ui/lib/utils";
import { Command as CommandPrimitive } from "cmdk";
import { CheckIcon, SearchIcon } from "lucide-react";
import * as React from "react";

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        // The Dropdown Menu's muted shell: 14px radius, 6px padding, so the
        // field and the rows inside it are 8px (14 − 6).
        "flex size-full flex-col overflow-hidden rounded-xl bg-muted p-1.5 text-sm text-popover-foreground dark:bg-[color-mix(in_oklch,var(--popover),black_20%)]",
        className,
      )}
      {...props}
    />
  );
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = false,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string;
  description?: string;
  className?: string;
  showCloseButton?: boolean;
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        // The Command is the whole surface here, at its own 14px radius.
        className={cn("top-1/3 translate-y-0 overflow-hidden rounded-xl p-0", className)}
        showCloseButton={showCloseButton}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div data-slot="command-input-wrapper" className="pb-1.5">
      {/* The query is typed into the surface: the Kbd's recessed well. It
          always holds focus while the palette is open, so it has no ring.
          The icon sits 8px in, on the same column as the row icons. */}
      <InputGroup className="h-8 rounded-md border-0 bg-linear-to-b from-[color-mix(in_oklch,var(--muted),var(--foreground)_7%)] to-muted shadow-[inset_0_1px_2px_rgb(0_0_0/0.1),inset_0_0_0_1px_rgb(0_0_0/0.05),0_1px_0_rgb(255_255_255/0.9)] dark:from-[color-mix(in_oklch,var(--muted),black_35%)] dark:shadow-[inset_0_1px_2px_rgb(0_0_0/0.6),inset_0_0_0_1px_rgb(0_0_0/0.25),0_1px_0_rgb(255_255_255/0.07)] *:data-[slot=input-group-addon]:pl-2!">
        <CommandPrimitive.Input
          data-slot="command-input"
          className={cn(
            "w-full bg-transparent text-sm caret-primary outline-hidden placeholder:text-[color-mix(in_oklch,var(--muted-foreground),var(--foreground)_20%)] disabled:cursor-not-allowed disabled:opacity-50 dark:placeholder:text-muted-foreground",
            className,
          )}
          {...props}
        />
        <InputGroupAddon>
          <SearchIcon className="size-4 shrink-0" />
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        // A scroller clips at its padding edge, so the list reaches out over
        // the shell's padding to leave room for the raised row's hairline and
        // shadow at the sides and bottom.
        "no-scrollbar -mx-1.5 -mb-1.5 max-h-[calc(--spacing(72)+--spacing(1.5))] scroll-py-1.5 overflow-x-hidden overflow-y-auto px-1.5 pb-1.5 outline-none",
        className,
      )}
      {...props}
    />
  );
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      // cmdk counts items in effects, so server HTML always shows the empty
      // state and the page shifts once it hydrates. Hide it while real items
      // follow it; cmdk only renders it with none, so behavior is unchanged.
      className={cn(
        "py-6 text-center text-sm text-muted-foreground has-[~[cmdk-group]_[cmdk-item]]:hidden has-[~[cmdk-item]]:hidden",
        className,
      )}
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "text-foreground **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      // Engraved into the shell, like the Dropdown Menu separator.
      className={cn(
        "-mx-1.5 my-1.5 h-px bg-border shadow-[0_1px_0_rgb(255_255_255/0.8)] dark:bg-black/40 dark:shadow-[0_1px_0_rgb(255_255_255/0.05)]",
        className,
      )}
      {...props}
    />
  );
}

function CommandItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        // strictbudget: cmdk writes data-selected="false" on the other rows, so the
        // highlight keys on data-[selected=true], not the bare data-selected.
        // The Dropdown Menu row: 32px, and the highlighted row lifts out of the
        // shell as a raised key. A press sinks it back (the Button's press).
        // Highlight is instant: it follows the arrow keys tens of times a day.
        "group/command-item relative flex min-h-8 cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-linear-to-b data-[selected=true]:from-background data-[selected=true]:to-[color-mix(in_oklch,var(--background),var(--secondary)_60%)] data-[selected=true]:text-foreground data-[selected=true]:shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] data-[selected=true]:active:translate-y-[0.5px] data-[selected=true]:active:shadow-[0_0_0_1px_rgb(0_0_0/0.06)] motion-reduce:data-[selected=true]:active:translate-y-0 dark:data-[selected=true]:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_7%)] dark:data-[selected=true]:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_3%)] dark:data-[selected=true]:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.05),inset_0_1px_0_rgb(255_255_255/0.06)] dark:data-[selected=true]:active:shadow-[0_0_0_1px_rgb(255_255_255/0.05)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground data-[selected=true]:[&_svg:not([class*='text-'])]:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
      {/* The tick draws itself, like Checkbox. */}
      <CheckIcon className="ml-auto stroke-[2.5] text-primary group-has-data-[slot=command-shortcut]/command-item:hidden dark:text-[color-mix(in_oklch,var(--primary),white_35%)] [&_path]:transition-[stroke-dashoffset] [&_path]:duration-100 [&_path]:ease-[cubic-bezier(0.23,1,0.32,1)] [&_path]:[stroke-dasharray:24] [&_path]:[stroke-dashoffset:-24] group-data-[checked=true]/command-item:[&_path]:[stroke-dashoffset:0] group-data-[checked=true]/command-item:[&_path]:duration-200 motion-reduce:[&_path]:transition-none" />
    </CommandPrimitive.Item>
  );
}

function CommandShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        // A recessed keycap (the Kbd recipe), 20px on the 20px text line.
        "ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-linear-to-b from-[color-mix(in_oklch,var(--muted),var(--foreground)_7%)] to-muted px-1 text-xs font-medium tracking-widest text-muted-foreground shadow-[inset_0_1px_1.5px_rgb(0_0_0/0.12),inset_0_0_0_1px_rgb(0_0_0/0.05),0_1px_0_rgb(255_255_255/0.9)] group-data-[selected=true]/command-item:text-foreground dark:from-[color-mix(in_oklch,var(--muted),black_35%)] dark:shadow-[inset_0_1px_1.5px_rgb(0_0_0/0.6),inset_0_0_0_1px_rgb(0_0_0/0.25),0_1px_0_rgb(255_255_255/0.07)]",
        className,
      )}
      {...props}
    />
  );
}

// strictbudget: cmdk's own ranking, for a palette that filters its items itself.
export { defaultFilter } from "cmdk";

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
};
