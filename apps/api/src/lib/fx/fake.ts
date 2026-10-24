import type { FxRateSource } from "@strictbudget/db/schema";
import type { CurrencyCode } from "@strictbudget/engine";
import { forgetFxFailures } from ".";
import type { FxProvider, FxRates } from "./providers";

/**
 * An in-memory provider for tests: rates seeded per (date, base), answered like a real provider
 * (the latest seeded date on or before the requested one). Records every call.
 */
export class FakeFxProvider implements FxProvider {
  readonly calls: { date: string; base: CurrencyCode; quotes: CurrencyCode[] }[] = [];
  /** When set, every call throws (a provider that's down). */
  failing = false;
  private readonly table = new Map<string, Map<string, Partial<Record<CurrencyCode, string>>>>();
  private gate: Promise<void> | null = null;

  constructor(readonly name: FxRateSource = "frankfurter") {}

  /** Forgets every seeded rate and call, and comes back up. */
  reset(): this {
    this.table.clear();
    this.calls.length = 0;
    this.failing = false;
    this.gate = null;
    forgetFxFailures(this);
    return this;
  }

  /** Makes calls wait until the returned function is called (a slow provider). */
  hold(): () => void {
    let release = () => {};
    this.gate = new Promise((resolve) => {
      release = resolve;
    });
    return () => {
      this.gate = null;
      release();
    };
  }

  /** "1 base = rates[quote] quote" on `date`. */
  seed(date: string, base: CurrencyCode, rates: Partial<Record<CurrencyCode, string>>): this {
    const byBase = this.table.get(base) ?? new Map();
    byBase.set(date, { ...byBase.get(date), ...rates });
    this.table.set(base, byBase);
    return this;
  }

  async fetchRates(date: string, base: CurrencyCode, quotes: CurrencyCode[]) {
    this.calls.push({ date, base, quotes });
    if (this.gate) await this.gate;
    if (this.failing) throw new Error(`${this.name} is down`);
    const byBase = this.table.get(base);
    if (!byBase) return null;
    const found = [...byBase.keys()]
      .filter((d) => d <= date)
      .sort()
      .at(-1);
    if (!found) return null;
    const rates = { ...byBase.get(found) };
    if (quotes.length > 0) {
      for (const code of Object.keys(rates) as CurrencyCode[]) {
        if (!quotes.includes(code)) delete rates[code];
      }
    }
    return { date: found, rates } satisfies FxRates;
  }
}
