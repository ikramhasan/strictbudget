import { type CurrencyCode, money, NUMBER_FORMAT_SPECS } from "@strictbudget/engine";
import { useBudget } from "@/lib/budget-context";
import { chartTick } from "@/lib/reports";

/**
 * Amount labels for the net worth charts, always from exact minor units: `exact` for values,
 * `tick` for an axis tick (`chartTick`: to the minor unit, decimals only when needed), `masked` for Show Amounts off.
 */
export function useAmountFormat(currency: CurrencyCode) {
  const { budget, formatAmount } = useBudget();
  const mark = NUMBER_FORMAT_SPECS[budget.numberFormat].decimal;
  const exact = (minor: bigint | string) => formatAmount(money(BigInt(minor), currency));
  return {
    exact,
    tick: (units: number) =>
      chartTick(units, currency, (m) => formatAmount(money(m, currency)), mark),
    masked: exact(0n).replace(/\d[\d\s.,' ]*/, "•••••"),
  };
}
