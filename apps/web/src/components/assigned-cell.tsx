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
  const inputRef = useRef<HTMLInputElement>(null);
  // Enter commits and unmounts the input; the blur that follows must not commit again.
  const done = useRef(false);

  function start() {
    done.current = false;
    setText(actions.toInput(amount));
    setEditing(true);
  }

  useEffect(() => {
    if (!startEditing) return;
    start();
    onStartedEditing?.();
  }, [startEditing]);

  async function commit() {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    const parsed = actions.parse(text);
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
    return (
      <div className="relative">
        <Input
          ref={inputRef}
          aria-label={`Assigned to ${categoryName}`}
          autoFocus
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              done.current = true;
              setEditing(false);
            }
          }}
          className={cn("h-7 pl-6 text-right tabular-nums", className)}
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
    );
  }
  return (
    <button
      type="button"
      aria-label={`Assigned to ${categoryName}: ${format(amount)}`}
      onClick={start}
      className={cn(
        "h-7 w-full truncate rounded-md px-2 text-right text-sm tabular-nums hover:ring-1 hover:ring-input",
        className,
      )}
    >
      {format(amount)}
    </button>
  );
}
