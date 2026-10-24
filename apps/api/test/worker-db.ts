import { availableParallelism } from "node:os";

/** How many test files run at once; each worker has a database of its own. */
export const TEST_WORKERS = Math.max(
  1,
  Math.min(Number(process.env.API_TEST_WORKERS) || availableParallelism() - 1, 8),
);

/** `url` with the database renamed for one worker (`strictbudget_test` → `strictbudget_test_w3`). */
export function workerDatabaseUrl(url: string, worker: number): string {
  const u = new URL(url);
  u.pathname = `${u.pathname}_w${worker}`;
  return u.toString();
}
