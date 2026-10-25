"use client";

import { cn } from "@strictbudget/ui/lib/utils";
import { Slider as SliderPrimitive } from "radix-ui";
import * as React from "react";

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const _values = React.useMemo(
    () => (Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max]),
    [value, defaultValue, min, max],
  );

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-horizontal:h-4 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-4 data-vertical:flex-col",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        // A recessed groove (the Switch track): darker under the lip, an
        // inner shadow and a 3:1 inner hairline so the empty part reads.
        className="relative grow overflow-hidden rounded-full bg-linear-to-b from-[color-mix(in_oklch,var(--input),var(--foreground)_12%)] to-input shadow-[inset_0_1px_1.5px_rgb(0_0_0/0.12),inset_0_0_0_1px_color-mix(in_oklch,var(--input),var(--foreground)_48%)] select-none data-horizontal:h-1.5 data-horizontal:w-full data-vertical:h-full data-vertical:w-1.5 data-vertical:bg-linear-to-r dark:from-[color-mix(in_oklch,var(--input),black_30%)] dark:shadow-[inset_0_1px_1.5px_rgb(0_0_0/0.5),inset_0_0_0_1px_color-mix(in_oklch,var(--input),var(--foreground)_35%)]"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          // The Switch's checked channel: primary, filled into the groove.
          className="absolute bg-linear-to-b from-[color-mix(in_oklch,var(--primary),black_14%)] to-primary shadow-[inset_0_1px_1.5px_rgb(0_0_0/0.25),inset_0_0_0_1px_color-mix(in_oklch,var(--primary),black_15%)] select-none data-horizontal:h-full data-vertical:w-full data-vertical:bg-linear-to-r"
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          // The Switch thumb: raised white, 16px over the 6px groove, with a
          // 40px hit area.
          className="relative block size-4 shrink-0 rounded-full bg-linear-to-b from-white to-[color-mix(in_oklch,white,black_5%)] shadow-[0_1px_2px_rgb(0_0_0/0.2),0_0_0_0.5px_rgb(0_0_0/0.12),inset_0_-1px_0_rgb(0_0_0/0.04)] transition-[box-shadow,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] select-none after:absolute after:-inset-3 hover:shadow-[0_1px_3px_rgb(0_0_0/0.25),0_0_0_0.5px_rgb(0_0_0/0.16),inset_0_-1px_0_rgb(0_0_0/0.04)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-hidden active:scale-95 data-disabled:pointer-events-none motion-reduce:active:scale-100 dark:shadow-[0_1px_2px_rgb(0_0_0/0.6),0_0_0_0.5px_rgb(0_0_0/0.4),inset_0_-1px_0_rgb(0_0_0/0.04)]"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
