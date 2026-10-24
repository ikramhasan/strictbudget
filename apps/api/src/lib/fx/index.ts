import { AsyncLocalStorage } from "node:async_hooks";
import { newId, sql } from "@strictbudget/db";
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
  // A provider asked lately for this date (from any base) answered with an earlier day's rates.
  for (const provider of deps.fxProviders) {
    for (const [key, recent] of recentFetches.get(provider) ?? []) {
      if (Date.now() - recent.at >= RECENT_TTL_MS) recentFetches.get(provider)?.delete(key);
      else if (key.startsWith(`${date}|`)) {
        const onRateDate = await cachedMarketRate(db, from, to, recent.rateDate);
        if (onRateDate) return { ...onRateDate, date, source: "market" };
      }
    }
  }

  // A date at least two days back is settled: the provider's answer for it won't change, so it's
  // cached under the requested date too. A more recent one may still get its own day's rate.
  const settled = date <= shiftDay(serverDate, -2);
  for (const provider of deps.fxProviders) {
    const fetched = await fetchOnce(db, provider, date, from, settled);
    if (!fetched) continue;
    holdShared(fetched.rows);
    const rate = fetched.rates[to];
    if (rate) return { rate, date, rateDate: fetched.date, source: "market" };
  }

  const fallback = await nearestEarlier(db, budgetId, foreign, from, to, date);
  if (fallback) return { ...fallback, date };
  throw new AppError(
    422,
    "FX_RATE_UNAVAILABLE",
    `No exchange rate from ${from} to ${to} is available for ${date}`,
  );
}

export interface PrefetchInput {
  budgetId: string;
  /** Currencies the write converts. */
  currencies?: readonly CurrencyCode[];
  /** Accounts the write touches: their currencies are converted. */
  accountIds?: readonly (string | null | undefined)[];
  /** The dates converted at (none: nothing to fetch). */
  dates: readonly (string | null | undefined)[];
  today?: string;
}

/**
 * Looks up the rates a write will need before it changes anything: each of these
 * currencies to and from the budget's, on each date. A provider fetch then happens while the
 * request's transaction holds no locks, and the write's own lookups find what it fetched (any pair
 * of these currencies, through a pivot). A rate that can't be had is left for the write's lookup to
 * report.
 */
export async function prefetchRates(db: Db, deps: FxDeps, input: PrefetchInput): Promise<void> {
  const dates = [...new Set(input.dates.filter((d): d is string => !!d))];
  const ids = [...new Set(input.accountIds?.filter((id): id is string => !!id))];
  if (dates.length === 0 || (ids.length === 0 && !input.currencies?.length)) return;
  const [row] = await db
    .select({ currency: budget.currency })
    .from(budget)
    .where(eq(budget.id, input.budgetId))
    .limit(1);
  if (!row) return;
  const currencies = new Set(input.currencies);
  if (ids.length > 0) {
    const accounts = await db
      .selectDistinct({ currency: budgetAccount.currency })
      .from(budgetAccount)
      .where(and(eq(budgetAccount.budgetId, input.budgetId), inArray(budgetAccount.id, ids)));
    for (const a of accounts) currencies.add(a.currency);
  }
  currencies.delete(row.currency);
  for (const date of dates) {
    for (const currency of currencies) {
      // Both ways: a provider may only have one of them (the other is then found as its inverse).
      for (const [from, to] of [
        [currency, row.currency],
        [row.currency, currency],
      ] as const) {
        try {
          await resolveRate(db, deps, {
            budgetId: input.budgetId,
            from,
            to,
            date,
            today: input.today,
          });
        } catch (error) {
          if (!(error instanceof AppError) || error.code !== "FX_RATE_UNAVAILABLE") throw error;
        }
      }
    }
  }
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
  // Rates this request fetched but hasn't written yet (`deferFxCacheWrites`).
  for (const r of deferred.getStore() ?? []) {
    if (r.date === date && (pair.includes(r.base) || pair.includes(r.quote))) rows.push(r);
  }
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

type FxRateRow = typeof fxRate.$inferInsert & { rateDate: string; rate: string };

/** A write request's fetched rates, held until its transaction ends (`deferFxCacheWrites`). */
const deferred = new AsyncLocalStorage<FxRateRow[]>();

/**
 * Runs a write request's transaction (`inRequestTransaction`) with the rates it fetches kept out of
 * it: they're written to the cache on `db` (the pool, not the transaction) once the
 * transaction has ended, committed or not. Writing them inside it would hold the new `fx_rate` rows
 * locked until the request finishes, so another request caching the same rate waits on it, and a
 * rolled-back request would lose them. Until then, lookups in the request see them.
 */
export async function deferFxCacheWrites<T>(db: Db, run: () => Promise<T>): Promise<T> {
  const rows: FxRateRow[] = [];
  try {
    return await deferred.run(rows, run);
  } finally {
    if (rows.length > 0) {
      try {
        // One statement takes 65,534 parameters at most (7 per row); a long import fetches more.
        for (let i = 0; i < rows.length; i += 5000) {
          await db
            .insert(fxRate)
            .values(rows.slice(i, i + 5000))
            .onConflictDoNothing();
        }
      } catch (error) {
        log.warn("Couldn't cache fetched FX rates", { count: rows.length }, error);
      }
    }
  }
}

/**
 * A fetch another request started and this one joined: its rows go into this request's deferred
 * writes too, so its later lookups see them.
 */
function holdShared(rows: FxRateRow[]) {
  const held = deferred.getStore();
  if (held && rows[0] && !held.includes(rows[0])) held.push(...rows);
}

/** Stores fetched rates: now, or when the request's transaction ends (`deferFxCacheWrites`). */
async function cacheRates(db: Db, rows: FxRateRow[]) {
  const held = deferred.getStore();
  if (held) held.push(...rows);
  else await db.insert(fxRate).values(rows).onConflictDoNothing();
}

/**
 * A write fetches its rates before it changes anything, so a slow provider doesn't keep rows
 * locked that other requests wait on. Logs a fetch that comes after one (a
 * transaction with an id has written or locked rows).
 */
async function warnIfHoldingLocks(db: Db, lookup: { base: string; date: string }) {
  if (!deferred.getStore()) return;
  const [row] = await db.execute<{ held: boolean }>(
    sql`select pg_current_xact_id_if_assigned() is not null as held`,
  );
  if (row?.held) log.warn("FX rate fetched while the request holds row locks", lookup);
}

const RECENT_TTL_MS = 60 * 60 * 1000;
/** Recent (unsettled) dates each provider was asked lately: which day's cached rates answered. */
const recentFetches = new WeakMap<FxProvider, Map<string, { at: number; rateDate: string }>>();
/** Fetches in progress, so identical concurrent lookups share one request. */
const inFlight = new WeakMap<FxProvider, Map<string, Promise<FetchedRates | null>>>();
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

interface FetchedRates extends FxRates {
  /** The cache rows for the answer (`cacheRates`). */
  rows: FxRateRow[];
}

/** One provider's rates from `base` on `date`, stored in the cache; null when it has none. */
function fetchOnce(
  db: Db,
  provider: FxProvider,
  date: string,
  base: CurrencyCode,
  settled: boolean,
): Promise<FetchedRates | null> {
  const pending = inFlight.get(provider) ?? new Map<string, Promise<FetchedRates | null>>();
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

  const run = (async (): Promise<FetchedRates | null> => {
    let fetched: FxRates | null;
    await warnIfHoldingLocks(db, { base, date });
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
    const rows = [...dates].flatMap((d) =>
      quotes.map(([quote, rate]) => ({
        id: newId(),
        date: d,
        rateDate,
        base,
        quote,
        rate,
        source: provider.name,
      })),
    );
    await cacheRates(db, rows);
    return { date: rateDate, rates, rows };
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
