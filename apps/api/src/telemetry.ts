import { metrics } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { Jobs } from "./lib/jobs";

/**
 * OpenTelemetry, configured entirely by the standard `OTEL_*` variables (any OTLP backend: a
 * collector, Grafana, Honeycomb, Sentry's OTLP endpoint; or `OTEL_METRICS_EXPORTER=prometheus` for
 * a scrape endpoint on its own port, 9464 by default). Nothing starts unless one is set, so a
 * deployment that sets none runs without it and logs to stdout only.
 */
export function telemetryConfigured(env: Record<string, string | undefined> = process.env) {
  if (env.OTEL_SDK_DISABLED === "true") return false;
  const endpoints = ["", "_TRACES", "_METRICS", "_LOGS"].some(
    (signal) => env[`OTEL_EXPORTER_OTLP${signal}_ENDPOINT`],
  );
  const exporters = ["TRACES", "METRICS", "LOGS"].some((signal) => {
    const value = env[`OTEL_${signal}_EXPORTER`];
    return value !== undefined && value !== "" && value !== "none";
  });
  return endpoints || exporters;
}

export function startTelemetry(serviceName: string): { shutdown: () => Promise<void> } {
  if (!telemetryConfigured()) return { shutdown: async () => {} };
  const sdk = new NodeSDK({ serviceName: process.env.OTEL_SERVICE_NAME ?? serviceName });
  sdk.start();
  return { shutdown: () => sdk.shutdown() };
}

/** Job queue gauges (queued, active, deferred, failed per queue), read when metrics are collected. */
export function observeJobs(jobs: Jobs) {
  if (!telemetryConfigured()) return;
  const meter = metrics.getMeter("strictbudget");
  const gauges = {
    queued: meter.createObservableGauge("strictbudget.jobs.queued", {
      description: "Jobs waiting to run, per queue",
    }),
    active: meter.createObservableGauge("strictbudget.jobs.active", {
      description: "Jobs running, per queue",
    }),
    deferred: meter.createObservableGauge("strictbudget.jobs.deferred", {
      description: "Jobs waiting for a later start (retries, scheduled), per queue",
    }),
    failed: meter.createObservableGauge("strictbudget.jobs.failed", {
      description: "Jobs that failed every retry and are still kept, per queue",
    }),
  };
  meter.addBatchObservableCallback(async (result) => {
    for (const queue of await jobs.counts()) {
      const attributes = { queue: queue.name };
      result.observe(gauges.queued, queue.queued, attributes);
      result.observe(gauges.active, queue.active, attributes);
      result.observe(gauges.deferred, queue.deferred, attributes);
      result.observe(gauges.failed, queue.failed, attributes);
    }
  }, Object.values(gauges));
}
