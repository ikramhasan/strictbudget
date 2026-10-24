import { apiBaseUrl } from "./api";

/** Most reports one page load sends: a render loop mustn't flood the API. */
const MAX_REPORTS = 5;

/**
 * Sends uncaught errors and unhandled rejections to the API's log (`POST /v1/client-errors`), once
 * per distinct message, so they show with the server's logs and in OpenTelemetry when it's
 * configured. Only the page's path goes along: fragments carry link tokens.
 */
export function startErrorReporting() {
  if (import.meta.env.DEV) return;
  const sent = new Set<string>();
  const report = (error: unknown) => {
    const message = (error instanceof Error ? `${error.name}: ${error.message}` : String(error))
      .slice(0, 1000)
      .trim();
    if (!message || sent.has(message) || sent.size >= MAX_REPORTS) return;
    sent.add(message);
    const stack = error instanceof Error ? error.stack?.slice(0, 8000) : undefined;
    void fetch(`${apiBaseUrl}/v1/client-errors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, stack, path: window.location.pathname }),
      keepalive: true,
    }).catch(() => {});
  };
  window.addEventListener("error", (event) => report(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => report(event.reason));
}
