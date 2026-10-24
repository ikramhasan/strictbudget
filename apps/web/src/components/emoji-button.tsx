import { Button } from "@strictbudget/ui/components/button";
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerFooter,
  EmojiPickerSearch,
} from "@strictbudget/ui/components/emoji-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@strictbudget/ui/components/popover";
import { cn } from "@strictbudget/ui/lib/utils";
import { SmilePlus } from "lucide-react";
import { useState } from "react";

/**
 * The square box in front of a name field: shows the chosen emoji (or a placeholder icon) and
 * opens a searchable picker. `onClose` runs once the picker has closed, so the caller can put
 * focus back in its name field.
 */
export function EmojiButton({
  value,
  onChange,
  onClose,
  className,
}: {
  value: string;
  onChange: (emoji: string) => void;
  onClose?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  function pick(emoji: string) {
    onChange(emoji);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={value ? `Emoji: ${value}. Change emoji` : "Add an emoji"}
          className={cn(
            // The Input's box, square, so the two read as one field.
            "flex size-8 shrink-0 items-center justify-center rounded-lg border border-input bg-background text-lg leading-none shadow-xs outline-none transition-[color,border-color,box-shadow] hover:border-[color-mix(in_oklch,var(--input),var(--foreground)_10%)] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 data-[state=open]:border-ring dark:shadow-[0_1px_2px_rgb(0_0_0/0.4)] dark:focus-visible:ring-ring/40",
            className,
          )}
        >
          {value || <SmilePlus className="size-4 text-muted-foreground" />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={16}
        className="w-auto p-0"
        onCloseAutoFocus={(event) => {
          if (!onClose) return;
          event.preventDefault();
          onClose();
        }}
      >
        <EmojiPicker
          columns={8}
          // At least 16rem, so Radix flips it above the box rather than squashing it on a phone.
          className="h-[clamp(16rem,calc(var(--radix-popover-content-available-height)-1rem),22rem)]"
          onEmojiSelect={({ emoji }) => pick(emoji)}
        >
          <EmojiPickerSearch placeholder="Search emoji" aria-label="Search emoji" />
          <EmojiPickerContent />
          <EmojiPickerFooter>
            {value && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="shrink-0"
                onClick={() => pick("")}
              >
                Remove
              </Button>
            )}
          </EmojiPickerFooter>
        </EmojiPicker>
      </PopoverContent>
    </Popover>
  );
}
