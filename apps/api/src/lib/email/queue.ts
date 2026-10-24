import type { Env } from "../../env";
import type { JobHandler, Jobs } from "../jobs";
import type { Db } from "../ledger";
import { log } from "../log";
import { seal, unseal } from "../sealed";
import type { EmailMessage, EmailSender } from "./sender";

const PURPOSE = "email.send";

/**
 * Queues an email for the worker to send, retrying until the provider takes it.
 * Sent on `db`, so an email queued inside a transaction goes out only if it commits. Sealed,
 * because links carry sign-in and reset tokens.
 */
export async function enqueueEmail(
  jobs: Jobs,
  db: Db,
  env: Pick<Env, "BETTER_AUTH_SECRET">,
  message: EmailMessage,
): Promise<void> {
  await jobs.send(db, "email.send", { sealed: seal(message, env.BETTER_AUTH_SECRET, PURPOSE) });
}

/** The `email.send` worker: hands the message to the real sender (throttled, then Resend). */
export const sendQueuedEmail: JobHandler<"email.send"> = async (deps, { sealed }) => {
  let message: EmailMessage;
  try {
    message = unseal<EmailMessage>(sealed, deps.env.BETTER_AUTH_SECRET, PURPOSE);
  } catch (error) {
    // Sealed under another BETTER_AUTH_SECRET (rotated since): no retry can open it.
    log.error("Queued email dropped: it can't be opened with the current secret", {}, error);
    return;
  }
  // Queued before the server stopped sending email: nothing can deliver it now.
  if (!deps.email) {
    log.warn("Queued email dropped: this server sends no email");
    return;
  }
  await deps.email.send(message);
};

/** An `EmailSender` that queues instead of sending, for Better Auth's email callbacks. */
export class QueuedEmailSender implements EmailSender {
  readonly #jobs: Jobs;
  readonly #db: Db;
  readonly #env: Pick<Env, "BETTER_AUTH_SECRET">;

  constructor(jobs: Jobs, db: Db, env: Pick<Env, "BETTER_AUTH_SECRET">) {
    this.#jobs = jobs;
    this.#db = db;
    this.#env = env;
  }

  async send(message: EmailMessage): Promise<void> {
    await enqueueEmail(this.#jobs, this.#db, this.#env, message);
  }
}
