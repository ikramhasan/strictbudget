import { cn } from "@strictbudget/ui/lib/utils";
import { Check, Minus } from "lucide-react";
import { Fragment } from "react";

/** A new budget's way in: the create form, then setup's four steps. */
export const ONBOARDING_STEPS = ["Budget", "How it works", "Categories", "Account", "Assign"];

/**
 * Where the user is in onboarding. Steps before `current` are done, or `skipped` (a hollow
 * marker with a dash, labelled so); both can be revisited through `onSelect`. On a phone only the
 * current step's name shows.
 */
export function OnboardingSteps({
  current,
  skipped = [],
  onSelect,
}: {
  current: number;
  skipped?: readonly number[];
  onSelect?: (index: number) => void;
}) {
  return (
    <nav aria-label="Setup progress">
      <ol className="flex items-center gap-2">
        {ONBOARDING_STEPS.map((label, i) => {
          const past = i < current;
          const wasSkipped = past && skipped.includes(i);
          const done = past && !wasSkipped;
          const active = i === current;
          const canSelect = past && onSelect !== undefined;
          const content = (
            <>
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full font-semibold text-xs tabular-nums transition-colors duration-200",
                  done && "bg-primary text-primary-foreground",
                  wasSkipped && "border border-primary border-dashed text-primary-text",
                  active && "bg-primary/10 text-primary-text ring-1 ring-primary",
                  !past && !active && "bg-muted text-muted-foreground ring-1 ring-border",
                )}
              >
                {done ? (
                  <Check className="size-3.5" strokeWidth={3} aria-hidden />
                ) : wasSkipped ? (
                  <Minus className="size-3.5" strokeWidth={3} aria-hidden />
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-sm",
                  active ? "font-medium text-foreground" : "text-muted-foreground max-md:sr-only",
                )}
              >
                {label}
                {done && <span className="sr-only"> (done)</span>}
                {wasSkipped && <span className="text-muted-foreground/80"> · skipped</span>}
              </span>
            </>
          );
          return (
            <Fragment key={label}>
              {i > 0 && (
                <li
                  aria-hidden
                  className={cn(
                    "h-px min-w-3 flex-1 transition-colors duration-200",
                    i <= current ? "bg-primary" : "bg-border",
                  )}
                />
              )}
              <li aria-current={active ? "step" : undefined} className="flex items-center">
                {canSelect ? (
                  <button
                    type="button"
                    onClick={() => onSelect(i)}
                    className="-m-1 flex items-center gap-2 rounded-md p-1 outline-none hover:[&>span:last-child]:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {content}
                  </button>
                ) : (
                  <span className="flex items-center gap-2">{content}</span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
