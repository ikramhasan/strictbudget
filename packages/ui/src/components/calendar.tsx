"use client";

import { Button, buttonVariants } from "@strictbudget/ui/components/button";
import { cn } from "@strictbudget/ui/lib/utils";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import * as React from "react";
import { type DayButton, DayPicker, getDefaultClassNames, type Locale } from "react-day-picker";

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  locale,
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const defaultClassNames = getDefaultClassNames();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        // 6px padding with 8px cells: concentric inside a 14px popover.
        "group/calendar bg-background p-1.5 [--cell-radius:var(--radius-md)] [--cell-size:--spacing(8)] in-data-[slot=card-content]:bg-transparent in-data-[slot=popover-content]:bg-transparent",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className,
      )}
      captionLayout={captionLayout}
      locale={locale}
      formatters={{
        formatMonthDropdown: (date) => date.toLocaleString(locale?.code, { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn("relative flex flex-col gap-4 md:flex-row", defaultClassNames.months),
        month: cn("flex w-full flex-col gap-3", defaultClassNames.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaultClassNames.nav,
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) rounded-(--cell-radius) p-0 select-none aria-disabled:opacity-40",
          defaultClassNames.button_previous,
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) rounded-(--cell-radius) p-0 select-none aria-disabled:opacity-40",
          defaultClassNames.button_next,
        ),
        month_caption: cn(
          "flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)",
          defaultClassNames.month_caption,
        ),
        dropdowns: cn(
          "flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-sm font-medium",
          defaultClassNames.dropdowns,
        ),
        // The native select is invisible over its label; focus shows on the
        // label's frame, the Button's ring.
        dropdown_root: cn(
          "group/dropdown relative rounded-(--cell-radius) has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-background",
          defaultClassNames.dropdown_root,
        ),
        dropdown: cn(
          "absolute inset-0 cursor-pointer bg-popover opacity-0",
          defaultClassNames.dropdown,
        ),
        caption_label: cn(
          "font-medium select-none",
          captionLayout === "label"
            ? "text-sm"
            : // A small secondary key, like the Select trigger.
              "flex h-7 items-center gap-1 rounded-(--cell-radius) border border-input bg-linear-to-b from-background to-secondary pr-1.5 pl-2.5 text-sm text-secondary-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] group-hover/dropdown:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] dark:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_4%)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.4),inset_0_1px_0_rgb(255_255_255/0.06)] dark:group-hover/dropdown:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_8%)] [&>svg]:size-3.5 [&>svg]:text-muted-foreground",
          defaultClassNames.caption_label,
        ),
        month_grid: cn("w-full border-collapse", defaultClassNames.month_grid),
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "flex-1 text-xs leading-4 font-medium text-muted-foreground select-none",
          defaultClassNames.weekday,
        ),
        week: cn("mt-1 flex w-full first:mt-2", defaultClassNames.week),
        week_number_header: cn("w-(--cell-size) select-none", defaultClassNames.week_number_header),
        week_number: cn(
          "text-xs text-muted-foreground tabular-nums select-none",
          defaultClassNames.week_number,
        ),
        // A range is a groove sunk into the surface (the Slider's track)
        // running between its two keys: the cell's ::before, 2px shorter than
        // the key above and below, with unblurred shadows so neighbouring
        // cells join without a seam. A one-day range has no groove.
        day: cn(
          "group/day relative isolate aspect-square h-full w-full rounded-(--cell-radius) p-0 text-center select-none before:pointer-events-none before:absolute before:inset-y-0.5 before:hidden before:bg-linear-to-b before:from-[color-mix(in_oklch,var(--muted),var(--foreground)_7%)] before:to-muted before:shadow-[inset_0_1px_0_rgb(0_0_0/0.06),0_1px_0_rgb(255_255_255/0.9)] has-data-[range-end=true]:before:block has-data-[range-end=true]:before:right-1/2 has-data-[range-end=true]:before:left-0 has-data-[range-middle=true]:before:block has-data-[range-middle=true]:before:inset-x-0 has-data-[range-start=true]:before:block has-data-[range-start=true]:before:right-0 has-data-[range-start=true]:before:left-1/2 has-data-[range-start=true]:has-data-[range-end=true]:before:hidden last:before:rounded-r-(--cell-radius) dark:before:from-[color-mix(in_oklch,var(--muted),black_35%)] dark:before:shadow-[inset_0_1px_0_rgb(0_0_0/0.35),0_1px_0_rgb(255_255_255/0.07)]",
          props.showWeekNumber
            ? "[&:nth-child(2)]:before:rounded-l-(--cell-radius)"
            : "first:before:rounded-l-(--cell-radius)",
          defaultClassNames.day,
        ),
        range_start: cn(defaultClassNames.range_start),
        range_middle: cn(defaultClassNames.range_middle),
        range_end: cn(defaultClassNames.range_end),
        // Today is a recessed well (the Kbd); a selected day covers it.
        today: cn(
          "not-data-selected:bg-linear-to-b not-data-selected:from-[color-mix(in_oklch,var(--muted),var(--foreground)_7%)] not-data-selected:to-muted not-data-selected:shadow-[inset_0_1px_1.5px_rgb(0_0_0/0.12),inset_0_0_0_1px_rgb(0_0_0/0.05),0_1px_0_rgb(255_255_255/0.9)] dark:not-data-selected:from-[color-mix(in_oklch,var(--muted),black_35%)] dark:not-data-selected:shadow-[inset_0_1px_1.5px_rgb(0_0_0/0.6),inset_0_0_0_1px_rgb(0_0_0/0.25),0_1px_0_rgb(255_255_255/0.07)]",
          defaultClassNames.today,
        ),
        outside: cn(
          // On the range groove, muted text is lifted 20% to keep 4.5:1 in light.
          "text-muted-foreground aria-selected:text-[color-mix(in_oklch,var(--muted-foreground),var(--foreground)_20%)] dark:aria-selected:text-muted-foreground",
          defaultClassNames.outside,
        ),
        disabled: cn("text-muted-foreground opacity-50", defaultClassNames.disabled),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return <div data-slot="calendar" ref={rootRef} className={cn(className)} {...props} />;
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return <ChevronLeftIcon className={cn("size-4", className)} {...props} />;
          }

          if (orientation === "right") {
            return <ChevronRightIcon className={cn("size-4", className)} {...props} />;
          }

          return <ChevronDownIcon className={cn("size-4", className)} {...props} />;
        },
        DayButton: ({ ...props }) => <CalendarDayButton locale={locale} {...props} />,
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div className="flex size-(--cell-size) items-center justify-center text-center">
                {children}
              </div>
            </td>
          );
        },
        ...components,
      }}
      {...props}
    />
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  locale,
  ...props
}: React.ComponentProps<typeof DayButton> & { locale?: Partial<Locale> }) {
  const defaultClassNames = getDefaultClassNames();

  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString(locale?.code)}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        // Every day is a key. Hover lifts a white key out of the surface (the
        // secondary Button skin, on ::before); a selected day, or either end
        // of a range, is the blue default Button skin, popping in from 0.9 on
        // ::after. Gradients can't transition, so both skins cross-fade.
        // strictbudget: the press overrides the Button's own scale-[0.97] (same variant)
        // rather than base-nova's translate-y-px.
        "relative isolate z-10 flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 rounded-(--cell-radius) border-0 leading-none font-normal tabular-nums transition-[color,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-transparent focus-visible:z-20 focus-visible:ring-offset-0 active:not-aria-[haspopup]:scale-95 disabled:opacity-100 aria-expanded:bg-transparent motion-reduce:active:scale-100 dark:hover:bg-transparent dark:hover:text-foreground",
        "before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:border before:border-input before:bg-linear-to-b before:from-background before:to-secondary before:opacity-0 before:shadow-[0_1px_2px_rgb(0_0_0/0.08),inset_0_-1px_0_rgb(0_0_0/0.03)] before:transition-opacity before:duration-150 before:ease-[cubic-bezier(0.23,1,0.32,1)] hover:before:opacity-100 dark:before:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)] dark:before:shadow-[0_1px_2px_rgb(0_0_0/0.4),inset_0_1px_0_rgb(255_255_255/0.06)]",
        "after:absolute after:inset-0 after:-z-1 after:scale-90 after:rounded-[inherit] after:border after:border-[color-mix(in_oklch,var(--primary),black_15%)] after:bg-linear-to-b after:from-[color-mix(in_oklch,var(--primary),white_15%)] after:to-primary after:opacity-0 after:shadow-[0_1px_2px_rgb(30_60_160/0.28),inset_0_1px_0_rgb(255_255_255/0.22)] after:transition-[opacity,scale,filter] after:duration-150 after:ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:after:scale-100 dark:after:shadow-[0_1px_2px_rgb(0_0_0/0.45),inset_0_1px_0_rgb(255_255_255/0.22)]",
        "data-[range-end=true]:text-primary-foreground data-[range-end=true]:after:scale-100 data-[range-end=true]:after:opacity-100 data-[range-end=true]:hover:after:brightness-106 data-[range-middle=true]:text-foreground data-[range-start=true]:text-primary-foreground data-[range-start=true]:after:scale-100 data-[range-start=true]:after:opacity-100 data-[range-start=true]:hover:after:brightness-106 data-[selected-single=true]:text-primary-foreground data-[selected-single=true]:after:scale-100 data-[selected-single=true]:after:opacity-100 data-[selected-single=true]:hover:after:brightness-106 dark:data-[range-end=true]:hover:text-primary-foreground dark:data-[range-start=true]:hover:text-primary-foreground dark:data-[selected-single=true]:hover:text-primary-foreground [&>span]:text-xs [&>span]:opacity-70",
        defaultClassNames.day,
        className,
      )}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
