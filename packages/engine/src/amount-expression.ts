import { type CurrencyCode, currencyExponent } from "./currency";
import { MoneyParseError } from "./errors";
import { parseAmount } from "./format-amount";
import { NUMBER_FORMAT_SPECS, type NumberFormat } from "./format-settings";
import { type Money, money } from "./money";
import { divideRounded } from "./rounding";

/** An exact fraction; `den` is always positive. */
interface Rational {
  num: bigint;
  den: bigint;
}

const OPERATOR = /[+\-*/()]/;

/**
 * Evaluates what someone typed into an amount field: "230+30", "12.50*3",
 * "(100-20)/4". Numbers use the budget's number format. The math is exact (fractions of
 * bigints) and the result is rounded once, half away from zero, to the currency's minor units.
 * A plain number goes through `parseAmount`, so too many decimals is still an error there.
 *
 * Hand-written on purpose (see CLAUDE.md on libraries): expression libraries such as mathjs or
 * expr-eval compute in floats, which breaks the money invariant; the exact ones (bignumber or
 * fraction modes) are large for four operators and still need the budget's number format parsed
 * first. This is a small recursive-descent parser over bigint fractions.
 */
export function evaluateAmount(
  input: string,
  currency: CurrencyCode,
  numberFormat: NumberFormat,
): Money {
  const spec = NUMBER_FORMAT_SPECS[numberFormat];
  // "x", "×" and "÷" read as "*" and "/".
  let normalized = input
    .replace(spec.groupInput, "")
    .replace(/\s/g, "")
    .replace(/[x×]/gi, "*")
    .replace(/÷/g, "/");
  if (spec.decimal === ",") normalized = normalized.replaceAll(",", ".");
  // A lone leading sign is still a plain number.
  if (!OPERATOR.test(normalized.replace(/^[+-]/, ""))) {
    return parseAmount(input, currency, numberFormat);
  }

  const parser = new Parser(normalized, input);
  const value = parser.parse();
  const scale = 10n ** BigInt(currencyExponent(currency));
  return money(divideRounded(value.num * scale, value.den, "half-up"), currency);
}

/** Recursive descent over `expr := term (('+'|'-') term)*`, `term := factor (('*'|'/') factor)*`. */
class Parser {
  private pos = 0;

  constructor(
    private readonly text: string,
    private readonly original: string,
  ) {}

  parse(): Rational {
    const value = this.expression();
    if (this.pos < this.text.length) this.fail(`unexpected "${this.text[this.pos]}"`);
    return value;
  }

  private expression(): Rational {
    let value = this.term();
    for (let op = this.peek(); op === "+" || op === "-"; op = this.peek()) {
      this.pos++;
      const right = this.term();
      value = reduce({
        num:
          op === "+"
            ? value.num * right.den + right.num * value.den
            : value.num * right.den - right.num * value.den,
        den: value.den * right.den,
      });
    }
    return value;
  }

  private term(): Rational {
    let value = this.factor();
    for (let op = this.peek(); op === "*" || op === "/"; op = this.peek()) {
      this.pos++;
      const right = this.factor();
      if (op === "*") {
        value = reduce({ num: value.num * right.num, den: value.den * right.den });
      } else {
        if (right.num === 0n) this.fail("division by zero");
        value = reduce({ num: value.num * right.den, den: value.den * right.num });
      }
    }
    return value;
  }

  private factor(): Rational {
    const c = this.peek();
    if (c === "-" || c === "+") {
      this.pos++;
      const inner = this.factor();
      return c === "-" ? { num: -inner.num, den: inner.den } : inner;
    }
    if (c === "(") {
      this.pos++;
      const inner = this.expression();
      if (this.peek() !== ")") this.fail("missing )");
      this.pos++;
      return inner;
    }
    return this.number();
  }

  private number(): Rational {
    const match = /^(\d*)(?:\.(\d*))?/.exec(this.text.slice(this.pos));
    const whole = match?.[1] ?? "";
    const fraction = match?.[2] ?? "";
    if (!match || (whole === "" && fraction === "")) this.fail("expected a number");
    this.pos += match[0].length;
    return reduce({
      num: BigInt(`${whole || "0"}${fraction}`),
      den: 10n ** BigInt(fraction.length),
    });
  }

  private peek() {
    return this.text[this.pos];
  }

  private fail(reason: string): never {
    throw new MoneyParseError(this.original, reason);
  }
}

function reduce(r: Rational): Rational {
  const sign = r.den < 0n ? -1n : 1n;
  const divisor = gcd(r.num < 0n ? -r.num : r.num, r.den < 0n ? -r.den : r.den) || 1n;
  return { num: (sign * r.num) / divisor, den: (sign * r.den) / divisor };
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}
