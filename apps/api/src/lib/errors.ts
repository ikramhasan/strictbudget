import { z } from "@hono/zod-openapi";
import { trace } from "@opentelemetry/api";
import { APIError } from "better-auth/api";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { log } from "./log";

export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "VALIDATION_ERROR" }),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .openapi("Error");

export type ErrorBody = z.infer<typeof ErrorSchema>;

/** Throw from handlers/middleware for expected failures; rendered by onError. */
export class AppError extends Error {
  override name = "AppError";
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function errorBody(code: string, message: string, details?: unknown): ErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

export function jsonError(description: string) {
  return { description, content: { "application/json": { schema: ErrorSchema } } };
}

const STATUS_CODES: Partial<Record<number, string>> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "RATE_LIMITED",
};

export function onError(err: Error, c: Context) {
  if (err instanceof AppError) {
    const retryAfter = (err.details as { retryAfterSeconds?: unknown } | undefined)
      ?.retryAfterSeconds;
    if (err.status === 429 && typeof retryAfter === "number") {
      c.header("Retry-After", String(retryAfter));
    }
    return c.json(errorBody(err.code, err.message, err.details), err.status);
  }
  if (err instanceof APIError) {
    // Thrown by server-side auth.api.* calls (e.g. the organization plugin behind /v1/budgets).
    const body = err.body as { code?: string; message?: string } | undefined;
    const status = err.statusCode as ContentfulStatusCode;
    const code = body?.code ?? STATUS_CODES[status] ?? "HTTP_ERROR";
    return c.json(errorBody(code, body?.message || err.message || "Request failed"), status);
  }
  if (err instanceof HTTPException) {
    const code = STATUS_CODES[err.status] ?? "HTTP_ERROR";
    return c.json(errorBody(code, err.message || "Request failed"), err.status);
  }
  trace.getActiveSpan()?.recordException(err as Error);
  log.error("Unhandled error", { requestId: c.get("requestId") ?? null }, err);
  return c.json(errorBody("INTERNAL_ERROR", "Something went wrong"), 500);
}

export function notFound(c: Context) {
  return c.json(errorBody("NOT_FOUND", `Route ${c.req.method} ${c.req.path} not found`), 404);
}
