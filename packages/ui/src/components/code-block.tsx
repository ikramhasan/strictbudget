"use client";

import { Button } from "@strictbudget/ui/components/button";
import { cn } from "@strictbudget/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { CheckIcon, CopyIcon } from "lucide-react";
import * as React from "react";

// A well sunk into the page, the Kbd's language at panel scale: a soft
// shadow under the top lip and a 1px catch-light under the bottom edge (dark:
// a fill below `background`). The light fill stays `background` so every
// highlighted token keeps 4.5:1. Focus on the code is the Input's ring.
const codeBlockVariants = cva(
  "group/code-block relative flex w-full min-w-0 flex-col overflow-hidden rounded-xl border text-[13px] leading-5 transition-[border-color,box-shadow] has-[>[data-slot=code-block-content]:focus-visible]:border-ring has-[>[data-slot=code-block-content]:focus-visible]:ring-3 has-[>[data-slot=code-block-content]:focus-visible]:ring-ring/30 data-[size=sm]:rounded-lg data-[size=sm]:text-xs data-[size=sm]:leading-[18px] dark:has-[>[data-slot=code-block-content]:focus-visible]:ring-ring/40",
  {
    variants: {
      variant: {
        default:
          "border-border bg-background text-foreground shadow-[inset_0_1px_2px_rgb(0_0_0/0.04),0_1px_0_rgb(255_255_255/0.9)] dark:border-black/40 dark:bg-[color-mix(in_oklch,var(--background),black_18%)] dark:shadow-[inset_0_1px_2px_rgb(0_0_0/0.4),0_1px_0_rgb(255_255_255/0.05)]",
        destructive:
          "border-destructive/30 bg-[color-mix(in_oklch,var(--destructive)_4%,var(--background))] text-[color-mix(in_oklch,var(--destructive),black_12%)] shadow-[inset_0_1px_2px_rgb(0_0_0/0.04),0_1px_0_rgb(255_255_255/0.9)] dark:border-destructive/40 dark:bg-[color-mix(in_oklch,var(--destructive)_8%,var(--background))] dark:text-[color-mix(in_oklch,var(--destructive),white_25%)] dark:shadow-[inset_0_1px_2px_rgb(0_0_0/0.4),0_1px_0_rgb(255_255_255/0.05)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function CodeBlock({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof codeBlockVariants> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="code-block"
      data-variant={variant}
      data-size={size}
      className={cn(codeBlockVariants({ variant }), className)}
      {...props}
    />
  );
}

function CodeBlockHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-header"
      className={cn(
        "flex min-h-5 min-w-0 shrink-0 items-center gap-2 px-3 pt-3 text-muted-foreground group-data-[size=sm]/code-block:min-h-4 group-data-[size=sm]/code-block:px-2.5 group-data-[size=sm]/code-block:pt-2.5 group-data-[variant=destructive]/code-block:text-[color-mix(in_oklch,var(--destructive),black_12%)] dark:group-data-[variant=destructive]/code-block:text-[color-mix(in_oklch,var(--destructive),white_25%)] *:has-[>[data-slot=code-block-title]]:min-w-0",
        className,
      )}
      {...props}
    />
  );
}

function CodeBlockTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-title"
      className={cn(
        "min-w-0 truncate font-sans text-sm leading-5 font-medium text-foreground group-data-[size=sm]/code-block:text-xs group-data-[size=sm]/code-block:leading-4 group-data-[variant=destructive]/code-block:text-inherit [&_svg]:pointer-events-none [&_svg]:inline-block [&_svg]:align-[-2px] group-data-[size=sm]/code-block:[&_svg]:align-[-2.5px] [&_svg]:text-muted-foreground group-data-[variant=destructive]/code-block:[&_svg]:text-inherit [&_svg:not([class*='size-'])]:size-3.5 *:[svg]:me-1.5",
        className,
      )}
      {...props}
    />
  );
}

// In the header the actions sit on the title line. Placed straight in the
// block they float over the top corner, concentric with it (14px radius −
// 1px border − 8px inset = 5px; small: 10 − 1 − 7 = 2px, which also centers
// a 24px button on a one-line block), and show on hover or focus.
function CodeBlockActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-actions"
      className={cn(
        "-my-1 ms-auto -me-1.5 flex shrink-0 items-center gap-1 [[data-slot=code-block]>&]:absolute [[data-slot=code-block]>&]:end-2 [[data-slot=code-block]>&]:top-2 [[data-slot=code-block]>&]:z-10 [[data-slot=code-block]>&]:m-0 [[data-slot=code-block]>&]:opacity-0 [[data-slot=code-block]>&]:transition-opacity [[data-slot=code-block]>&]:duration-150 [[data-slot=code-block]>&]:ease-[cubic-bezier(0.23,1,0.32,1)] [[data-slot=code-block]>&]:group-focus-within/code-block:opacity-100 [[data-slot=code-block]>&]:group-hover/code-block:opacity-100 group-data-[size=sm]/code-block:[[data-slot=code-block]>&]:end-[7px] group-data-[size=sm]/code-block:[[data-slot=code-block]>&]:top-[7px] [[data-slot=code-block]>&]:pointer-coarse:opacity-100 [[data-slot=code-block]>&]:*:[button]:rounded-[5px] [[data-slot=code-block]>&]:*:[button]:border-input [[data-slot=code-block]>&]:*:[button]:bg-background [[data-slot=code-block]>&]:*:[button]:shadow-xs [[data-slot=code-block]>&]:*:[button]:hover:bg-accent group-data-[size=sm]/code-block:[[data-slot=code-block]>&]:*:[button]:rounded-[2px] dark:[[data-slot=code-block]>&]:*:[button]:bg-secondary dark:[[data-slot=code-block]>&]:*:[button]:shadow-[0_1px_2px_rgb(0_0_0/0.4)] dark:[[data-slot=code-block]>&]:*:[button]:hover:bg-accent",
        className,
      )}
      {...props}
    />
  );
}

function CodeBlockCopyButton({
  value,
  variant = "ghost",
  size = "icon-xs",
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button> & { value: string }) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timeout);
  }, [copied]);

  return (
    <>
      <Button
        data-slot="code-block-copy-button"
        data-copied={copied || undefined}
        variant={variant}
        size={size}
        aria-label={copied ? "Copied" : "Copy"}
        className={cn("relative", className)}
        onClick={(event) => {
          onClick?.(event);
          navigator.clipboard
            .writeText(value)
            .then(() => setCopied(true))
            .catch(() => {});
        }}
        {...props}
      >
        {/* The icons cross-fade with a slight scale, so the swap reads as
            one key changing state rather than a jump. */}
        <CopyIcon className="transition-[opacity,scale,filter] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-data-copied/button:scale-50 group-data-copied/button:opacity-0 group-data-copied/button:blur-[2px] motion-reduce:transition-opacity motion-reduce:group-data-copied/button:scale-100 motion-reduce:group-data-copied/button:blur-none" />
        <CheckIcon className="absolute scale-50 opacity-0 blur-[2px] transition-[opacity,scale,filter] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-data-copied/button:scale-100 group-data-copied/button:opacity-100 group-data-copied/button:blur-none motion-reduce:scale-100 motion-reduce:blur-none motion-reduce:transition-opacity" />
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </>
  );
}

function CodeBlockContent({
  className,
  children,
  style,
  wrap = false,
  lineNumbers = false,
  startLine = 1,
  ...props
}: React.ComponentProps<"pre"> & {
  wrap?: boolean;
  lineNumbers?: boolean;
  startLine?: number;
}) {
  return (
    <pre
      data-slot="code-block-content"
      data-wrap={wrap || undefined}
      data-numbered={lineNumbers || undefined}
      dir="ltr"
      tabIndex={0}
      style={{ counterReset: `line ${startLine - 1}`, ...style }}
      className={cn(
        "min-h-0 min-w-0 scroll-fade-x overflow-auto px-3 py-3 text-start font-mono outline-none [scrollbar-color:color-mix(in_oklch,var(--muted-foreground)_50%,transparent)_transparent] [scrollbar-width:thin] group-has-data-[slot=code-block-footer]/code-block:pb-2 group-has-data-[slot=code-block-header]/code-block:pt-2 group-data-[size=sm]/code-block:px-2.5 group-data-[size=sm]/code-block:py-2.5 group-data-[size=sm]/code-block:group-has-data-[slot=code-block-header]/code-block:pt-1.5 data-wrap:scroll-fade-y data-wrap:wrap-break-word data-wrap:whitespace-pre-wrap",
        className,
      )}
      {...props}
    >
      <code
        data-slot="code-block-code"
        className="grid min-h-lh min-w-max content-start in-data-numbered:grid-cols-[auto_1fr] in-data-wrap:min-w-0"
      >
        {lineNumbers && typeof children === "string"
          ? children
              .replace(/\n$/, "")
              .split("\n")
              .map((line, index) => <CodeBlockLine key={index}>{line}</CodeBlockLine>)
          : children}
      </code>
    </pre>
  );
}

// Line tints run edge to edge. Added and highlighted lines take a 5%
// `foreground` wash (visible on the well's fill, where `muted` is not);
// removed lines take the `destructive` tint with a red "−".
const codeBlockLineVariants = cva(
  "relative -mx-3 block min-h-lh px-3 group-data-[size=sm]/code-block:-mx-2.5 group-data-[size=sm]/code-block:px-2.5 before:min-w-6 before:text-end before:text-muted-foreground after:absolute after:start-1 after:top-0 after:text-muted-foreground after:select-none in-data-numbered:col-span-2 in-data-numbered:grid in-data-numbered:grid-cols-subgrid in-data-numbered:gap-x-3 in-data-numbered:[counter-increment:line] in-data-numbered:before:content-[counter(line)] in-data-numbered:before:select-none in-data-numbered:supports-[content:counter(line)_/_'']:before:content-[counter(line)_/_'']",
  {
    variants: {
      variant: {
        default: "",
        added: "bg-foreground/5 after:content-['+']",
        removed:
          "bg-destructive/10 after:text-[color-mix(in_oklch,var(--destructive),black_12%)] after:content-['−'] dark:bg-destructive/15 dark:after:text-[color-mix(in_oklch,var(--destructive),white_25%)]",
        highlighted: "bg-foreground/5",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function CodeBlockLine({
  className,
  variant = "default",
  children,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof codeBlockLineVariants>) {
  // An empty line holds a newline so copying a selection keeps blank lines.
  const empty =
    children === undefined ||
    children === null ||
    children === "" ||
    (Array.isArray(children) && children.length === 0);

  return (
    <span
      data-slot="code-block-line"
      data-variant={variant}
      className={cn(codeBlockLineVariants({ variant }), className)}
      {...props}
    >
      <span data-slot="code-block-line-content" className="min-w-0">
        {empty ? "\n" : children}
      </span>
    </span>
  );
}

function CodeBlockFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-footer"
      className={cn(
        "flex min-w-0 shrink-0 items-center gap-2 px-3 pb-3 text-xs text-muted-foreground group-data-[size=sm]/code-block:px-2.5 group-data-[size=sm]/code-block:pb-2.5",
        className,
      )}
      {...props}
    />
  );
}

export {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFooter,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
};
