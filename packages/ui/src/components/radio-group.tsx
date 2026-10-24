import { cn } from "@strictbudget/ui/lib/utils";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import * as React from "react";

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid w-full gap-2", className)}
      {...props}
    />
  );
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  // strictbudget: Radix marks state with data-state, not the data-checked attribute these classes
  // were written for, so the checked variants use data-[state=checked] (as checkbox.tsx).
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        // Same skins as Checkbox: raised secondary when off, the default
        // button fading in on ::before when on.
        "group/radio-group-item peer relative flex aspect-square size-4 shrink-0 rounded-full border border-[color-mix(in_oklch,var(--input),var(--foreground)_48%)] bg-linear-to-b from-background to-secondary shadow-[0_1px_2px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] transition-[border-color,box-shadow,scale] duration-150 ease-out outline-none group-has-[:focus-visible]/field-label:ring-0 before:absolute before:-inset-px before:rounded-full before:bg-linear-to-b before:from-[color-mix(in_oklch,var(--primary),white_15%)] before:to-primary before:opacity-0 before:shadow-[inset_0_1px_0_rgb(255_255_255/0.22)] before:transition-opacity before:duration-150 before:ease-out after:absolute after:-inset-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:active:scale-100 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:border-[color-mix(in_oklch,var(--input),var(--foreground)_35%)] dark:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_4%)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.4),inset_0_1px_0_rgb(255_255_255/0.06)] dark:aria-invalid:ring-destructive/40 data-[state=checked]:border-[color-mix(in_oklch,var(--primary),black_15%)] data-[state=checked]:shadow-[0_1px_2px_rgb(30_60_160/0.28)] data-[state=checked]:before:opacity-100 dark:data-[state=checked]:shadow-[0_1px_2px_rgb(0_0_0/0.45)]",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        forceMount
        className="relative flex size-full items-center justify-center data-[state=unchecked]:*:scale-50 data-[state=unchecked]:*:opacity-0 data-[state=unchecked]:*:duration-100 motion-reduce:*:scale-100"
      >
        {/* The dot grows in from half size; it never starts from nothing. */}
        <span className="size-1.5 rounded-full bg-primary-foreground shadow-[0_1px_1px_rgb(0_0_0/0.15)] transition-[scale,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-opacity" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

export { RadioGroup, RadioGroupItem };
