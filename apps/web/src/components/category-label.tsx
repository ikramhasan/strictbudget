import { cn } from "@strictbudget/ui/lib/utils";
import { splitEmoji } from "./name-popover";

/**
 * A category's name with its leading emoji set apart: a fixed gap, the emoji on a faint chip in
 * dark mode (so dark glyphs like 📱 stay visible) and left out of the accessible name, and the
 * text truncating. Names without a leading emoji render as plain text.
 */
export function CategoryLabel({ name, className }: { name: string; className?: string }) {
  const { emoji, text } = splitEmoji(name);
  return (
    <span
      data-category-label
      className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5", className)}
    >
      {emoji && (
        <span
          aria-hidden
          className="shrink-0 rounded-[4px] px-0.5 py-px leading-none dark:bg-foreground/25"
        >
          {emoji}
        </span>
      )}
      <span className="min-w-0 truncate">{text}</span>
    </span>
  );
}
