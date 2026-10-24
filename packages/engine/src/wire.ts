import { z } from "zod";
import { CURRENCY_CODES, type CurrencyCode } from "./currency";
import { type Money, money } from "./money";

export const zCurrencyCode = z
  .enum(CURRENCY_CODES)
  .describe("ISO 4217 currency code")
  .meta({ id: "CurrencyCode" });

/** Integer amount in minor units, as a string (JSON numbers cannot hold every bigint). */
export const zMinorUnits = z
  .string()
  .regex(/^(0|-?[1-9]\d*)$/, "Expected an integer amount in minor units, as a string")
  .describe("Amount in the currency's minor units (e.g. cents), as an integer string");

export const zMoney = z.object({ amount: zMinorUnits, currency: zCurrencyCode });

export interface MoneyWire {
  amount: string;
  currency: CurrencyCode;
}

export function toWire(m: Money): MoneyWire {
  return { amount: m.amount.toString(), currency: m.currency };
}

export function fromWire(wire: MoneyWire): Money {
  return money(BigInt(zMinorUnits.parse(wire.amount)), wire.currency);
}
