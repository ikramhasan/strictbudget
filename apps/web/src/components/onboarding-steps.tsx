import { cn } from "@strictbudget/ui/lib/utils";
import { Check } from "lucide-react";
import { Fragment } from "react";

/** A new budget's way in: the create form, then setup's four steps. */
export const ONBOARDING_STEPS = ["Budget", "How it works", "Categories", "Account", "Assign"];

/**
 * Where the user is in onboarding. Finished steps can be revisited through `onSelect` (the budget
 * itself, step 0, can't). On a phone only the current step's name shows.
 */
export function OnboardingSteps({
  current,
  onSelect,
}: {
  current: number;
  onSelect?: (index: number) => void;
}) {
  return (
    <nav aria-label="Setup progress">
      <ol className="flex items-center gap-2">
        {ONBOARDING_STEPS.map((label, i) => {
          const done = i < current;
          const active = i === current;
          const canSelect = done && i > 0 && onSelect !== undefined;
          const content = (
            <>
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full font-semibold text-xs tabular-nums transition-colors duration-200",
                  done && "bg-primary text-primary-foreground",
                  active && "bg-primary/10 text-primary-text ring-1 ring-primary",
                  !done && !active && "bg-muted text-muted-foreground ring-1 ring-border",
                )}
              >
                {done ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : i + 1}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-sm",
                  active ? "font-medium text-foreground" : "text-muted-foreground max-md:sr-only",
                )}
              >
                {label}
                {done && <span className="sr-only"> (done)</span>}
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
