import { cn } from "@strictbudget/ui/lib/utils";
import { splitEmoji } from "./name-popover";

/**
 * A category's name with its leading emoji set apart: a fixed gap, the emoji in full colour (in
 * dark mode with a faint light halo, so dark glyphs like 📱 keep their edge without greying the
 * rest) and left out of the accessible name, and the text truncating. Names without a leading
 * emoji render as plain text.
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
          className="shrink-0 leading-none dark:[filter:drop-shadow(0_0_0.5px_rgb(255_255_255/0.7))_drop-shadow(0_0_1.5px_rgb(255_255_255/0.25))]"
        >
          {emoji}
        </span>
      )}
      <span className="min-w-0 truncate">{text}</span>
    </span>
  );
}
