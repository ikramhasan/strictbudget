import { cn } from "@strictbudget/ui/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import { Accordion as AccordionPrimitive } from "radix-ui";
import * as React from "react";

function Accordion({ className, ...props }: React.ComponentProps<typeof AccordionPrimitive.Root>) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn("flex w-full flex-col", className)}
      {...props}
    />
  );
}

function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      // Items are divided by the engraved Separator: a hairline with a 1px
      // highlight under it.
      className={cn(
        "not-last:border-b not-last:shadow-[0_1px_0_rgb(255_255_255/0.8)] dark:not-last:border-black/40 dark:not-last:shadow-[0_1px_0_rgb(255_255_255/0.05)]",
        className,
      )}
      {...props}
    />
  );
}

function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          // 40px rows: 20px line + 2 × 10px. The chevron rides a 20px raised
          // chip (the secondary Button, round) on the text line; open, the
          // chip is pressed in (the Toggle's well) and the chevron turns over.
          "group/accordion-trigger relative flex flex-1 items-start justify-between gap-4 rounded-md py-2.5 text-left text-sm font-medium transition-colors outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
        <span
          aria-hidden
          className="pointer-events-none relative isolate ml-auto flex size-5 shrink-0 items-center justify-center rounded-full border border-input bg-linear-to-b from-background to-secondary text-muted-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] transition-[box-shadow,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] before:absolute before:-inset-px before:-z-1 before:rounded-full before:bg-linear-to-b before:from-[color-mix(in_oklch,var(--muted),var(--foreground)_7%)] before:to-muted before:opacity-0 before:shadow-[inset_0_1px_2px_rgb(0_0_0/0.1),inset_0_0_0_1px_rgb(0_0_0/0.05),0_1px_0_rgb(255_255_255/0.9)] before:transition-opacity before:duration-200 before:ease-[cubic-bezier(0.23,1,0.32,1)] group-hover/accordion-trigger:text-foreground group-aria-expanded/accordion-trigger:text-foreground group-aria-expanded/accordion-trigger:shadow-none group-aria-expanded/accordion-trigger:before:opacity-100 dark:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_4%)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.4),inset_0_1px_0_rgb(255_255_255/0.06)] dark:before:from-[color-mix(in_oklch,var(--muted),black_35%)] dark:before:shadow-[inset_0_1px_2px_rgb(0_0_0/0.6),inset_0_0_0_1px_rgb(0_0_0/0.25),0_1px_0_rgb(255_255_255/0.07)]"
        >
          <ChevronDownIcon
            data-slot="accordion-trigger-icon"
            className="size-3.5 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-aria-expanded/accordion-trigger:rotate-180 motion-reduce:transition-none"
          />
        </span>
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      // strictbudget: Radix marks state with data-state (not Base UI's data-open), and its height
      // lives in --radix-accordion-content-height, which tw-animate-css's accordion keyframes read.
      className="overflow-hidden text-sm duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down motion-reduce:animate-none"
      {...props}
    >
      <div
        className={cn(
          "pt-0 pb-2.5 text-muted-foreground [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
          className,
        )}
      >
        {children}
      </div>
    </AccordionPrimitive.Content>
  );
}

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
