import {
  type BudgetFormatSettings,
  type CurrencyCode,
  evaluateAmount,
  formatAmount,
  isCurrencyCode,
  MoneyParseError,
  money,
} from "@strictbudget/engine";

export interface MoneySettings extends BudgetFormatSettings {
  currency: CurrencyCode;
}

/**
 * The budget's number format and symbol position with an account's own currency (its symbol and
 * decimal places): amounts in an account are in its currency's minor units. Falls back to the
 * budget's currency while the account isn't known.
 */
export function inCurrency<S extends MoneySettings>(
  settings: S,
  currency: string | null | undefined,
): S {
  if (!currency || currency === settings.currency || !isCurrencyCode(currency)) return settings;
  return { ...settings, currency };
}

/**
 * Reads an amount typed in the budget's number format, math included ("230+30"), into minor
 * units, or explains why not.
 */
export function parseMoneyInput(text: string, settings: MoneySettings): bigint | string {
  try {
    return evaluateAmount(text, settings.currency, settings.numberFormat).amount;
  } catch (error) {
    if (error instanceof MoneyParseError) {
      return `Enter an amount like ${formatAmount(money(123456n, settings.currency), {
        ...settings,
        currencySymbolPosition: "none",
      })}`;
    }
    throw error;
  }
}

export function toMoneyInput(amount: string | bigint | null, settings: MoneySettings) {
  if (amount === null) return "";
  return formatAmount(money(BigInt(amount), settings.currency), {
    ...settings,
    currencySymbolPosition: "none",
  });
}
