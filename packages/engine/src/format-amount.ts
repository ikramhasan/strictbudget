import { type CurrencyCode, currencyExponent } from "./currency";
import type { BudgetFormatSettings, NumberFormat } from "./format-settings";
import { NUMBER_FORMAT_SPECS } from "./format-settings";
import type { Money } from "./money";
import { parseMoney } from "./parse-format";

const NBSP = " ";

function groupDigits(digits: string, group: string, grouping: "thousands" | "indian"): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const size = grouping === "indian" ? 2 : 3;
  const parts: string[] = [];
  for (let end = rest.length; end > 0; end -= size) {
    parts.unshift(rest.slice(Math.max(0, end - size), end));
  }
  return [...parts, last3].join(group);
}

const symbolCache = new Map<CurrencyCode, string>();

/** The currency's narrow symbol ("$", "€", "৳", "CHF"). Display-only, so Intl is fine here. */
export function currencySymbol(currency: CurrencyCode): string {
  let symbol = symbolCache.get(currency);
  if (symbol === undefined) {
    const parts = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    symbol = parts.find((p) => p.type === "currency")?.value ?? currency;
    symbolCache.set(currency, symbol);
  }
  return symbol;
}

/** Formats with the budget's settings using exact string operations; never goes through a float. */
export function formatAmount(
  m: Money,
  settings: BudgetFormatSettings,
  options: { grouping?: boolean } = {},
): string {
  const base = NUMBER_FORMAT_SPECS[settings.numberFormat];
  // File exports write amounts without group separators.
  const spec = options.grouping === false ? { ...base, group: "" } : base;
  const exponent = currencyExponent(m.currency);
  const negative = m.amount < 0n;
  const digits = (negative ? -m.amount : m.amount).toString().padStart(exponent + 1, "0");
  const whole = groupDigits(digits.slice(0, digits.length - exponent), spec.group, spec.grouping);
  const fraction = exponent > 0 ? `${spec.decimal}${digits.slice(digits.length - exponent)}` : "";
  const number = `${whole}${fraction}`;
  const sign = negative ? "-" : "";

  switch (settings.currencySymbolPosition) {
    case "none":
      return `${sign}${number}`;
    case "after":
      return `${sign}${number}${NBSP}${currencySymbol(m.currency)}`;
    case "before": {
      const symbol = currencySymbol(m.currency);
      // Letter symbols ("CHF") need a gap; glyphs ("$") sit flush.
      const gap = /\p{L}$/u.test(symbol) ? NBSP : "";
      return `${sign}${symbol}${gap}${number}`;
    }
  }
}

/**
 * Parses user input written in the budget's number format ("1.234,56" for dot_comma).
 * Group separators are ignored; excess decimal places are an error, never rounded.
 */
export function parseAmount(
  input: string,
  currency: CurrencyCode,
  numberFormat: NumberFormat,
): Money {
  const spec = NUMBER_FORMAT_SPECS[numberFormat];
  let normalized = input.trim().replace(spec.groupInput, "");
  if (spec.decimal === ",") normalized = normalized.replace(",", ".");
  return parseMoney(normalized, currency);
}
