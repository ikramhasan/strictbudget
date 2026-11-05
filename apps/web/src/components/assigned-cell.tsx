import { Input } from "@strictbudget/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@strictbudget/ui/components/popover";
import { cn } from "@strictbudget/ui/lib/utils";
import { Calculator, Divide, Minus, Plus, X } from "lucide-react";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const OPERATORS = [
  { operator: "+", label: "Plus", Icon: Plus },
  { operator: "-", label: "Minus", Icon: Minus },
  { operator: "*", label: "Multiply", Icon: X },
  { operator: "/", label: "Divide", Icon: Divide },
] as const;

/**
 * The expression to evaluate for typed text. Typing over the amount with a leading operator works
 * on what's assigned now ("+80" adds 80, "*2" doubles it; "-20" takes 20 off a positive amount);
 * text that still starts with the opening amount ("120.00+30"), or anything else, stands as typed.
 */
export function withCurrent(typed: string, opening: string, current: bigint): string {
  const start = opening.trim();
  if (start !== "" && typed.startsWith(start)) return typed;
  if (/^[+*/]/.test(typed) || (typed.startsWith("-") && current > 0n)) return `${start}${typed}`;
  return typed;
}

export interface AssignActions {
  /** Reads typed text (math allowed, e.g. "200+50") into minor units, or explains why not. */
  parse: (text: string) => bigint | string;
  toInput: (amount: string) => string;
  assign: (categoryId: string, amount: bigint) => Promise<void>;
}

/**
 * A category's Assigned amount, edited in place: click to type a new amount (math works), Enter
 * or clicking away saves, Esc cancels.
 */
export function AssignedCell({
  categoryId,
  categoryName,
  amount,
  format,
  actions,
  className,
  startEditing = false,
  onStartedEditing,
}: {
  categoryId: string;
  categoryName: string;
  amount: string;
  format: (minorUnits: string) => string;
  actions: AssignActions;
  className?: string;
  /** Opens in edit mode (once), as "Copy and go to my plan" leaves it. */
  startEditing?: boolean;
  /** Told when `startEditing` has been used, so a later remount doesn't open it again. */
  onStartedEditing?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [calculator, setCalculator] = useState(false);
  /** What's wrong with the typed amount, after Enter: the input stays open to fix it. */
  const [invalid, setInvalid] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** After Enter, the keyboard stays on this cell (Tab already moves on to the next one). */
  const refocus = (via: "enter" | "blur") => {
    if (via === "enter") requestAnimationFrame(() => buttonRef.current?.focus());
  };
  // Enter commits and unmounts the input; the blur that follows must not commit again.
  const done = useRef(false);
  /** The amount the input opened with, to tell what the user actually typed. */
  const initial = useRef("");

  function start() {
    done.current = false;
    setInvalid(null);
    initial.current = actions.toInput(amount);
    setText(initial.current);
    setEditing(true);
  }

  // A cell already open (the user may be typing in it) is never reset by a second request, e.g.
  // when a refetch re-renders the row mid-entry.
  const editingNow = useRef(false);
  editingNow.current = editing;
  useEffect(() => {
    if (!startEditing) return;
    if (!editingNow.current) start();
    onStartedEditing?.();
  }, [startEditing]);

  async function commit(via: "enter" | "blur") {
    if (done.current) return;
    const typed = text.trim();
    if (typed === initial.current.trim()) {
      // Opened and left without a change: nothing to save.
      done.current = true;
      setEditing(false);
      refocus(via);
      return;
    }
    const parsed = actions.parse(withCurrent(typed, initial.current, BigInt(amount)));
    if (typeof parsed === "string" && via === "enter") {
      // Stay put with the reason beside it, rather than throwing the typing away.
      setInvalid(parsed);
      inputRef.current?.select();
      return;
    }
    done.current = true;
    setEditing(false);
    refocus(via);
    if (typeof parsed === "string") {
      toast.error(parsed);
      return;
    }
    if (parsed !== BigInt(amount)) await actions.assign(categoryId, parsed);
  }

  /** The calculator: an operator goes on the end of the amount, the cursor after it. */
  function addOperator(operator: string) {
    setText((t) => t + operator);
    setCalculator(false);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }
  // Clicking the calculator keeps the focus in the input, so it doesn't save on blur.
  const keepFocus = (e: MouseEvent) => e.preventDefault();

  if (editing) {
    // An expression longer than the column grows leftward over the name, in full view. The
    // calculator sits inside the box that grows, so it stays at the input's own left edge.
    const wide = text.length > 10;
    return (
      <div className="relative h-7">
        <div
          className={cn("h-7", wide ? "absolute right-0 z-10 text-base md:text-sm" : "relative")}
          style={wide ? { width: `calc(${text.length}ch + 3rem)` } : undefined}
        >
          <Input
            ref={inputRef}
            aria-label={`Assigned to ${categoryName}`}
            autoFocus
            inputMode="decimal"
            value={text}
            aria-invalid={invalid !== null || undefined}
            aria-describedby={invalid ? `${categoryId}-assigned-error` : undefined}
            title={invalid ?? undefined}
            onChange={(e) => {
              setText(e.target.value);
              setInvalid(null);
            }}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => void commit("blur")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commit("enter");
              } else if (e.key === "Escape") {
                e.preventDefault();
                done.current = true;
                setEditing(false);
              }
            }}
            className={cn("h-7 pl-6 text-right tabular-nums", wide && "shadow-md", className)}
          />
          <Popover open={calculator} onOpenChange={setCalculator}>
            <PopoverTrigger asChild>
              <button
                type="button"
                tabIndex={-1}
                aria-label="Open calculator"
                title="Open calculator"
                onMouseDown={keepFocus}
                className="absolute top-1/2 left-1 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground"
              >
                <Calculator className="size-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="grid w-auto grid-cols-2 gap-1 p-1.5"
              onOpenAutoFocus={(e) => e.preventDefault()}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              {OPERATORS.map(({ operator, label, Icon }) => (
                <button
                  key={operator}
                  type="button"
                  aria-label={label}
                  onMouseDown={keepFocus}
                  onClick={() => addOperator(operator)}
                  className="grid size-7 place-items-center rounded-md border text-primary-text hover:bg-muted"
                >
                  <Icon className="size-3.5" />
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>
        {invalid && (
          <p
            id={`${categoryId}-assigned-error`}
            role="alert"
            className="absolute top-full right-0 z-20 mt-1 w-max max-w-56 rounded-md bg-destructive px-2 py-1 text-white text-xs shadow-md"
          >
            {invalid}
          </p>
        )}
      </div>
    );
  }
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={`Assigned to ${categoryName}: ${format(amount)}`}
      onClick={start}
      className={cn(
        "h-7 w-full truncate rounded-md px-2 text-right text-sm tabular-nums outline-none hover:ring-1 hover:ring-input focus-visible:ring-2 focus-visible:ring-ring",
        // Taking money back out of a category is unusual enough to stand out.
        amount.startsWith("-") && "text-destructive",
        className,
      )}
    >
      {format(amount)}
    </button>
  );
}
