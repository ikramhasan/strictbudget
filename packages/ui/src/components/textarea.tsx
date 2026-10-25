import { cn } from "@strictbudget/ui/lib/utils";
import * as React from "react";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-15 w-full resize-y rounded-lg border border-input bg-background px-2.5 py-1.5 text-base shadow-xs transition-[color,border-color,box-shadow] outline-none placeholder:text-muted-foreground hover:border-[color-mix(in_oklch,var(--input),var(--foreground)_10%)] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/25 md:text-sm dark:shadow-[0_1px_2px_rgb(0_0_0/0.4)] dark:focus-visible:ring-ring/40 dark:aria-invalid:focus-visible:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
