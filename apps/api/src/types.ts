import type { Database } from "@strictbudget/db";
import type { AnyTextAdapter } from "@tanstack/ai";
import type { Env } from "./env";
import type { WebResearch } from "./lib/ai/web";
import type { Auth } from "./lib/auth";
import type { ChangeBus } from "./lib/change-bus";
import type { EmailSender } from "./lib/email/sender";
import type { ExternalClient } from "./lib/external-import/client";
import type { FxProvider } from "./lib/fx/providers";
import type { Jobs } from "./lib/jobs";
import type { ObjectStorage } from "./lib/storage";

/** Everything a request handler may need. Injected once in createApp; read via c.var.deps. */
export interface AppDeps {
  db: Database;
  env: Env;
  auth: Auth;
  /** Budget change notifications for live updates (`GET …/events`). */
  changes: ChangeBus;
  /**
   * Sends an email now. Request code queues emails instead (`deliverEmail`); the worker calls this.
   * Null when the server sends no email (`createEmailSender`).
   */
  email: EmailSender | null;
  jobs: Jobs;
  /** Exchange-rate providers, tried in order (tests use an in-memory fake). */
  fxProviders: FxProvider[];
  /** Where transaction attachments are kept; null turns attachments off (`createStorage`). */
  storage: ObjectStorage | null;
  /**
   * The server's date (YYYY-MM-DD) that a user's `today` is held near before it enters scheduled
   * transactions; null leaves it unbounded. Defaults to the real UTC date (tests set their own).
   */
  serverDate?: () => string | null;
  /** The importer's client for the source app's API; tests pass one over a fake `fetch`. */
  externalPlans?: ExternalClient;
  /**
   * The model behind the in-app AI assistant. Unset, it's Claude through the Anthropic adapter
   * (`AI_API_KEY`, `AI_MODEL`); tests pass TanStack AI's scripted `fakeText()`.
   */
  aiAdapter?: AnyTextAdapter;
  /** The assistant's web search; null without one (`createWebResearch`). Tests pass a fake. */
  web: WebResearch | null;
}

export type AppEnv = {
  Variables: {
    deps: AppDeps;
    requestId: string;
  };
};
