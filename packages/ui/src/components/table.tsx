import { cn } from "@strictbudget/ui/lib/utils";
import * as React from "react";

// strictbudget: `containerRef`/`containerClassName` let the container be the scroll element (for
// virtualized rows and a sticky header).
function Table({
  className,
  containerRef,
  containerClassName,
  ...props
}: React.ComponentProps<"table"> & {
  containerRef?: React.Ref<HTMLDivElement>;
  containerClassName?: string;
}) {
  return (
    <div
      ref={containerRef}
      data-slot="table-container"
      className={cn(
        "relative w-full overflow-x-auto rounded-xl bg-muted px-[5px] pb-[5px] ring-1 ring-border not-has-[>table>thead]:pt-[5px] dark:bg-[color-mix(in_oklch,var(--background),black_20%)]",
        containerClassName,
      )}
    >
      <table
        data-slot="table"
        className={cn(
          "isolate w-full caption-bottom border-separate border-spacing-0 text-sm tabular-nums",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={className} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn(
        "relative before:pointer-events-none before:absolute before:-inset-px before:-z-1 before:rounded-[10px] before:border before:border-border before:bg-background before:shadow-[0_1px_2px_rgb(0_0_0/0.04)] dark:before:shadow-[0_1px_2px_rgb(0_0_0/0.4)] [&>tr:first-child>:first-child]:rounded-tl-[9px] [&>tr:first-child>:last-child]:rounded-tr-[9px] [&>tr:last-child>:first-child]:rounded-bl-[9px] [&>tr:last-child>:last-child]:rounded-br-[9px]",
        className,
      )}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "font-medium [&_td]:h-auto [&_td]:pt-[11px] [&_td]:pb-[5px] [&_th]:pt-[11px] [&_th]:pb-[5px]",
        className,
      )}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "*:transition-colors in-data-[slot=table-body]:not-last:*:border-b in-data-[slot=table-body]:hover:*:bg-muted in-data-[slot=table-body]:has-aria-expanded:*:bg-muted data-[state=selected]:*:bg-[color-mix(in_oklch,var(--primary)_6%,var(--background))] dark:data-[state=selected]:*:bg-[color-mix(in_oklch,var(--primary)_14%,var(--background))] data-[state=selected]:hover:*:bg-[color-mix(in_oklch,var(--primary)_9%,var(--background))] dark:data-[state=selected]:hover:*:bg-[color-mix(in_oklch,var(--primary)_18%,var(--background))]",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "px-3 pt-2.5 pb-[11px] text-left align-middle text-[13px] leading-4 font-medium whitespace-nowrap text-muted-foreground [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "h-10 border-border px-3 py-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("pt-[11px] pb-[5px] text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };
