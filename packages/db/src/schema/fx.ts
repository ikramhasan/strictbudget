import type { CurrencyCode } from "@strictbudget/engine";
import { char, date, numeric, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { budget } from "./budget";
import { timestamps } from "./columns";

export const FX_RATE_SOURCES = ["frankfurter", "currency-api"] as const;
export type FxRateSource = (typeof FX_RATE_SOURCES)[number];

/**
 * Market exchange rates fetched from a provider: "1 `base` = `rate` `quote`" on `date`. A shared
 * cache, not per budget. A lookup for a day the provider has no rate for (weekend, holiday) is
 * stored under both the requested date and the provider's own date. Rates are decimal strings
 * (12 decimals), never floats.
 */
export const fxRate = pgTable(
  "fx_rate",
  {
    id: text().primaryKey(),
    /** The date the rate was looked up for. */
    date: date({ mode: "string" }).notNull(),
    /** The provider's own date for the rate: the latest business day on or before `date`. */
    rateDate: date({ mode: "string" }).notNull(),
    base: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    quote: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    rate: numeric({ precision: 30, scale: 12 }).notNull(),
    source: text({ enum: FX_RATE_SOURCES }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("fx_rate_date_base_quote_idx").on(t.date, t.base, t.quote)],
);

/**
 * A budget's own rate for a day: "1 `currency` = `rate` × the budget's currency". Wins over the
 * market rate for that budget and date.
 */
export const fxRateOverride = pgTable(
  "fx_rate_override",
  {
    id: text().primaryKey(),
    budgetId: text()
      .notNull()
      .references(() => budget.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    rate: numeric({ precision: 30, scale: 12 }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("fx_rate_override_budget_date_currency_idx").on(t.budgetId, t.date, t.currency),
  ],
);
