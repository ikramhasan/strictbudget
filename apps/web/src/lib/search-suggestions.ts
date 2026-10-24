import {
  type BudgetFormatSettings,
  type CurrencyCode,
  completeDate,
  formatAmount,
  formatDate,
  IS_LABELS,
  IS_STATES,
  incomeTerm,
  money,
  parseAmount,
} from "@strictbudget/engine";
import { todayIso } from "./dates";
import { type Flag, flagLabel } from "./flags";

/**
 * One suggestion under the register's search box: what it searches (`label`, e.g. "Payee:"), how it
 * reads (`text`) and the term it writes into the box.
 */
export interface Suggestion {
  label: string;
  text: string;
  term: string;
  /** For icons: a flag's color, or the cleared state. */
  flag?: Flag["color"] | "none";
  calendar?: true;
}

export interface SuggestionSources {
  categories: readonly { name: string }[];
  accounts: readonly { name: string }[];
  flags: readonly Flag[];
  settings: BudgetFormatSettings & { currency: CurrencyCode };
  /** The user's today (YYYY-MM-DD), whose month `Income:` writes; today when left out. */
  today?: string;
}

/**
 * `Income:` is offered for a start of "income" with nothing after it ("i", "inco", "Income: ") or
 * anything starting with a digit ("5", "2026", "10/02/2026"), and anything read as a date ("Card 5";
 * see `searchSuggestions`); not for "oct" or "income: o".
 */
function offersIncome(typed: string) {
  if (/^\d/.test(typed)) return true;
  const match = /^([a-z]+)\s*(:?)\s*$/i.exec(typed);
  const word = match?.[1]?.toLowerCase();
  if (!word) return false;
  return match?.[2] ? word === "income" : "income".startsWith(word);
}

/** The part of the box being typed: everything after the last comma. */
export function currentFragment(text: string) {
  return text.slice(text.lastIndexOf(",") + 1).trim();
}

/** The box's text with the fragment replaced by `term`, ready for the next one. */
export function withTerm(text: string, term: string) {
  const done = text.slice(0, text.lastIndexOf(",") + 1).trim();
  return `${done ? `${done} ` : ""}${term}, `;
}

const contains = (haystack: string, needle: string) =>
  haystack.toLowerCase().includes(needle.toLowerCase());

/** Starts with `word`, followed by nothing, a colon or a space ("is", "is:", "is: clea"). */
function startsWithLabel(fragment: string, word: string) {
  return new RegExp(`^${word}(?:$|[:\\s])`, "i").test(fragment);
}

/**
 * Suggestions for what's being typed: dates and amounts when it reads as one (with `Income:` between
 * them), matching `Is:` states, flags, categories and accounts, then "Find … in any field / the
 * Payee / the Category / the Memo". Typing a label ("is", "flag", "outflow") lists all its options.
 */
export function searchSuggestions(fragment: string, sources: SuggestionSources): Suggestion[] {
  const typed = fragment.trim();
  if (!typed) return [];
  const { settings } = sources;
  const show = (amount: bigint) => formatAmount(money(amount, settings.currency), settings);
  const isOption = (state: (typeof IS_STATES)[number]): Suggestion => ({
    label: "Is:",
    text: IS_LABELS[state],
    term: `Is: ${IS_LABELS[state]}`,
  });
  const flagOptions = (match: (name: string) => boolean): Suggestion[] => [
    ...(match("None")
      ? [{ label: "Flag:", text: "None", term: "Flag: None", flag: "none" as const }]
      : []),
    // A named flag is searched by its name; `flagLabel` also has the color, to match on either.
    ...sources.flags
      .filter((f) => match(flagLabel(f)))
      .map((f) => {
        const name = f.name || flagLabel(f);
        return { label: "Flag:", text: name, term: `Flag: ${name}`, flag: f.color };
      }),
  ];
  const amountOptions = (direction: "Outflow" | "Inflow", text: string, amount: bigint) => [
    {
      label: `${direction}:`,
      text: `${direction} equals ${show(amount)}`,
      term: `${direction}: ${text}`,
    },
    {
      label: `${direction}:`,
      text: `${direction} more or equal to ${show(amount)}`,
      term: `${direction}: >=${text}`,
    },
    {
      label: `${direction}:`,
      text: `${direction} less or equal to ${show(amount)}`,
      term: `${direction}: <=${text}`,
    },
  ];
  const amountOf = (text: string) => {
    try {
      const { amount } = parseAmount(text, settings.currency, settings.numberFormat);
      return amount < 0n ? -amount : amount;
    } catch {
      return null;
    }
  };

  let specific: Suggestion[];
  if (startsWithLabel(typed, "is")) {
    specific = IS_STATES.map(isOption);
  } else if (startsWithLabel(typed, "flag")) {
    specific = flagOptions(() => true);
  } else if (startsWithLabel(typed, "outflow") || startsWithLabel(typed, "inflow")) {
    const direction = /^outflow/i.test(typed) ? "Outflow" : "Inflow";
    const rest = typed.replace(/^\w+:?\s*/, "");
    specific = amountOptions(direction, rest || "0", (rest && amountOf(rest)) || 0n);
  } else {
    const amount = amountOf(typed);
    const today = sources.today ?? todayIso();
    // Partial dates are completed ("5" is On 05/01/2026) and the full date read is written.
    const date = completeDate(typed, settings.dateFormat, today);
    const shown = date && formatDate(date, settings.dateFormat);
    // `Income:` is the date's month, unless what's typed is an amount ("5/" May, "5" this month).
    const [year = 0, month = 1] = (date && amount === null ? date : today).split("-").map(Number);
    const income: Suggestion = {
      label: "Income:",
      text: `Enter month like '${incomeTerm(month, year)}'`,
      term: incomeTerm(month, year),
      calendar: true,
    };
    specific = [
      ...(shown
        ? [
            { label: "On:", text: `On ${shown}`, term: `On: ${shown}` },
            { label: "Before:", text: `On or before ${shown}`, term: `Before: ${shown}` },
            { label: "After:", text: `On or after ${shown}`, term: `After: ${shown}` },
          ]
        : []),
      ...(date || offersIncome(typed) ? [income] : []),
      ...(amount !== null
        ? [...amountOptions("Outflow", typed, amount), ...amountOptions("Inflow", typed, amount)]
        : []),
      ...flagOptions((name) => contains(name, typed)),
      ...IS_STATES.filter((s) => contains(IS_LABELS[s], typed)).map(isOption),
      ...sources.categories
        .filter((c) => contains(c.name, typed))
        .map((c) => ({ label: "Category:", text: c.name, term: `Category: ${c.name}` })),
      ...sources.accounts
        .filter((a) => contains(a.name, typed))
        .map((a) => ({ label: "Account:", text: a.name, term: `Account: ${a.name}` })),
    ];
  }
  return [
    ...specific,
    { label: "", text: `Find "${typed}" in any field`, term: typed },
    { label: "Payee:", text: `Find "${typed}" in the Payee`, term: `Payee: ${typed}` },
    { label: "Category:", text: `Find "${typed}" in the Category`, term: `Category: ${typed}` },
    { label: "Memo:", text: `Find "${typed}" in the Memo`, term: `Memo: ${typed}` },
  ];
}
