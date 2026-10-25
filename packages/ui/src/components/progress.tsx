"use client";

import { cn } from "@strictbudget/ui/lib/utils";
import { Progress as ProgressPrimitive } from "radix-ui";
import * as React from "react";

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        // The Slider groove: 6px, recessed, with a 3:1 inner hairline so the
        // empty part reads. The hairline sits above the fill (::after), so the
        // channel stays inside the groove's lip.
        "relative flex h-1.5 w-full items-center overflow-x-hidden rounded-full bg-linear-to-b from-[color-mix(in_oklch,var(--input),var(--foreground)_12%)] to-input after:pointer-events-none after:absolute after:inset-0 after:rounded-full after:shadow-[inset_0_1px_1.5px_rgb(0_0_0/0.12),inset_0_0_0_1px_color-mix(in_oklch,var(--input),var(--foreground)_48%)] dark:from-[color-mix(in_oklch,var(--input),black_30%)] dark:after:shadow-[inset_0_1px_1.5px_rgb(0_0_0/0.5),inset_0_0_0_1px_color-mix(in_oklch,var(--input),var(--foreground)_35%)]",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        // The Slider's primary channel, rounded at its leading end. It slides
        // on a strong ease-out so each update lands quickly.
        className="size-full flex-1 rounded-full bg-linear-to-b from-[color-mix(in_oklch,var(--primary),black_14%)] to-primary shadow-[inset_0_1px_1.5px_rgb(0_0_0/0.25),inset_0_0_0_1px_color-mix(in_oklch,var(--primary),black_15%)] transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
