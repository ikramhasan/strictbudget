import { sql } from "@strictbudget/db";
import type { PgTable } from "drizzle-orm/pg-core";
import { AppError } from "./errors";
import type { Db } from "./ledger";

/**
 * Returns `ids` without `movingId`, with `movingId` inserted before `beforeId` (or at the end
 * when `beforeId` is null). `beforeId` must be one of `ids`.
 */
export function reorder(ids: readonly string[], movingId: string, beforeId: string | null) {
  if (beforeId === movingId) return [...ids];
  const rest = ids.filter((id) => id !== movingId);
  if (beforeId === null) return [...rest, movingId];
  const at = rest.indexOf(beforeId);
  if (at === -1) {
    throw new AppError(400, "BAD_REQUEST", "The position to move to isn't in that list");
  }
  return [...rest.slice(0, at), movingId, ...rest.slice(at)];
}

/**
 * Sets `column` (default `sort_order`) to each id's index in `ids`, in one statement. The table
 * needs an `id` column and that one.
 */
export async function writeOrder(
  db: Db,
  table: PgTable,
  ids: readonly string[],
  column: "sort_order" | "starred_sort_order" = "sort_order",
) {
  if (ids.length === 0) return;
  const values = sql.join(
    ids.map((id, i) => sql`(${id}, ${i}::int)`),
    sql`, `,
  );
  await db.execute(
    sql`update ${table} set ${sql.identifier(column)} = v.sort_order from (values ${values}) as v(id, sort_order) where ${table}.id = v.id`,
  );
}
