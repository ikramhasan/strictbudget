import { z } from "@hono/zod-openapi";
import type { AppDeps } from "../types";
import { AppError } from "./errors";
import { serverToday } from "./ledger";

export const IsoDate = z.iso.date().describe("Calendar date, YYYY-MM-DD");

/** `?today=` on routes that return balances or check dates. */
export const TodayQuery = z.object({
  today: IsoDate.optional().describe(
    "The user's today; later transactions are left out of balances. Defaults to the server's " +
      "UTC date.",
  ),
});

export function shiftDay(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The latest date a transaction may have: the user's `today`, but never past the server's UTC
 * date plus a day. Without a `today` it's that UTC date plus a day, since a user in a time zone
 * ahead of UTC (up to +14h) can already be on the next date. Null (tests without a server date,
 * and no `today`) leaves it unbounded.
 */
export function latestTransactionDate(deps: Pick<AppDeps, "serverDate">, today?: string) {
  const server = deps.serverDate ? deps.serverDate() : serverToday();
  const ceiling = server === null ? null : shiftDay(server, 1);
  if (today === undefined) return ceiling;
  return ceiling !== null && ceiling < today ? ceiling : today;
}

/**
 * Refuses a transaction dated after `latest`: a future-dated entry is a scheduled transaction.
 */
export function assertNotFuture(date: string, latest: string | null) {
  if (latest !== null && date > latest) {
    throw new AppError(
      400,
      "DATE_IN_FUTURE",
      "A transaction's date can't be in the future; make it a scheduled transaction instead",
    );
  }
}
