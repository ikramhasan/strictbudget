import { createDb } from "@strictbudget/db";
import type { Env } from "./env";
import { createWebResearch } from "./lib/ai/web";
import { createAuth } from "./lib/auth";
import { ChangeBus } from "./lib/change-bus";
import { QueuedEmailSender } from "./lib/email/queue";
import { createEmailSender } from "./lib/email/sender";
import { defaultFxProviders } from "./lib/fx/providers";
import { Jobs } from "./lib/jobs";
import { jobHandlers } from "./lib/jobs/handlers";
import { createStorage } from "./lib/storage";
import { observeJobs } from "./telemetry";
import type { AppDeps } from "./types";

/**
 * Wires the app's dependencies for a server or worker process. `worker` runs background jobs in
 * this process. Resolves once the job queue is connected.
 */
export async function createRuntime(env: Env, { worker }: { worker: boolean }) {
  const { db, listen, close: closeDb } = createDb(env.DATABASE_URL);
  const jobs = new Jobs(env.DATABASE_URL, { worker });
  await jobs.start();
  const email = createEmailSender(env, db);
  const deps: AppDeps = {
    db,
    env,
    email,
    jobs,
    // Better Auth's emails are queued like every other, so a failed send is retried.
    auth: createAuth(db, env, email && new QueuedEmailSender(jobs, db, env)),
    changes: new ChangeBus(listen),
    fxProviders: defaultFxProviders(),
    storage: createStorage(env),
    web: createWebResearch(env),
  };
  if (worker) {
    await jobs.work(jobHandlers, deps);
    observeJobs(jobs);
  }
  return {
    deps,
    close: async () => {
      await jobs.stop();
      await closeDb();
    },
  };
}
