// strictbudget: Frimousse's shadcn registry item (https://frimousse.liveblocks.io/r/emoji-picker),
// restyled to match our Command palette: a muted shell, the query typed into a recessed well,
// and the active emoji lifted out as a raised key. Data comes from our own origin
// (`EMOJIBASE_URL`), not a CDN.
import { InputGroup, InputGroupAddon } from "@strictbudget/ui/components/input-group";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { EMOJIBASE_URL } from "@strictbudget/ui/lib/emoji";
import { cn } from "@strictbudget/ui/lib/utils";
import {
  type EmojiPickerListCategoryHeaderProps,
  type EmojiPickerListEmojiProps,
  type EmojiPickerListRowProps,
  EmojiPicker as EmojiPickerPrimitive,
} from "frimousse";
import { SearchIcon } from "lucide-react";
import type * as React from "react";

function EmojiPicker({
  className,
  ...props
}: React.ComponentProps<typeof EmojiPickerPrimitive.Root>) {
  return (
    <EmojiPickerPrimitive.Root
      data-slot="emoji-picker"
      emojibaseUrl={EMOJIBASE_URL}
      className={cn(
        "isolate flex h-full w-fit flex-col overflow-hidden rounded-xl bg-muted p-1.5 text-sm text-popover-foreground dark:bg-[color-mix(in_oklch,var(--popover),black_20%)]",
        className,
      )}
      {...props}
    />
  );
}

function EmojiPickerSearch({
  className,
  ...props
}: React.ComponentProps<typeof EmojiPickerPrimitive.Search>) {
  return (
    <div data-slot="emoji-picker-search-wrapper" className="pb-1.5">
      {/* The Command palette's recessed well. */}
      <InputGroup className="h-8 rounded-md border-0 bg-linear-to-b from-[color-mix(in_oklch,var(--muted),var(--foreground)_7%)] to-muted shadow-[inset_0_1px_2px_rgb(0_0_0/0.1),inset_0_0_0_1px_rgb(0_0_0/0.05),0_1px_0_rgb(255_255_255/0.9)] dark:from-[color-mix(in_oklch,var(--muted),black_35%)] dark:shadow-[inset_0_1px_2px_rgb(0_0_0/0.6),inset_0_0_0_1px_rgb(0_0_0/0.25),0_1px_0_rgb(255_255_255/0.07)] *:data-[slot=input-group-addon]:pl-2!">
        <EmojiPickerPrimitive.Search
          data-slot="emoji-picker-search"
          // 16px on phones so iOS doesn't zoom into the field.
          className={cn(
            "w-full bg-transparent text-base caret-primary outline-hidden [&::-webkit-search-cancel-button]:appearance-none placeholder:text-[color-mix(in_oklch,var(--muted-foreground),var(--foreground)_20%)] md:text-sm dark:placeholder:text-muted-foreground",
            className,
          )}
          {...props}
        />
        <InputGroupAddon>
          <SearchIcon className="size-4 shrink-0" />
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

function EmojiPickerRow({ children, ...props }: EmojiPickerListRowProps) {
  return (
    <div {...props} data-slot="emoji-picker-row" className="scroll-my-1.5">
      {children}
    </div>
  );
}

function EmojiPickerEmoji({ emoji, className, ...props }: EmojiPickerListEmojiProps) {
  return (
    <button
      {...props}
      data-slot="emoji-picker-emoji"
      className={cn(
        // The Command row's raised key, at emoji size.
        "flex size-8 items-center justify-center rounded-md text-lg leading-none data-active:bg-linear-to-b data-active:from-background data-active:to-[color-mix(in_oklch,var(--background),var(--secondary)_60%)] data-active:shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] data-active:active:translate-y-[0.5px] motion-reduce:data-active:active:translate-y-0 dark:data-active:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_7%)] dark:data-active:to-[color-mix(in_oklch,var(--secondary),var(--foreground)_3%)] dark:data-active:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.05),inset_0_1px_0_rgb(255_255_255/0.06)]",
        className,
      )}
    >
      {emoji.emoji}
    </button>
  );
}

function EmojiPickerCategoryHeader({ category, ...props }: EmojiPickerListCategoryHeaderProps) {
  return (
    <div
      {...props}
      data-slot="emoji-picker-category-header"
      className="bg-muted px-1 pt-2 pb-1.5 font-medium text-muted-foreground text-xs leading-none dark:bg-[color-mix(in_oklch,var(--popover),black_20%)]"
    >
      {category.label}
    </div>
  );
}

function EmojiPickerContent({
  className,
  ...props
}: React.ComponentProps<typeof EmojiPickerPrimitive.Viewport>) {
  return (
    <EmojiPickerPrimitive.Viewport
      data-slot="emoji-picker-viewport"
      className={cn("no-scrollbar relative flex-1 outline-hidden", className)}
      {...props}
    >
      <EmojiPickerPrimitive.Loading
        data-slot="emoji-picker-loading"
        className="absolute inset-0 flex items-center justify-center text-muted-foreground"
      >
        <Spinner />
      </EmojiPickerPrimitive.Loading>
      <EmojiPickerPrimitive.Empty
        data-slot="emoji-picker-empty"
        className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm"
      >
        No emoji found.
      </EmojiPickerPrimitive.Empty>
      <EmojiPickerPrimitive.List
        data-slot="emoji-picker-list"
        className="select-none"
        components={{
          Row: EmojiPickerRow,
          Emoji: EmojiPickerEmoji,
          CategoryHeader: EmojiPickerCategoryHeader,
        }}
      />
    </EmojiPickerPrimitive.Viewport>
  );
}

function EmojiPickerFooter({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="emoji-picker-footer"
      className={cn(
        "flex w-full max-w-(--frimousse-viewport-width) min-w-0 items-center gap-1.5 pt-1.5",
        className,
      )}
      {...props}
    >
      <EmojiPickerPrimitive.ActiveEmoji>
        {({ emoji }) =>
          emoji ? (
            <>
              <span className="flex size-7 flex-none items-center justify-center text-lg leading-none">
                {emoji.emoji}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
                {emoji.label}
              </span>
            </>
          ) : (
            <span className="flex h-7 min-w-0 flex-1 items-center truncate px-1 text-muted-foreground text-xs">
              Pick an emoji…
            </span>
          )
        }
      </EmojiPickerPrimitive.ActiveEmoji>
      {children}
    </div>
  );
}

export { EmojiPicker, EmojiPickerContent, EmojiPickerFooter, EmojiPickerSearch };
