import { logs, SeverityNumber } from "@opentelemetry/api-logs";

type Attributes = Record<string, string | number | boolean | null | undefined>;
type Level = "info" | "warn" | "error";

const SEVERITY: Record<Level, SeverityNumber> = {
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

/**
 * The API's log. Production prints one JSON object per line on stdout (any log collector can
 * read it); development prints plain lines. Every record also goes to OpenTelemetry's logs API,
 * which exports it when telemetry is configured (`telemetry.ts`) and drops it otherwise. Never
 * log money amounts, emails, names or tokens: ids and codes only.
 */
function write(level: Level, message: string, attributes: Attributes = {}, error?: unknown) {
  const fields: Attributes = { ...attributes };
  if (error !== undefined) {
    fields["exception.type"] = error instanceof Error ? error.name : typeof error;
    fields["exception.message"] = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && error.stack) fields["exception.stacktrace"] = error.stack;
  }
  logs.getLogger("strictbudget").emit({
    severityNumber: SEVERITY[level],
    severityText: level.toUpperCase(),
    body: message,
    attributes: Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null)),
  });
  if (process.env.NODE_ENV === "production") {
    const line = JSON.stringify({ time: new Date().toISOString(), level, msg: message, ...fields });
    (level === "info" ? process.stdout : process.stderr).write(`${line}\n`);
    return;
  }
  const print = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  const extra = Object.keys(attributes).length > 0 ? [attributes] : [];
  print(message, ...extra, ...(error === undefined ? [] : [error]));
}

export const log = {
  info: (message: string, attributes?: Attributes) => write("info", message, attributes),
  warn: (message: string, attributes?: Attributes, error?: unknown) =>
    write("warn", message, attributes, error),
  error: (message: string, attributes?: Attributes, error?: unknown) =>
    write("error", message, attributes, error),
};
