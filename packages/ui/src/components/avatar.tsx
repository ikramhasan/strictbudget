"use client";

import { cn } from "@strictbudget/ui/lib/utils";
import { Avatar as AvatarPrimitive } from "radix-ui";
import * as React from "react";

function Avatar({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & {
  size?: "default" | "sm" | "lg";
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        // The outline is drawn above the image, so photos never bleed into
        // the page, like Item image tiles.
        "group/avatar relative flex size-8 shrink-0 rounded-full select-none after:pointer-events-none after:absolute after:inset-0 after:rounded-full after:ring-1 after:ring-black/8 after:ring-inset data-[size=lg]:size-10 data-[size=sm]:size-6 dark:after:ring-white/10",
        className,
      )}
      {...props}
    />
  );
}

function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("aspect-square size-full rounded-full object-cover", className)}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        // The secondary Button's raised skin as a white highlight over the fill,
        // so a plain `bg-*` recolors it. Dark adds a hairline along the top.
        "flex size-full items-center justify-center rounded-full bg-secondary bg-linear-to-b from-white to-transparent text-sm font-medium text-muted-foreground group-data-[size=sm]/avatar:text-xs dark:from-white/6 dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]",
        className,
      )}
      {...props}
    />
  );
}

function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        // The primary Button's lift as a white highlight over the fill, so a plain
        // `bg-*` recolors it. A background ring cuts it out of the avatar.
        "absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary bg-linear-to-b from-white/15 to-transparent text-primary-foreground ring-2 ring-background select-none",
        "group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2",
        "group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2",
        className,
      )}
      {...props}
    />
  );
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background",
        className,
      )}
      {...props}
    />
  );
}

function AvatarGroupCount({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary bg-linear-to-b from-white to-transparent text-sm font-medium text-muted-foreground ring-2 ring-background after:pointer-events-none after:absolute after:inset-0 after:rounded-full after:ring-1 after:ring-black/8 after:ring-inset group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 group-has-data-[size=sm]/avatar-group:text-xs dark:from-white/6 dark:after:ring-white/10 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
        className,
      )}
      {...props}
    />
  );
}

export { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage };
