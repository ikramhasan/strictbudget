import { cn } from "@strictbudget/ui/lib/utils";
import * as React from "react";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 py-1 text-base shadow-xs transition-[color,border-color,box-shadow] outline-none file:-ml-[7px] file:mr-2.5 file:inline-flex file:align-top file:h-6 file:cursor-pointer file:items-center file:rounded-sm file:border file:border-input file:bg-secondary file:px-2 file:text-[13px] file:font-medium file:text-secondary-foreground file:transition-colors hover:file:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] dark:hover:file:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_8%)] placeholder:text-muted-foreground hover:border-[color-mix(in_oklch,var(--input),var(--foreground)_10%)] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/25 md:text-sm [&[type=file]]:py-[3px] [&[type=file]]:leading-6 dark:shadow-[0_1px_2px_rgb(0_0_0/0.4)] dark:focus-visible:ring-ring/40 dark:aria-invalid:focus-visible:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
