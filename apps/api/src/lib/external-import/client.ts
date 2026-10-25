import { AppError } from "../errors";
import {
  type ExternalPlan,
  ExternalPlanSchema,
  type ExternalPlanSummary,
  ExternalPlanSummarySchema,
} from "./types";

/**
 * Reads plans from the source's API with the user's personal access token.
 * The token is used for the request it came with and never stored or logged.
 */
export interface ExternalClient {
  listPlans(token: string): Promise<ExternalPlanSummary[]>;
  getPlan(token: string, planId: string): Promise<ExternalPlan>;
}

const BASE = "https://api.ynab.com/v1";

/** The source's error answers as ours: a bad token, a plan that isn't there, the hourly limit. */
function failure(status: number): AppError {
  if (status === 401 || status === 403) {
    return new AppError(
      400,
      "EXTERNAL_TOKEN_INVALID",
      "YNAB didn't accept that personal access token. Check it and try again.",
    );
  }
  if (status === 404) return new AppError(404, "EXTERNAL_PLAN_NOT_FOUND", "YNAB has no such plan");
  if (status === 429) {
    return new AppError(
      429,
      "EXTERNAL_RATE_LIMITED",
      "YNAB allows 200 requests an hour per token. Try again later.",
    );
  }
  return new AppError(502, "EXTERNAL_UNAVAILABLE", `YNAB answered ${status}. Try again later.`);
}

async function get<T>(fetcher: typeof fetch, token: string, path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetcher(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
  } catch {
    throw new AppError(502, "EXTERNAL_UNAVAILABLE", "Couldn't reach YNAB. Try again later.");
  }
  if (!res.ok) throw failure(res.status);
  return ((await res.json()) as { data: T }).data;
}

/** The source's answer, checked: a shape the importer doesn't know is refused, not guessed at. */
export function checked<T>(
  schema: { safeParse(v: unknown): { success: boolean; data?: T } },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success || result.data === undefined) {
    throw new AppError(
      502,
      "EXTERNAL_UNEXPECTED",
      "YNAB's answer wasn't in the shape strictbudget reads",
    );
  }
  return result.data;
}

export function httpExternalClient(fetcher: typeof fetch = fetch): ExternalClient {
  return {
    async listPlans(token) {
      const data = await get<{ budgets: unknown }>(fetcher, token, "/budgets");
      return checked(ExternalPlanSummarySchema.array(), data.budgets);
    },
    async getPlan(token, planId) {
      const data = await get<{ budget: unknown }>(
        fetcher,
        token,
        `/budgets/${encodeURIComponent(planId)}`,
      );
      return checked(ExternalPlanSchema, data.budget);
    },
  };
}
