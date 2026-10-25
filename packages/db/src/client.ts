import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export interface CreateDbOptions {
  /** Default 10. */
  max?: number;
}

/**
 * Creates a Drizzle client. postgres.js connects lazily, so this never touches the network
 * until the first query (the OpenAPI emit script relies on that).
 */
export function createDb(url: string, { max = 10 }: CreateDbOptions = {}) {
  const client = postgres(url, {
    max,
    onnotice: () => {},
    // The app runs short queries; JIT compiling them cost more than it saved (300 ms on a big
    // account's register page against a few ms of execution).
    connection: { jit: "off" },
  });
  const db = drizzle({ client, schema, casing: "snake_case" });
  /**
   * LISTEN on a channel over a connection of its own, which postgres.js reconnects (and
   * re-listens) after a drop. Resolves once listening; `unlisten` stops.
   */
  const listen = (channel: string, onNotify: (payload: string) => void) =>
    client.listen(channel, onNotify).then(({ unlisten }) => ({ unlisten }));
  return { db, listen, close: () => client.end({ timeout: 5 }) };
}

export type Listen = ReturnType<typeof createDb>["listen"];

export type Database = ReturnType<typeof createDb>["db"];
