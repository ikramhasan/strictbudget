import { describe, expect, it } from "vitest";
import { evaluateAmount } from "./amount-expression";
import { MoneyParseError } from "./errors";

const usd = (input: string) => evaluateAmount(input, "USD", "comma_dot").amount;

describe("evaluateAmount", () => {
  it("reads a plain number like parseAmount", () => {
    expect(usd("1,234.56")).toBe(123456n);
    expect(usd("-5")).toBe(-500n);
    expect(() => usd("12.345")).toThrow(MoneyParseError);
  });

  it("adds, subtracts, multiplies and divides", () => {
    expect(usd("230+30")).toBe(26000n);
    expect(usd("100 - 20.50")).toBe(7950n);
    expect(usd("12.50*3")).toBe(3750n);
    expect(usd("(100-20)/4")).toBe(2000n);
    expect(usd("2+3*4")).toBe(1400n);
    expect(usd("-(10+5)")).toBe(-1500n);
  });

  it("takes x (and × ÷) for multiply and divide", () => {
    expect(evaluateAmount("12.50x3", "USD", "comma_dot").amount).toBe(3750n);
    expect(evaluateAmount("12.50X3", "USD", "comma_dot").amount).toBe(3750n);
    expect(evaluateAmount("10×2", "USD", "comma_dot").amount).toBe(2000n);
    expect(evaluateAmount("10÷4", "USD", "comma_dot").amount).toBe(250n);
  });

  it("is exact until the end, then rounds half away from zero", () => {
    // 0.1 + 0.2 is exactly 0.3; no float drift.
    expect(usd("0.1+0.2")).toBe(30n);
    expect(usd("10/3")).toBe(333n);
    expect(usd("0.125*1")).toBe(13n);
    expect(usd("-0.125*1")).toBe(-13n);
    expect(usd("1/3*3")).toBe(100n);
  });

  it("follows the budget's number format", () => {
    expect(evaluateAmount("1.234,50+0,50", "EUR", "dot_comma").amount).toBe(123500n);
    expect(evaluateAmount("1 000+1", "EUR", "space_comma").amount).toBe(100100n);
    expect(evaluateAmount("1000/3", "JPY", "comma_dot").amount).toBe(333n);
  });

  it("rejects input it can't evaluate", () => {
    for (const bad of ["5+", "5/0", "(5+1", "5+*2", "abc+1", "5)"]) {
      expect(() => usd(bad), bad).toThrow(MoneyParseError);
    }
  });
});
