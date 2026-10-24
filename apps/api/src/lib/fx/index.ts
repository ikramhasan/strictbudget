import { newId } from "@strictbudget/db";
import { budget, budgetAccount, fxRate, fxRateOverride } from "@strictbudget/db/schema";
import { type CurrencyCode, crossRate, invertRate, normalizeRate } from "@strictbudget/engine";
import { and, desc, eq, inArray, lt, ne, or } from "drizzle-orm";
import type { AppDeps } from "../../types";
import { shiftDay } from "../dates";
import { AppError } from "../errors";
import type { JobHandler } from "../jobs";
import { type Db, serverToday } from "../ledger";
import type { FxProvider, FxRates } from "./providers";

export {
  CurrencyApiProvider,
  defaultFxProviders,
  FrankfurterProvider,
  type FxProvider,
  type FxRates,
} from "./providers";

import { log } from "../log";

export type FxRateSourceKind = "identity" | "override" | "market";

export interface ResolvedRate {
  /** "1 from = rate to", 12 decimals at most, trailing zeros trimmed. */
  rate: string;
  /** The date looked up: the requested one, held back to today. */
  date: string;
  /** The date the rate is actually from (an earlier business day, or an earlier fallback). */
  rateDate: string;
  source: FxRateSourceKind;
}

export interface ResolveRateInput {
  budgetId: string;
  from: CurrencyCode;
  to: CurrencyCode;
  date: string;
  /** The user's today; a later `date` uses today's rate. Defaults to the server's date. */
  today?: string;
}

type FxDeps = Pick<AppDeps, "fxProviders" | "serverDate">;

/**
 * The rate to convert `from` into `to` on `date` for a budget:
 * 1. the same currency is 1;
 * 2. the budget's own override for that date (when one side is the budget's currency);
 * 3. the cached market rate for that date (direct, inverse, or crossed through a cached pivot);
 * 4. a provider fetch (in order, first with the rate wins), cached for every quote it returned;
 * 5. when every provider fails, the nearest earlier cached market rate or override;
 * otherwise 422 FX_RATE_UNAVAILABLE.
 */
export async function resolveRate(
  db: Db,
  deps: FxDeps,
  input: ResolveRateInput,
): Promise<ResolvedRate> {
  const { budgetId, from, to } = input;
  const serverDate = deps.serverDate?.() ?? serverToday();
  const today = input.today ?? serverDate;
  const date = input.date > today ? today : input.date;
  if (from === to) return { rate: "1", date, rateDate: date, source: "identity" };

  const [row] = await db
    .select({ currency: budget.currency })
    .from(budget)
    .where(eq(budget.id, budgetId))
    .limit(1);
  if (!row) throw new AppError(404, "NOT_FOUND", "Budget not found");
  const foreign = foreignSide(row.currency, from, to);

  if (foreign) {
    const override = await overrideOn(db, budgetId, foreign, date);
    if (override) {
      const rate = foreign === from ? override : invertRate(override);
      return { rate, date, rateDate: date, source: "override" };
    }
  }

  const cached = await cachedMarketRate(db, from, to, date);
  if (cached) return { ...cached, date, source: "market" };
  for (const provider of deps.fxProviders) {
    const recent = recentFetches.get(provider)?.get(recentKey(date, from));
    if (recent && Date.now() - recent.at < RECENT_TTL_MS) {
      const onRateDate = await cachedMarketRate(db, from, to, recent.rateDate);
      if (onRateDate) return { ...onRateDate, date, source: "market" };
    }
  }

  // A date at least two days back is settled: the provider's answer for it won't change, so it's
  // cached under the requested date too. A more recent one may still get its own day's rate.
  const settled = date <= shiftDay(serverDate, -2);
  for (const provider of deps.fxProviders) {
    const fetched = await fetchOnce(db, provider, date, from, settled);
    const rate = fetched?.rates[to];
    if (fetched && rate) return { rate, date, rateDate: fetched.date, source: "market" };
  }

  const fallback = await nearestEarlier(db, budgetId, foreign, from, to, date);
  if (fallback) return { ...fallback, date };
  throw new AppError(
    422,
    "FX_RATE_UNAVAILABLE",
    `No exchange rate from ${from} to ${to} is available for ${date}`,
  );
}

/**
 * The best rate already known for `date`, without asking a provider: the budget's override, the
 * cached market rate, or the nearest earlier of either; null when there's none. For reads that
 * project (a schedule's upcoming amount), which shouldn't wait on the network.
 */
export async function knownRate(db: Db, input: KnownRateInput): Promise<string | null> {
  return (await knownRateOn(db, input))?.rate ?? null;
}

export interface KnownRateInput {
  budgetId: string;
  budgetCurrency: CurrencyCode;
  from: CurrencyCode;
  to: CurrencyCode;
  date: string;
}

/** `knownRate` with the date the rate is from (an earlier one when it fell back). */
export async function knownRateOn(
  db: Db,
  input: KnownRateInput,
): Promise<{ rate: string; rateDate: string } | null> {
  const { budgetId, from, to, date } = input;
  if (from === to) return { rate: "1", rateDate: date };
  const foreign = foreignSide(input.budgetCurrency, from, to);
  if (foreign) {
    const override = await overrideOn(db, budgetId, foreign, date);
    if (override)
      return { rate: foreign === from ? override : invertRate(override), rateDate: date };
  }
  const cached = await cachedMarketRate(db, from, to, date);
  if (cached) return cached;
  const earlier = await nearestEarlier(db, budgetId, foreign, from, to, date);
  return earlier ? { rate: earlier.rate, rateDate: earlier.rateDate } : null;
}

/** The non-budget currency when exactly one side is the budget's currency (overrides apply). */
function foreignSide(budgetCurrency: CurrencyCode, from: CurrencyCode, to: CurrencyCode) {
  if (to === budgetCurrency) return from;
  if (from === budgetCurrency) return to;
  return null;
}

async function overrideOn(db: Db, budgetId: string, currency: CurrencyCode, date: string) {
  const [row] = await db
    .select({ rate: fxRateOverride.rate })
    .from(fxRateOverride)
    .where(
      and(
        eq(fxRateOverride.budgetId, budgetId),
        eq(fxRateOverride.currency, currency),
        eq(fxRateOverride.date, date),
      ),
    )
    .limit(1);
  return row ? normalizeRate(row.rate) : null;
}

/** A cached rate on exactly `date`: direct, inverse, or through a pivot cached that day. */
async function cachedMarketRate(
  db: Db,
  from: CurrencyCode,
  to: CurrencyCode,
  date: string,
): Promise<{ rate: string; rateDate: string } | null> {
  const pair = [from, to];
  const rows = await db
    .select({
      base: fxRate.base,
      quote: fxRate.quote,
      rate: fxRate.rate,
      rateDate: fxRate.rateDate,
    })
    .from(fxRate)
    .where(and(eq(fxRate.date, date), or(inArray(fxRate.base, pair), inArray(fxRate.quote, pair))));
  if (rows.length === 0) return null;

  const rateOf = new Map(rows.map((r) => [`${r.base}>${r.quote}`, r]));
  const direct = rateOf.get(`${from}>${to}`);
  if (direct) return { rate: normalizeRate(direct.rate), rateDate: direct.rateDate };
  const inverse = rateOf.get(`${to}>${from}`);
  if (inverse) return { rate: invertRate(inverse.rate), rateDate: inverse.rateDate };

  for (const r of rows) {
    // Pivot as base: P→from and P→to give from→to = (P→to) / (P→from).
    if (r.quote === to) {
      const pFrom = rateOf.get(`${r.base}>${from}`);
      if (pFrom) return { rate: crossRate(r.rate, pFrom.rate), rateDate: r.rateDate };
    }
    // Pivot as quote: from→P and to→P give from→to = (from→P) / (to→P).
    if (r.base === from) {
      const toP = rateOf.get(`${to}>${r.quote}`);
      if (toP) return { rate: crossRate(r.rate, toP.rate), rateDate: r.rateDate };
    }
  }
  return null;
}

const RECENT_TTL_MS = 60 * 60 * 1000;
/** Recent (unsettled) dates each provider was asked lately: which day's cached rates answered. */
const recentFetches = new WeakMap<FxProvider, Map<string, { at: number; rateDate: string }>>();
/** Fetches in progress, so identical concurrent lookups share one request. */
const inFlight = new WeakMap<FxProvider, Map<string, Promise<FxRates | null>>>();
const FAILED_TTL_MS = 10 * 60 * 1000;
/**
 * When each provider last failed or had nothing for a date and base: reads skip it for a while
 * instead of waiting on its timeout again (an outage would otherwise slow every budget read).
 */
const failedFetches = new WeakMap<FxProvider, Map<string, number>>();

/** Forgets a provider's recent failures (tests, or a provider known to be back). */
export function forgetFxFailures(provider: FxProvider) {
  failedFetches.delete(provider);
}

function recentKey(date: string, base: CurrencyCode) {
  return `${date}|${base}`;
}

/** One provider's rates from `base` on `date`, stored in the cache; null when it has none. */
function fetchOnce(
  db: Db,
  provider: FxProvider,
  date: string,
  base: CurrencyCode,
  settled: boolean,
): Promise<FxRates | null> {
  const pending = inFlight.get(provider) ?? new Map<string, Promise<FxRates | null>>();
  inFlight.set(provider, pending);
  const key = recentKey(date, base);
  const existing = pending.get(key);
  if (existing) return existing;
  const failures = failedFetches.get(provider) ?? new Map<string, number>();
  failedFetches.set(provider, failures);
  const failedAt = failures.get(key);
  if (failedAt !== undefined && Date.now() - failedAt < FAILED_TTL_MS) {
    return Promise.resolve(null);
  }

  const run = (async () => {
    let fetched: FxRates | null;
    try {
      fetched = await provider.fetchRates(date, base, []);
    } catch (error) {
      log.warn("FX provider failed", { provider: provider.name, base, date }, error);
      failures.set(key, Date.now());
      return null;
    }
    if (!fetched) {
      failures.set(key, Date.now());
      return null;
    }
    failures.delete(key);
    const rates: FxRates["rates"] = {};
    for (const [quote, rate] of Object.entries(fetched.rates) as [CurrencyCode, string][]) {
      if (quote === base) continue;
      try {
        rates[quote] = normalizeRate(rate);
      } catch {
        // Not a usable rate; leave it out.
      }
    }
    const quotes = Object.entries(rates) as [CurrencyCode, string][];
    if (quotes.length === 0) return null;

    const dates = new Set([fetched.date]);
    if (settled || fetched.date === date) dates.add(date);
    else {
      const recent = recentFetches.get(provider) ?? new Map();
      recentFetches.set(provider, recent);
      recent.set(key, { at: Date.now(), rateDate: fetched.date });
    }
    const rateDate = fetched.date;
    await db
      .insert(fxRate)
      .values(
        [...dates].flatMap((d) =>
          quotes.map(([quote, rate]) => ({
            id: newId(),
            date: d,
            rateDate,
            base,
            quote,
            rate,
            source: provider.name,
          })),
        ),
      )
      .onConflictDoNothing();
    return { date: rateDate, rates };
  })().finally(() => pending.delete(key));
  pending.set(key, run);
  return run;
}

/**
 * The `fx.prefetch` job, a few times a day: fetches today's market rates once per
 * budget currency that has a foreign account, so reads find them cached. A base that already has
 * today's own rate is skipped. Early in the day a provider may only have yesterday's (currency-api
 * 404s until the day's file is out, Frankfurter has no weekend rates); that answer is cached as
 * usual and the next run tries again.
 */
export const prefetchFxRates: JobHandler<"fx.prefetch"> = async (deps) => {
  const today = deps.serverDate?.() ?? serverToday();
  const bases = await deps.db
    .selectDistinct({ base: budget.currency })
    .from(budget)
    .innerJoin(budgetAccount, eq(budgetAccount.budgetId, budget.id))
    .where(and(ne(budgetAccount.currency, budget.currency), eq(budgetAccount.closed, false)));
  for (const { base } of bases) {
    const [published] = await deps.db
      .select({ id: fxRate.id })
      .from(fxRate)
      .where(and(eq(fxRate.base, base), eq(fxRate.date, today), eq(fxRate.rateDate, today)))
      .limit(1);
    if (published) continue;
    for (const provider of deps.fxProviders) {
      const fetched = await fetchOnce(deps.db, provider, today, base, false);
      if (fetched?.date === today) break;
    }
  }
};

/** The most recent cached market rate or override for the pair before `date` (override on a tie). */
async function nearestEarlier(
  db: Db,
  budgetId: string,
  foreign: CurrencyCode | null,
  from: CurrencyCode,
  to: CurrencyCode,
  date: string,
): Promise<Omit<ResolvedRate, "date"> | null> {
  const [market] = await db
    .select({ base: fxRate.base, rate: fxRate.rate, rateDate: fxRate.rateDate })
    .from(fxRate)
    .where(
      and(
        lt(fxRate.date, date),
        or(
          and(eq(fxRate.base, from), eq(fxRate.quote, to)),
          and(eq(fxRate.base, to), eq(fxRate.quote, from)),
        ),
      ),
    )
    .orderBy(desc(fxRate.rateDate))
    .limit(1);
  const [override] = foreign
    ? await db
        .select({ rate: fxRateOverride.rate, date: fxRateOverride.date })
        .from(fxRateOverride)
        .where(
          and(
            eq(fxRateOverride.budgetId, budgetId),
            eq(fxRateOverride.currency, foreign),
            lt(fxRateOverride.date, date),
          ),
        )
        .orderBy(desc(fxRateOverride.date))
        .limit(1)
    : [];

  if (override && (!market || override.date >= market.rateDate)) {
    const rate = foreign === from ? normalizeRate(override.rate) : invertRate(override.rate);
    return { rate, rateDate: override.date, source: "override" };
  }
  if (market) {
    const rate = market.base === from ? normalizeRate(market.rate) : invertRate(market.rate);
    return { rate, rateDate: market.rateDate, source: "market" };
  }
  return null;
}
