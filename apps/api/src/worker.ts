import { parseEnv } from "./env";
import { log } from "./lib/log";
import { loadRootEnv } from "./load-env";
import { createRuntime } from "./runtime";
import { startTelemetry } from "./telemetry";

/**
 * Runs background jobs without serving HTTP, for deployments that set `JOBS_MODE=api` on the API
 * and run this as its own process.
 */
if (process.env.NODE_ENV !== "production") loadRootEnv();

const telemetry = startTelemetry("strictbudget-worker");
const runtime = await createRuntime(parseEnv(), { worker: true });
log.info("strictbudget worker running");

async function shutdown(signal: string) {
  log.info("Shutting down", { signal });
  await runtime.close();
  await telemetry.shutdown();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
