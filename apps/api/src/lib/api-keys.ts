/**
 * Personal API keys, on Better Auth's api-key plugin. A key acts as its owner,
 * narrowed by its scope: read-only or read & write, on every budget or a chosen few. Keys reach
 * budget data and GET /v1/me only; account and security routes take a signed-in session
 * (`requireSession`), so a leaked key can't change a password, an email or another key.
 */

/** What a key may do. `budgetIds: null` is every budget the owner belongs to, now or later. */
export interface ApiKeyScope {
  access: "read" | "write";
  budgetIds: string[] | null;
}

/** The key behind a request, as `requireAuth` sets it. */
export interface RequestApiKey extends ApiKeyScope {
  id: string;
}

/** Every key starts with this, so it's recognisable (and findable by secret scanners). */
export const API_KEY_PREFIX = "ec_";
/** Characters of a key stored in the clear (`start`), prefix included, to tell keys apart. */
export const API_KEY_START_LENGTH = 10;
export const API_KEY_NAME_MAX = 50;
/** Longest custom lifetime; "no expiration" is its own choice. */
export const API_KEY_MAX_DAYS = 5 * 365;
/** Requests one key may make per hour (`lib/throttle.ts`). */
export const API_KEY_REQUESTS_PER_HOUR = 500;

/**
 * The scope as the plugin's `permissions` record (a JSON column). `budgets: ["*"]` is every budget.
 */
export function scopeToPermissions(scope: ApiKeyScope): Record<string, string[]> {
  return {
    access: scope.access === "write" ? ["read", "write"] : ["read"],
    budgets: scope.budgetIds ?? ["*"],
  };
}

/** Reads a key's scope back. Anything unexpected comes out as the narrowest scope: no budgets. */
export function permissionsToScope(permissions: unknown): ApiKeyScope {
  const record = (permissions ?? {}) as Record<string, unknown>;
  const access = Array.isArray(record.access) && record.access.includes("write") ? "write" : "read";
  const budgets = Array.isArray(record.budgets)
    ? record.budgets.filter((b): b is string => typeof b === "string")
    : [];
  return { access, budgetIds: budgets.includes("*") ? null : budgets };
}

/**
 * The API key a request carries, if any: `Authorization: Bearer <key>` or `x-api-key: <key>`.
 * Only a bearer token with our prefix counts, so other bearer schemes aren't taken for keys.
 */
export function apiKeyFromHeaders(headers: Headers): string | null {
  const header = headers.get("x-api-key")?.trim();
  if (header) return header;
  const match = /^Bearer\s+(\S+)$/i.exec(headers.get("authorization")?.trim() ?? "");
  const token = match?.[1];
  return token?.startsWith(API_KEY_PREFIX) ? token : null;
}

/** Whether a key may open `budgetId` (budget-scoped routes answer 404 when not, as for non-members). */
export function keyAllowsBudget(key: ApiKeyScope | null, budgetId: string): boolean {
  return key === null || key.budgetIds === null || key.budgetIds.includes(budgetId);
}
