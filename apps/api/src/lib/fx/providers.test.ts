import { describe, expect, it } from "vitest";
import { CurrencyApiProvider, FrankfurterProvider } from "./providers";

// Bodies recorded from the real services (trimmed), so no test touches the network.
const FRANKFURTER_2024_03_02 =
  '{"amount":1.0,"base":"EUR","date":"2024-03-01","rates":{"GBP":0.85588,"JPY":162.82,"USD":1.0813}}';
const CURRENCY_API_2024_03_06 = `{
	"date": "2024-03-06",
	"usd": {
		"$myro": 3.31060208,
		"1inch": 1.85497387,
		"bdt": 109.75151115,
		"eur": 0.92167024,
		"gbp": 0.78765532,
		"jpy": 149.97452911,
		"usd": 1
	}
}`;

function fakeFetch(answers: Record<string, Response | Error>) {
  const urls: string[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    urls.push(url);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const answer = answers[url] ?? new Response('{"message":"not found"}', { status: 404 });
    if (answer instanceof Error) throw answer;
    return answer.clone();
  }) as typeof globalThis.fetch;
  return { fetch, urls };
}

describe("FrankfurterProvider", () => {
  it("asks v1 for the date and base, and returns the business day's exact rates", async () => {
    const { fetch, urls } = fakeFetch({
      "https://api.frankfurter.dev/v1/2024-03-02?base=EUR": new Response(FRANKFURTER_2024_03_02),
    });
    const rates = await new FrankfurterProvider({ fetch }).fetchRates("2024-03-02", "EUR", []);
    expect(rates).toEqual({
      date: "2024-03-01",
      rates: { GBP: "0.85588", JPY: "162.82", USD: "1.0813" },
    });
    expect(urls).toEqual(["https://api.frankfurter.dev/v1/2024-03-02?base=EUR"]);
  });

  it("passes wanted symbols along", async () => {
    const { fetch, urls } = fakeFetch({});
    await new FrankfurterProvider({ fetch }).fetchRates("2024-03-02", "EUR", ["USD", "GBP"]);
    expect(urls).toEqual(["https://api.frankfurter.dev/v1/2024-03-02?base=EUR&symbols=USD%2CGBP"]);
  });

  it("returns null for a currency or date it doesn't cover, and throws on server errors", async () => {
    const provider = new FrankfurterProvider({
      fetch: fakeFetch({
        "https://api.frankfurter.dev/v1/2024-03-02?base=USD": new Response("oops", { status: 503 }),
      }).fetch,
    });
    expect(await provider.fetchRates("2024-03-02", "BDT", [])).toBeNull();
    await expect(provider.fetchRates("2024-03-02", "USD", [])).rejects.toThrow("503");
  });
});

describe("CurrencyApiProvider", () => {
  const [JSDELIVR, PAGES] = CurrencyApiProvider.urls("2024-03-06", "USD");

  it("uses the documented jsDelivr and Cloudflare Pages URLs", () => {
    expect([JSDELIVR, PAGES]).toEqual([
      "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@2024-03-06/v1/currencies/usd.json",
      "https://2024-03-06.currency-api.pages.dev/v1/currencies/usd.json",
    ]);
  });

  it("reads the lower-case body, dropping tokens and the base itself", async () => {
    const { fetch } = fakeFetch({ [JSDELIVR as string]: new Response(CURRENCY_API_2024_03_06) });
    expect(await new CurrencyApiProvider({ fetch }).fetchRates("2024-03-06", "USD", [])).toEqual({
      date: "2024-03-06",
      rates: { BDT: "109.75151115", EUR: "0.92167024", GBP: "0.78765532", JPY: "149.97452911" },
    });
  });

  it("keeps only the wanted quotes when asked", async () => {
    const { fetch } = fakeFetch({ [JSDELIVR as string]: new Response(CURRENCY_API_2024_03_06) });
    const rates = await new CurrencyApiProvider({ fetch }).fetchRates("2024-03-06", "USD", ["EUR"]);
    expect(rates?.rates).toEqual({ EUR: "0.92167024" });
  });

  it("falls back to Cloudflare Pages when jsDelivr fails", async () => {
    const { fetch, urls } = fakeFetch({
      [JSDELIVR as string]: new Error("network down"),
      [PAGES as string]: new Response(CURRENCY_API_2024_03_06),
    });
    const rates = await new CurrencyApiProvider({ fetch }).fetchRates("2024-03-06", "USD", []);
    expect(rates?.rates.EUR).toBe("0.92167024");
    expect(urls).toEqual([JSDELIVR, PAGES]);
  });

  it("returns null for a date with no file, and throws when both hosts fail", async () => {
    expect(
      await new CurrencyApiProvider({ fetch: fakeFetch({}).fetch }).fetchRates(
        "2024-03-06",
        "USD",
        [],
      ),
    ).toBeNull();
    const down = fakeFetch({
      [JSDELIVR as string]: new Response("", { status: 502 }),
      [PAGES as string]: new Error("network down"),
    });
    await expect(
      new CurrencyApiProvider({ fetch: down.fetch }).fetchRates("2024-03-06", "USD", []),
    ).rejects.toThrow("network down");
  });
});
