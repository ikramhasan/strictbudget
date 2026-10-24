import { z } from "@hono/zod-openapi";
import { RATE_SCALE } from "@strictbudget/engine";

/** An FX rate on the wire: a positive decimal string, never a float. */
export const zFxRate = z
  .string()
  .regex(
    new RegExp(`^\\d+(\\.\\d{1,${RATE_SCALE}})?$`),
    `Expected a decimal rate with at most ${RATE_SCALE} decimals`,
  )
  .refine((s) => /[1-9]/.test(s), "The rate must be greater than zero")
  .openapi({ example: "1.0842" });
