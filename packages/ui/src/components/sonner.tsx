"use client";

import { buttonVariants } from "@strictbudget/ui/components/button";
import { useTheme } from "@strictbudget/ui/lib/theme";
import { cn } from "@strictbudget/ui/lib/utils";
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ toastOptions, ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const classNames = toastOptions?.classNames;

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        unstyled: true,
        ...toastOptions,
        classNames: {
          ...classNames,
          // The Dialog's frame on its side: a muted shell holding the message
          // on a raised card, with the buttons on the shell to its right.
          // The card is a ::before spanning the icon and content columns.
          toast: cn(
            "group/toast grid w-(--width) grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] rounded-xl bg-muted p-1 font-sans text-sm text-popover-foreground shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_rgb(0_0_0/0.1),inset_0_1px_0_rgb(255_255_255/0.7)] ring-1 ring-border outline-none before:absolute before:inset-0 before:-z-1 before:col-[1/3] before:row-[1/2] before:rounded-[10px] before:border before:border-border before:bg-popover before:shadow-[0_1px_2px_rgb(0_0_0/0.04)] focus-visible:ring-2 focus-visible:ring-ring data-[expanded=false]:data-[front=false]:*:opacity-0 dark:bg-[color-mix(in_oklch,var(--popover),black_20%)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_8px_24px_rgb(0_0_0/0.5),inset_0_1px_0_rgb(255_255_255/0.04)] dark:before:shadow-[0_1px_2px_rgb(0_0_0/0.4)]",
            classNames?.toast,
          ),
          icon: cn(
            "relative col-start-1 row-start-1 my-2.5 ml-2.5 flex size-6 items-center justify-center self-start rounded-md bg-muted text-muted-foreground group-data-[type=error]/toast:bg-destructive/10 group-data-[type=error]/toast:text-[color-mix(in_oklch,var(--destructive),black_12%)] group-data-[type=success]/toast:bg-success/15 group-data-[type=success]/toast:text-success dark:group-data-[type=error]/toast:bg-destructive/20 dark:group-data-[type=error]/toast:text-[color-mix(in_oklch,var(--destructive),white_25%)] [&>svg]:size-4",
            classNames?.icon,
          ),
          content: cn(
            "col-start-2 row-start-1 m-3 flex min-w-0 flex-col gap-0.5 self-center group-has-data-icon/toast:ml-2.5",
            classNames?.content,
          ),
          title: cn("leading-5 font-medium", classNames?.title),
          description: cn("leading-5 text-muted-foreground", classNames?.description),
          cancelButton: cn(
            buttonVariants({ variant: "secondary" }),
            "col-start-3 row-start-1 ml-1 h-auto focus-visible:ring-offset-0",
            classNames?.cancelButton,
          ),
          actionButton: cn(
            buttonVariants(),
            "col-start-4 row-start-1 ml-1 h-auto focus-visible:ring-offset-0",
            classNames?.actionButton,
          ),
          closeButton: cn(
            buttonVariants({ variant: "secondary", size: "icon" }),
            "col-start-5 row-start-1 ml-1 h-auto w-11 focus-visible:ring-offset-0 [&_svg]:size-4",
            classNames?.closeButton,
          ),
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
