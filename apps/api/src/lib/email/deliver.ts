import type { AppDeps } from "../../types";
import { enqueueEmail } from "./queue";
import type { EmailMessage } from "./sender";

/**
 * Queues an email from a request handler, in the request's transaction when it has one: the
 * worker sends it and retries a failed send.
 */
export async function deliverEmail(deps: AppDeps, message: EmailMessage) {
  await enqueueEmail(deps.jobs, deps.db, deps.env, message);
}
