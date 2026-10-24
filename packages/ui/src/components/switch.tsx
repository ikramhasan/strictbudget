"use client";

import { cn } from "@strictbudget/ui/lib/utils";
import { Switch as SwitchPrimitive } from "radix-ui";
import * as React from "react";

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default";
}) {
  // strictbudget: Radix marks state with data-state, not the data-checked/data-unchecked attributes
  // these classes were written for, so the variants below use data-[state=…].
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        // Recessed track (the Kbd recipe): darker top, an inner shadow under
        // the lip and a 3:1 inner hairline so the off state reads as a
        // control. The checked channel fades in on ::before, in step with the
        // thumb (gradients can't transition, opacity can).
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full bg-linear-to-b from-[color-mix(in_oklch,var(--input),var(--foreground)_12%)] to-input p-0.5 shadow-[inset_0_1px_2px_rgb(0_0_0/0.12),inset_0_0_0_1px_color-mix(in_oklch,var(--input),var(--foreground)_48%)] transition-[box-shadow,scale] duration-150 ease-out outline-none group-has-[:focus-visible]/field-label:ring-0",
        "before:absolute before:inset-0 before:rounded-full before:bg-linear-to-b before:from-[color-mix(in_oklch,var(--primary),black_14%)] before:to-primary before:opacity-0 before:shadow-[inset_0_1px_2px_rgb(0_0_0/0.25),inset_0_0_0_1px_color-mix(in_oklch,var(--primary),black_15%)] before:transition-opacity before:duration-200 before:ease-[cubic-bezier(0.23,1,0.32,1)] data-[state=checked]:before:opacity-100",
        "after:absolute after:-inset-x-3 after:-inset-y-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95 motion-reduce:active:scale-100 aria-invalid:ring-2 aria-invalid:ring-destructive/40 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        "data-[size=default]:h-[18px] data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6",
        "dark:from-[color-mix(in_oklch,var(--input),black_30%)] dark:shadow-[inset_0_1px_2px_rgb(0_0_0/0.5),inset_0_0_0_1px_color-mix(in_oklch,var(--input),var(--foreground)_35%)]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        // Raised thumb (the secondary button, in white), sliding on a strong
        // ease-out so the toggle answers immediately.
        className="pointer-events-none relative block rounded-full bg-linear-to-b from-white to-[color-mix(in_oklch,white,black_5%)] shadow-[0_1px_2px_rgb(0_0_0/0.2),0_0_0_0.5px_rgb(0_0_0/0.08),inset_0_-1px_0_rgb(0_0_0/0.04)] transition-[translate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-data-[size=default]/switch:size-3.5 group-data-[size=sm]/switch:size-2.5 data-[state=unchecked]:translate-x-0 group-data-[size=default]/switch:data-[state=checked]:translate-x-3.5 group-data-[size=sm]/switch:data-[state=checked]:translate-x-2.5 motion-reduce:transition-none"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
