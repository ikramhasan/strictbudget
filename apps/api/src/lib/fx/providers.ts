import type { FxRateSource } from "@strictbudget/db/schema";
import { type CurrencyCode, isCurrencyCode, parseJsonRates } from "@strictbudget/engine";

/** One provider answer: "1 base = rates[quote] quote", as 12-decimal strings. */
export interface FxRates {
  /** The rate's own date: the latest business day on or before the requested date. */
  date: string;
  rates: Partial<Record<CurrencyCode, string>>;
}

export interface FxProvider {
  readonly name: FxRateSource;
  /**
   * Rates from `base` on `date`. `quotes` lists the currencies wanted; an empty list asks for
   * every currency the provider has (one fetch then serves many lookups). Null when the provider
   * has nothing for that base or date; throws on network and HTTP errors.
   */
  fetchRates(date: string, base: CurrencyCode, quotes: CurrencyCode[]): Promise<FxRates | null>;
}

type Fetch = typeof fetch;

export interface HttpProviderOptions {
  fetch?: Fetch;
  /** Per request, in milliseconds. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

/** Only real ISO codes (not the base itself), and only the wanted ones when `quotes` is given. */
function keepRates(
  rates: Record<string, string>,
  base: CurrencyCode,
  quotes: CurrencyCode[],
): Partial<Record<CurrencyCode, string>> {
  const wanted = quotes.length > 0 ? new Set<string>(quotes) : null;
  const kept: Partial<Record<CurrencyCode, string>> = {};
  for (const [code, rate] of Object.entries(rates)) {
    if (code === base || !isCurrencyCode(code) || (wanted && !wanted.has(code))) continue;
    kept[code] = rate;
  }
  return kept;
}

/**
 * Frankfurter (frankfurter.dev): European Central Bank reference rates, about 30 currencies,
 * working days back to 1999, no key. The v1 endpoint answers a date with the latest working day
 * on or before it, and 404s for a currency or date it doesn't cover.
 */
export class FrankfurterProvider implements FxProvider {
  readonly name = "frankfurter" as const;
  private readonly fetch: Fetch;
  private readonly timeoutMs: number;
  private readonly baseUrl = "https://api.frankfurter.dev/v1";

  constructor(options: HttpProviderOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async fetchRates(date: string, base: CurrencyCode, quotes: CurrencyCode[]) {
    const url = new URL(`${this.baseUrl}/${date}`);
    url.searchParams.set("base", base);
    if (quotes.length > 0) url.searchParams.set("symbols", quotes.join(","));
    const res = await this.fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (res.status === 404 || res.status === 422) return null;
    if (!res.ok) throw new Error(`Frankfurter answered ${res.status}`);
    const body = parseJsonRates(await res.text(), "rates");
    if (!body.date) throw new Error("Frankfurter answered without a date");
    return { date: body.date, rates: keepRates(body.rates, base, quotes) };
  }
}

/**
 * fawazahmed0's exchange-api ("currency-api", CC0): 200+ currencies (crypto too, which we drop),
 * daily since 2024-03-02, served as static files from jsDelivr with a Cloudflare Pages mirror as
 * the documented fallback. Keys are lower-case codes. A date it has no file for (before 2024-03-02,
 * or today before the day's file is out) 404s.
 */
export class CurrencyApiProvider implements FxProvider {
  readonly name = "currency-api" as const;
  private readonly fetch: Fetch;
  private readonly timeoutMs: number;

  constructor(options: HttpProviderOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  static urls(date: string, base: CurrencyCode): string[] {
    const file = `v1/currencies/${base.toLowerCase()}.json`;
    return [
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/${file}`,
      `https://${date}.currency-api.pages.dev/${file}`,
    ];
  }

  async fetchRates(date: string, base: CurrencyCode, quotes: CurrencyCode[]) {
    let lastError: unknown = null;
    let missing = false;
    for (const url of CurrencyApiProvider.urls(date, base)) {
      try {
        const res = await this.fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
        if (res.status === 404) {
          missing = true;
          continue;
        }
        if (!res.ok) throw new Error(`currency-api answered ${res.status}`);
        const body = parseJsonRates(await res.text(), base.toLowerCase());
        return { date: body.date ?? date, rates: keepRates(body.rates, base, quotes) };
      } catch (error) {
        lastError = error;
      }
    }
    if (missing) return null;
    throw lastError instanceof Error ? lastError : new Error("currency-api failed");
  }
}

/** The providers production uses, in the order they're tried. */
export function defaultFxProviders(options: HttpProviderOptions = {}): FxProvider[] {
  return [new FrankfurterProvider(options), new CurrencyApiProvider(options)];
}
