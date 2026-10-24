import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { parseEnv } from "./env";
import { log } from "./lib/log";
import { loadRootEnv } from "./load-env";
import { createRuntime } from "./runtime";
import { startTelemetry } from "./telemetry";

if (process.env.NODE_ENV !== "production") loadRootEnv();

const env = parseEnv();
const telemetry = startTelemetry("strictbudget-api");
const runtime = await createRuntime(env, { worker: env.JOBS_MODE === "all" });
const app = createApp(runtime.deps);

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  log.info(`strictbudget API on http://localhost:${info.port} — docs at /docs`, {
    port: info.port,
  });
});

function shutdown(signal: string) {
  log.info("Shutting down", { signal });
  server.close(async () => {
    await runtime.close();
    await telemetry.shutdown();
    process.exit(0);
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
