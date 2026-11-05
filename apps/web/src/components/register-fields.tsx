import {
  type AccountType,
  type DateFormat,
  formatDate,
  payeeSuggestions,
  SCHEDULE_FREQUENCIES,
  SCHEDULE_FREQUENCY_LABELS,
  type ScheduleFrequency,
} from "@strictbudget/engine";
import {
  Autocomplete,
  AutocompleteCollection,
  AutocompleteContent,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
} from "@strictbudget/ui/components/autocomplete";
import { Button } from "@strictbudget/ui/components/button";
import { Calendar } from "@strictbudget/ui/components/calendar";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@strictbudget/ui/components/combobox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@strictbudget/ui/components/input-group";
import { Label } from "@strictbudget/ui/components/label";
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@strictbudget/ui/components/popover";
import { cn } from "@strictbudget/ui/lib/utils";
import {
  ArrowLeftRight,
  CalendarDays,
  Check,
  ExternalLink,
  Info,
  Plus,
  Split,
  X,
} from "lucide-react";
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { dateForKey, dateToIso, isoToDate, parseDateInput, todayIso } from "@/lib/dates";
import { useShortcutsEnabled } from "@/lib/preferences";
import { shortDate } from "@/lib/register-dates";
import {
  type CategoryOption,
  categoryLabel,
  type Payee,
  type TransferDirection,
  transferChoiceLabel,
  transferLabel,
} from "@/lib/transactions";
import { CategoryLabel } from "./category-label";
import { useManagePayees } from "./manage-payees";

/**
 * True when a key belongs to a field's open suggestion list rather than to the row: Esc closes
 * the list, and Enter picks the highlighted item. With nothing highlighted, Enter saves what's in
 * the field. Tab is never the list's: it moves to the next cell (a payee or category field opens
 * its list on focus, so the list is nearly always open). (Base UI handles the key first, but the
 * attributes still read as they were while the event bubbles.)
 */
export function listOwnsKey(event: { key: string; target: EventTarget | null }) {
  const { target } = event;
  if (event.key === "Tab") return false;
  if (!(target instanceof HTMLElement) || target.getAttribute("aria-expanded") !== "true") {
    return false;
  }
  return event.key !== "Enter" || target.hasAttribute("aria-activedescendant");
}

/** Focus moved into one of a field's popups (they're portalled, so outside the cell's DOM). */
export function isInsidePopup(node: EventTarget | null) {
  return (
    node instanceof Element &&
    node.closest("[data-slot=popover-content],[data-slot=combobox-content]") !== null
  );
}

/**
 * A date typed in the budget's format ("10/5" works too), with a calendar to pick from. With
 * `repeat`, the calendar has a "Repeat:" select under it (new and scheduled transactions).
 */
export function DateField({
  value,
  onChange,
  onPick,
  format,
  autoFocus,
  repeat,
  onMakeRepeating,
  defaultOpen = false,
  short = false,
}: {
  value: string;
  onChange: (iso: string) => void;
  onPick?: (iso: string) => void;
  format: DateFormat;
  autoFocus?: boolean;
  repeat?: { value: ScheduleFrequency; onChange: (frequency: ScheduleFrequency) => void };
  /** A plain transaction's date picker offers "Make repeating" instead. */
  onMakeRepeating?: () => void;
  /** Start with the calendar open (Make repeating's new row). */
  defaultOpen?: boolean;
  /** This year's dates without the year, as a register's rows show them (typed back the same). */
  short?: boolean;
}) {
  const display = (iso: string) =>
    short ? shortDate(iso, format, todayIso()) : formatDate(iso, format);
  const [text, setText] = useState(() => display(value));
  const [open, setOpen] = useState(defaultOpen);
  const inputRef = useRef<HTMLInputElement>(null);
  const repeatId = useId();
  const shortcuts = useShortcutsEnabled();

  /** The date-picker keys change the date in place, the text selected for the next one. */
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!shortcuts || e.ctrlKey || e.metaKey || e.altKey) return;
    const next = dateForKey(value, e.key, todayIso(), { dash: !format.includes("-") });
    if (!next) return;
    e.preventDefault();
    onChange(next);
    setText(display(next));
    requestAnimationFrame(() => inputRef.current?.select());
  }

  return (
    <InputGroup className="h-8">
      <InputGroupInput
        ref={inputRef}
        aria-label="Date"
        value={text}
        autoFocus={autoFocus}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          setText(e.target.value);
          const iso = parseDateInput(e.target.value, format);
          if (iso) onChange(iso);
        }}
        onBlur={() => setText(display(value))}
        className="tabular-nums"
      />
      <InputGroupAddon align="inline-end">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <InputGroupButton size="icon-xs" aria-label="Pick a date" tabIndex={-1}>
              <CalendarDays />
            </InputGroupButton>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={isoToDate(value)}
              defaultMonth={isoToDate(value)}
              onSelect={(date) => {
                if (!date) return;
                const iso = dateToIso(date);
                onChange(iso);
                setText(display(iso));
                setOpen(false);
                inputRef.current?.focus();
                onPick?.(iso);
              }}
            />
            {onMakeRepeating && (
              <div className="border-t p-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setOpen(false);
                    onMakeRepeating();
                  }}
                >
                  Make repeating
                </Button>
              </div>
            )}
            {repeat && (
              <div className="grid gap-1.5 border-t p-3">
                <Label htmlFor={repeatId} className="text-xs">
                  Repeat:
                </Label>
                <NativeSelect
                  id={repeatId}
                  value={repeat.value}
                  onChange={(e) => repeat.onChange(e.target.value as ScheduleFrequency)}
                  className="h-8 w-full"
                >
                  {SCHEDULE_FREQUENCIES.map((f) => (
                    <NativeSelectOption key={f} value={f}>
                      {SCHEDULE_FREQUENCY_LABELS[f]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </InputGroupAddon>
    </InputGroup>
  );
}

type PayeeItem = {
  /** Unique in the list: the copy under "Selected" has its own. */
  id: string;
  label: string;
  kind: "payee" | "transfer";
  /** Transfers: the other account. */
  accountId?: string;
  accountName?: string;
  /** Transfers: what the list shows ("Payment from X", or just the account's name). */
  text?: string;
};

/** Typed text names this item; a transfer also answers to its stored "Transfer : X". */
function matches(item: PayeeItem, text: string) {
  const lower = text.toLowerCase();
  return (
    item.label.toLowerCase() === lower ||
    (item.kind === "transfer" &&
      item.accountName !== undefined &&
      transferLabel(item.accountName).toLowerCase() === lower)
  );
}

/** The copy of the field's payee listed under "Selected". */
const SELECTED = "selected:";
const asSelected = (item: PayeeItem): PayeeItem => ({ ...item, id: `${SELECTED}${item.id}` });

export interface TransferTarget {
  id: string;
  name: string;
  /** With the editing account's `own`, names the transfer ("Payment from X"). */
  type?: AccountType;
}

export interface PayeeChoice {
  name: string;
  transferAccountId: string | null;
  /** An existing payee was picked from the list (to suggest its last category). */
  payee?: Payee;
}

/**
 * How well a payee name answers typed text: names that start with it, then ones with a word that
 * does, then the rest that contain it ("sh" puts Shell before FreshMart).
 */
function payeeRank(label: string, text: string) {
  const lower = label.toLowerCase();
  if (lower === text) return 0;
  if (lower.startsWith(text)) return 1;
  return lower.split(/[\s\-/&.]+/).some((w) => w.startsWith(text)) ? 2 : 3;
}

/** Whether a field's change event added text (typing, pasting) rather than removing it. */
function addedText(event: unknown, before: string, after: string) {
  const native = (event as { nativeEvent?: unknown } | undefined)?.nativeEvent ?? event;
  const type = (native as { inputType?: unknown } | undefined)?.inputType;
  return typeof type === "string" ? type.startsWith("insert") : after.length > before.length;
}

/**
 * Payee name with suggestions, plus "Payments and Transfers" for each account money can move to,
 * worded by `own` and the amount's direction (`transferChoiceLabel`); "Transfer : <account>"
 * without `own`. A new name is created on save; "Create … Payee" is listed at the top so that's
 * clear, while the first existing match stays highlighted. That entry is a button above the list
 * rather than an item, so autocomplete never lands on it.
 *
 * Typing completes the name in the field (inline autocomplete): "Fan" reads "Fancy Bistro" with
 * "cy Bistro" selected, so typing on replaces it, Backspace removes it, and Tab or Enter keeps it.
 */
export function PayeeField({
  label = "Payee",
  value,
  onChange,
  onPick,
  payees,
  transfers,
  own,
  transferAccountId = null,
  autoFocus,
  openOnFocus = true,
  importDetails,
}: {
  /** Accessible name (split lines say which line). */
  label?: string;
  value: string;
  onChange: (choice: PayeeChoice) => void;
  onPick?: (choice: PayeeChoice) => void;
  payees: readonly Payee[];
  transfers: readonly TransferTarget[];
  /** The account being edited and which way its amount goes. */
  own?: { type: AccountType; direction: TransferDirection };
  /** The account the field's transfer goes to, to tell two accounts with one name apart. */
  transferAccountId?: string | null;
  autoFocus?: boolean;
  /**
   * Show the list as soon as the field gets focus. Off, it opens on typing, Alt+Down or Enter in an
   * empty field (a register cell, opened to read or fix the name).
   */
  openOnFocus?: boolean;
  /** An imported transaction's bank import details, behind the Selected payee. */
  importDetails?: ImportDetails;
}) {
  const trimmed = value.trim();
  const managePayees = useManagePayees();
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Hidden payees aren't suggested, but typing one's exact name still uses it.
  const hiddenMatch = payees.some(
    (p) => p.hidden && p.name.toLowerCase() === trimmed.toLowerCase(),
  );
  // The whole list shows as soon as the field is focused, with the current payee selected so
  // typing replaces it; the list narrows once something is typed.
  const [open, setOpen] = useState(Boolean(autoFocus) && openOnFocus);
  const [typed, setTyped] = useState(false);
  /** What was typed, without the completion: what the list is narrowed and ranked by. */
  const [query, setQuery] = useState("");
  const typedText = query.trim().toLowerCase();
  const inputRef = useRef<HTMLInputElement>(null);
  /** The completion to select once the field shows it: from the end of the typed text. */
  const completing = useRef<{ text: string; from: number } | null>(null);
  /** The last completion and the text typed for it, which Backspace gives back as typed. */
  const completed = useRef<{ typed: string; text: string } | null>(null);
  useLayoutEffect(() => {
    const pending = completing.current;
    const input = inputRef.current;
    if (!pending || !input || input.value !== pending.text) return;
    completing.current = null;
    input.setSelectionRange(pending.from, pending.text.length, "backward");
  });
  const { groups, create } = useMemo(() => {
    const known: PayeeItem[] = payees
      .filter((p) => !p.hidden)
      .map((p) => ({ id: p.id, label: p.name, kind: "payee" }));
    const toAccounts: PayeeItem[] = transfers.map((a) => {
      const worded =
        own && a.type
          ? transferChoiceLabel(own.type, { name: a.name, type: a.type }, own.direction)
          : null;
      return {
        id: `transfer:${a.id}`,
        label: worded ?? transferLabel(a.name),
        kind: "transfer",
        accountId: a.id,
        accountName: a.name,
        text: worded ?? a.name,
      };
    });
    const chosen =
      (transferAccountId && toAccounts.find((p) => p.accountId === transferAccountId)) ||
      [...known, ...toAccounts].find((p) => matches(p, trimmed));
    // Untyped, the list is "Selected", then "Payments and transfers", then "Saved payees"; once
    // something is typed, saved payees come first, ranked by what was typed (`payeeRank`; the list
    // still keeps every name that contains it).
    const saved = {
      value: "Saved payees",
      items:
        typed && typedText
          ? [...known].sort((a, b) => payeeRank(a.label, typedText) - payeeRank(b.label, typedText))
          : known,
    };
    const moves = { value: "Payments and transfers", items: toAccounts };
    const selected = chosen && !typed ? [{ value: "Selected", items: [asSelected(chosen)] }] : [];
    return {
      groups: [...selected, ...(typed ? [saved, moves] : [moves, saved])].filter(
        (g) => g.items.length > 0,
      ),
      // A name no payee has yet: offer to create it at the top of the list.
      create: trimmed && !chosen && !hiddenMatch ? trimmed : null,
    };
  }, [payees, transfers, own, trimmed, typedText, hiddenMatch, typed, transferAccountId]);

  /** The saved payee typed text completes to: the first that starts with it, as the list ranks. */
  function completionOf(text: string) {
    const lower = text.toLowerCase();
    if (!lower.trim()) return null;
    // A payee's whole name is that payee, not a longer one that starts with it.
    if (payees.some((p) => p.name.toLowerCase() === lower)) return null;
    const found = payees.find(
      (p) => !p.hidden && p.name.length > text.length && p.name.toLowerCase().startsWith(lower),
    );
    return found ? found.name : null;
  }

  // Item presses report only the text; the highlighted item tells transfers to two accounts
  // with the same name apart.
  const highlighted = useRef<PayeeItem | undefined>(undefined);
  function choose(text: string, picked?: PayeeItem): PayeeChoice {
    const item =
      picked && picked.label === text
        ? picked
        : groups.flatMap((g) => g.items).find((p) => matches(p, text.trim()));
    if (item?.kind === "transfer" && item.accountId) {
      return { name: item.label, transferAccountId: item.accountId };
    }
    return { name: text, transferAccountId: null, payee: payees.find((p) => p.name === text) };
  }

  return (
    <Autocomplete
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setTyped(false);
      }}
      items={groups}
      // Narrowed by what was typed, not the completion after it.
      filter={
        typed
          ? (item: PayeeItem) => !typedText || item.label.toLowerCase().includes(typedText)
          : null
      }
      value={value}
      onItemHighlighted={(item: PayeeItem | undefined) => {
        highlighted.current = item;
      }}
      onValueChange={(text, details) => {
        if (details.reason === "input-change") {
          setTyped(true);
          // Typing at the end completes the name (in its own case); deleting never does, so
          // Backspace undoes it, back to the letters as they were typed.
          const added = addedText(details.event, value, text);
          const last = completed.current;
          completed.current = null;
          const typedBefore =
            last && value === last.text && text.toLowerCase().startsWith(last.typed.toLowerCase())
              ? last.typed
              : null;
          if (typedBefore !== null) text = typedBefore + text.slice(typedBefore.length);
          setQuery(text);
          const atEnd = (inputRef.current?.selectionStart ?? text.length) === text.length;
          const completion = atEnd && added ? completionOf(text) : null;
          if (completion) {
            completing.current = { text: completion, from: text.length };
            completed.current = { typed: text, text: completion };
            onChange({ name: completion, transferAccountId: null });
            return;
          }
        }
        const pressed = details.reason === "item-press";
        const choice = choose(text, pressed ? highlighted.current : undefined);
        onChange(pressed ? choice : { ...choice, payee: undefined });
        if (pressed) onPick?.(choice);
      }}
      itemToStringValue={(item: PayeeItem) => item.label}
      // Until something is typed, Enter keeps the payee instead of picking the first one.
      autoHighlight={typed}
    >
      <AutocompleteInput
        ref={inputRef}
        aria-label={label}
        aria-autocomplete="both"
        placeholder="Payee"
        showTrigger={false}
        autoFocus={autoFocus}
        onFocus={(e) => {
          // Coming back to the field shows the whole list again, Selected first.
          setTyped(false);
          setQuery("");
          if (openOnFocus) setOpen(true);
          e.currentTarget.select();
        }}
        onKeyDown={(e) => {
          // Enter on an empty field with its list closed opens the list (with a payee in it,
          // Enter goes on to save the row).
          if (e.key === "Enter" && !open && value.trim() === "") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
            return;
          }
          // Alt+Down shows the whole list, Selected first.
          if (e.key === "ArrowDown" && e.altKey && !open) {
            e.preventDefault();
            setTyped(false);
            setOpen(true);
            return;
          }
          // Tab takes the highlighted suggestion (and its category) before moving on, so a
          // partly typed name never becomes a new payee by accident.
          if (e.key !== "Tab" || e.shiftKey || !open || !typed) return;
          const item = highlighted.current;
          if (!item) return;
          onChange(choose(item.label, item));
        }}
        className="h-8 w-full"
      />
      <AutocompleteContent
        className={cn("min-w-64", detailsOpen && importDetails && "sm:min-w-[36rem]")}
      >
        <div className="flex flex-col gap-0 sm:flex-row">
          <div className="min-w-64 flex-1">
            {create && (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-primary-text text-sm hover:bg-accent"
                // Keep focus in the field: the row goes on with the new name.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange({ name: create, transferAccountId: null });
                  setOpen(false);
                }}
              >
                <Plus className="size-4 shrink-0" />
                <span className="truncate">Create “{create}” payee</span>
              </button>
            )}
            <AutocompleteList>
              {(group: { value: string; items: PayeeItem[] }) => (
                <AutocompleteGroup key={group.value} items={group.items}>
                  {group.value && <AutocompleteGroupLabel>{group.value}</AutocompleteGroupLabel>}
                  <AutocompleteCollection>
                    {(item: PayeeItem) => (
                      <AutocompleteItem key={item.id} value={item}>
                        {item.id.startsWith(SELECTED) && (
                          <Check aria-hidden className="size-4 text-muted-foreground" />
                        )}
                        {item.kind === "transfer" ? (
                          <>
                            <ArrowLeftRight className="size-4 text-muted-foreground" />
                            {item.text}
                          </>
                        ) : (
                          item.label
                        )}
                        {importDetails && item.id.startsWith(SELECTED) && (
                          <button
                            type="button"
                            aria-label="Bank import details"
                            aria-expanded={detailsOpen}
                            className="ml-auto rounded-full text-muted-foreground hover:text-foreground"
                            // Not the item: keep the field's focus and its payee.
                            onMouseDown={(e) => e.preventDefault()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDetailsOpen((o) => !o);
                            }}
                          >
                            <Info className="size-4" />
                          </button>
                        )}
                      </AutocompleteItem>
                    )}
                  </AutocompleteCollection>
                </AutocompleteGroup>
              )}
            </AutocompleteList>
            {hiddenMatch && (
              <p className="px-2 py-1.5 text-muted-foreground text-xs">
                1 matching payee is hidden
              </p>
            )}
            {managePayees && (
              <button
                type="button"
                className="w-full border-t px-2 py-1.5 text-left text-primary-text text-sm hover:underline"
                // Keep focus in the field until the dialog takes it.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  managePayees();
                }}
              >
                Manage payees
              </button>
            )}
          </div>
          {detailsOpen && importDetails && (
            <BankImportDetails details={importDetails} onClose={() => setDetailsOpen(false)} />
          )}
        </div>
      </AutocompleteContent>
    </Autocomplete>
  );
}

export interface ImportDetails {
  /** The payee as the bank sent it. */
  statement: string;
  /** As it was imported: names aren't cleaned up, so the same text. */
  imported: string;
  /** The payee a renaming rule (or an edit) moved it to, when it isn't the imported name. */
  renamedTo: string | null;
  orderLink: { label: string; url: string } | null;
  onDontRename?: () => void;
}

function BankImportDetails({ details, onClose }: { details: ImportDetails; onClose: () => void }) {
  const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {});
  const card = "grid gap-1 rounded-md border bg-background p-2.5";
  return (
    <section
      aria-label="Bank import details"
      className="grid content-start gap-2 border-t bg-muted/40 p-2.5 text-sm sm:w-72 sm:border-t-0 sm:border-l"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center justify-between">
        <p className="font-medium">Bank import details</p>
        <button
          type="button"
          aria-label="Close bank import details"
          className="text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>
      <div className={card}>
        <p className="font-medium text-xs">As it appears on your statement</p>
        <p className="break-words">{details.statement}</p>
        <button
          type="button"
          className="justify-self-start text-primary-text text-xs hover:underline"
          onClick={() => copy(details.statement)}
        >
          Copy
        </button>
      </div>
      <div className={card}>
        <p className="font-medium text-xs">As strictbudget imported it</p>
        <p className="break-words">{details.imported}</p>
        <button
          type="button"
          className="justify-self-start text-primary-text text-xs hover:underline"
          onClick={() => copy(details.imported)}
        >
          Copy
        </button>
        {details.renamedTo && details.onDontRename && (
          <button
            type="button"
            className="justify-self-start text-left text-primary-text text-xs hover:underline"
            onClick={details.onDontRename}
          >
            Don't rename as {details.renamedTo}
          </button>
        )}
      </div>
      {details.orderLink && (
        <>
          <p className="font-medium text-xs">Additional information</p>
          <div className={card}>
            <a
              href={details.orderLink.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-primary-text hover:underline"
            >
              {details.orderLink.label}
              <ExternalLink className="size-3.5" />
            </a>
            <p className="text-muted-foreground text-xs">External link</p>
          </div>
        </>
      )}
    </section>
  );
}

interface CategoryGroupItems {
  value: string;
  items: CategoryOption[];
}

/**
 * What each category has available, shown beside it in every category field below (a register
 * provides the current month's), so the right envelope is picked without leaving the row.
 */
export const CategoryBalancesContext = createContext<
  ((option: CategoryOption) => ReactNode) | null
>(null);

const SPLIT: CategoryOption = { id: "__split", name: "Split", group: "" };
const PAYMENT_TRANSFER: CategoryOption = {
  id: "__payment_transfer",
  name: "Payment/Transfer",
  group: "",
};

const CATEGORY_ACTION =
  "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 font-medium text-muted-foreground text-xs hover:bg-accent hover:text-foreground";

/** Copies of categories listed again under "Selected" or "Suggested", told apart by id. */
const SHORTCUT = "__shortcut:";
const shortcut = (option: CategoryOption) => ({ ...option, id: `${SHORTCUT}${option.id}` });

/**
 * "Selected" (the category in the field) and, once a known payee is picked, "Suggested" (the
 * payee's other recent categories). They make way for the matches as soon as something is typed.
 */
function shortcutGroups(
  categories: readonly CategoryOption[],
  selected: CategoryOption | null,
  suggestedIds: readonly string[],
): CategoryGroupItems[] {
  const listed = suggestedIds.filter((id) => categories.some((c) => c.id === id));
  const suggested = payeeSuggestions(listed, selected?.id ?? null)
    .map((id) => categories.find((c) => c.id === id))
    .filter((c): c is CategoryOption => c !== undefined);
  return [
    ...(selected ? [{ value: "Selected", items: [shortcut(selected)] }] : []),
    ...(suggested.length > 0 ? [{ value: "Suggested", items: suggested.map(shortcut) }] : []),
  ];
}

/**
 * Category picker grouped like the budget; clearing it means Uncategorized. "Payment/Transfer"
 * (before Split, in cash and card registers alike) goes to the payee list to pick an account.
 */
export function CategoryField({
  label = "Category",
  value,
  onChange,
  onSplit,
  onPaymentTransfer,
  categories,
  autoFocus,
  placeholder = "Uncategorized",
  describe,
  shortcuts = false,
  suggestedIds,
  chevron = false,
  openOnFocus = true,
  inline = false,
}: {
  label?: string;
  value: string | null;
  /** `via` is "tab" when Tab took the highlighted category on the way to the next field. */
  onChange: (id: string | null, via?: "tab") => void;
  onSplit?: () => void;
  onPaymentTransfer?: () => void;
  categories: readonly CategoryOption[];
  autoFocus?: boolean;
  placeholder?: string;
  /** Extra text at the end of an option, e.g. what's available in it. */
  describe?: (option: CategoryOption) => ReactNode;
  /** List the chosen category under "Selected" (and the suggestions under "Suggested"). */
  shortcuts?: boolean;
  /** The payee's recent categories, most recent first (see `payeeSuggestions`). */
  suggestedIds?: readonly string[];
  /** A dropdown chevron at the end (a standalone picker, not a register cell). */
  chevron?: boolean;
  /** Open the list as soon as the field gets focus (a register cell); otherwise on typing. */
  openOnFocus?: boolean;
  /** The list always shown under the field, in place (a popover of its own, e.g. bulk Categorize). */
  inline?: boolean;
}) {
  const balances = useContext(CategoryBalancesContext);
  const describeOption = describe ?? balances ?? undefined;
  const selected = categories.find((c) => c.id === value) ?? null;
  const [query, setQuery] = useState("");
  const highlighted = useRef<CategoryOption | undefined>(undefined);
  const typing = query.trim() !== "" && (!selected || query !== categoryLabel(selected));
  const groups = useMemo(() => {
    const byGroup = new Map<string, CategoryOption[]>();
    for (const c of categories) byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c]);
    const list = [...byGroup].map(
      ([group, items]): CategoryGroupItems => ({ value: group, items }),
    );
    const actions = [...(onPaymentTransfer ? [PAYMENT_TRANSFER] : []), ...(onSplit ? [SPLIT] : [])];
    const top =
      shortcuts && !typing ? shortcutGroups(categories, selected, suggestedIds ?? []) : [];
    return [...top, ...list, ...(actions.length > 0 ? [{ value: "", items: actions }] : [])];
  }, [categories, onSplit, onPaymentTransfer, shortcuts, suggestedIds, typing, selected]);
  // With the shortcuts, the "Selected" entry is the one ticked, so the list opens at the top.
  const shown = useMemo(
    () => (selected && shortcuts ? shortcut(selected) : selected),
    [selected, shortcuts],
  );
  const [open, setOpen] = useState(Boolean(autoFocus) && openOnFocus);
  const list = (
    <>
      {(onSplit || onPaymentTransfer) && (
        <div className="flex gap-1 border-b p-1">
          {onPaymentTransfer && (
            <button
              type="button"
              className={CATEGORY_ACTION}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false);
                onPaymentTransfer();
              }}
            >
              <ArrowLeftRight className="size-3.5" /> Payment/Transfer
            </button>
          )}
          {onSplit && (
            <button
              type="button"
              className={CATEGORY_ACTION}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false);
                onSplit();
              }}
            >
              <Split className="size-3.5" /> Split
            </button>
          )}
        </div>
      )}
      <ComboboxEmpty>No matching category</ComboboxEmpty>
      <ComboboxList className={inline ? "max-h-72" : undefined}>
        {(group: CategoryGroupItems) => (
          <ComboboxGroup key={group.value} items={group.items}>
            {group.value && <ComboboxLabel>{group.value}</ComboboxLabel>}
            <ComboboxCollection>
              {(option: CategoryOption) => (
                <ComboboxItem key={option.id} value={option}>
                  {option.id === SPLIT.id ? (
                    <>
                      <Split className="size-4 text-muted-foreground" /> Split
                    </>
                  ) : option.id === PAYMENT_TRANSFER.id ? (
                    <>
                      <ArrowLeftRight className="size-4 text-muted-foreground" /> Payment/Transfer
                    </>
                  ) : option.id.startsWith(SHORTCUT) ? (
                    // The group in parentheses: "Rent (Bills)".
                    <span className="flex w-full items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-1">
                        <CategoryLabel name={option.name} />
                        {/* A space of its own keeps "Rent (Bills)" whole in the option's name. */}{" "}
                        <span className="shrink-0 text-muted-foreground">({option.group})</span>
                      </span>
                      {describeOption && (
                        <span className="shrink-0 tabular-nums">
                          {describeOption({ ...option, id: option.id.replace(SHORTCUT, "") })}
                        </span>
                      )}
                    </span>
                  ) : describeOption ? (
                    <span className="flex w-full items-center justify-between gap-3">
                      <CategoryLabel name={option.name} />
                      <span className="shrink-0 tabular-nums">{describeOption(option)}</span>
                    </span>
                  ) : (
                    <CategoryLabel name={option.name} />
                  )}
                </ComboboxItem>
              )}
            </ComboboxCollection>
          </ComboboxGroup>
        )}
      </ComboboxList>
    </>
  );

  return (
    <Combobox<CategoryOption>
      inline={inline}
      open={inline || open}
      onOpenChange={inline ? undefined : setOpen}
      items={groups}
      value={shown}
      onInputValueChange={setQuery}
      onValueChange={(option) => {
        if (option?.id === SPLIT.id) onSplit?.();
        else if (option?.id === PAYMENT_TRANSFER.id) {
          setOpen(false);
          onPaymentTransfer?.();
        } else onChange(option?.id.replace(SHORTCUT, "") ?? null);
      }}
      onItemHighlighted={(option: CategoryOption | undefined) => {
        highlighted.current = option;
      }}
      itemToStringLabel={categoryLabel}
      // The Selected copy and the category in its group are both ticked.
      isItemEqualToValue={(a, b) => a.id.replace(SHORTCUT, "") === b.id.replace(SHORTCUT, "")}
      autoHighlight
    >
      <ComboboxInput
        aria-label={label}
        placeholder={placeholder}
        showTrigger={chevron}
        showClear={selected !== null}
        autoFocus={autoFocus}
        onFocus={() => openOnFocus && !inline && setOpen(true)}
        onKeyDown={(e) => {
          // Enter on an empty field with its list closed opens the list (with a category in it,
          // Enter goes on to save the row or submit the form).
          if (e.key === "Enter" && !open && !selected) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
            return;
          }
          // Tab files the row under the highlighted match, as Enter would, then moves on.
          if (e.key !== "Tab" || e.shiftKey || !open || !typing) return;
          const option = highlighted.current;
          if (!option || option.id === SPLIT.id || option.id === PAYMENT_TRANSFER.id) return;
          onChange(option.id.replace(SHORTCUT, ""), "tab");
        }}
        className="h-8 w-full"
      />
      {inline ? (
        <div className="-mx-2 mt-2 -mb-1 border-t px-1">{list}</div>
      ) : (
        <ComboboxContent className="max-h-[min(20rem,var(--available-height))] min-w-72">
          {list}
        </ComboboxContent>
      )}
    </Combobox>
  );
}
