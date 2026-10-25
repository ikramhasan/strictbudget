import { sql } from "@strictbudget/db";
import { fromDrizzle, type JobOptions, PgBoss } from "pg-boss";
import type { AppDeps } from "../../types";
import type { Db } from "../ledger";
import { log } from "../log";
import { type JobData, QUEUES, type QueueName, SCHEDULES } from "./queues";

export { type JobData, QUEUES, type QueueName } from "./queues";

/** What runs a queue's jobs. Throwing fails the attempt; the queue's policy decides the retry. */
export type JobHandler<Q extends QueueName> = (deps: AppDeps, data: JobData[Q]) => Promise<void>;
export type JobHandlers = { [Q in QueueName]: JobHandler<Q> };

/**
 * A failed attempt, logged: pg-boss records it and retries, but its `error` event is only for
 * its own errors, so without this a failing job leaves no trace in the logs.
 */
function logJobFailure(queue: QueueName, job: { id: string; retryCount: number }, error: unknown) {
  log.error("Job failed", { queue, jobId: job.id, attempt: job.retryCount + 1 }, error);
}

/** The schema pg-boss keeps its tables in, apart from ours. */
export const JOBS_SCHEMA = "pgboss";

export interface JobsOptions {
  /**
   * This process runs jobs and cron schedules (and pg-boss's maintenance). Off for a process that
   * only sends, such as the API when a separate worker runs them, and in tests, which run them on
   * demand with `runQueued`.
   */
  worker: boolean;
  /** Connections in pg-boss's own pool. */
  max?: number;
}

/**
 * Background jobs, kept in PostgreSQL by pg-boss. App code only sees this class, so the queue
 * library can be swapped without touching callers.
 *
 * Jobs are sent through the caller's Drizzle connection: sent inside a transaction (a signed-in
 * write request runs in one), a job exists only if the transaction commits.
 */
export class Jobs {
  readonly #boss: PgBoss;
  readonly #worker: boolean;
  #started: Promise<unknown> | undefined;

  constructor(url: string, { worker, max = 4 }: JobsOptions) {
    this.#worker = worker;
    this.#boss = new PgBoss({
      connectionString: url,
      max,
      schema: JOBS_SCHEMA,
      // The schema and queues are installed on deploy (`installJobs`), never on start.
      migrate: false,
      supervise: worker,
      schedule: worker,
      instanceName: worker ? "worker" : "api",
    });
    this.#boss.on("error", (error) => log.error("Job queue error", {}, error));
  }

  /** Connects (retrying while the database comes up). Sending starts it if nobody has. */
  async start(): Promise<void> {
    this.#started ??= this.#boss.start({ attempts: 5 }).then(async () => {
      const found = new Set((await this.#boss.getQueues(Object.keys(QUEUES))).map((q) => q.name));
      const missing = Object.keys(QUEUES).filter((name) => !found.has(name));
      if (missing.length > 0) {
        throw new Error(
          `Job queues missing (${missing.join(", ")}): run the migrate step first (pnpm db:migrate; in the image, node dist/migrate.mjs)`,
        );
      }
    });
    await this.#started;
  }

  /** Lets in-flight jobs finish (up to 20 s), then closes the pool. */
  async stop(): Promise<void> {
    if (!this.#started) return;
    await this.#started.catch(() => {});
    await this.#boss.stop({ graceful: true, timeout: 20_000 });
  }

  /** Queues a job on `db` (a transaction or the pool). Returns its id, or null if a singleton dropped it. */
  async send<Q extends QueueName>(
    db: Db,
    queue: Q,
    data: JobData[Q],
    options: JobOptions = {},
  ): Promise<string | null> {
    await this.start();
    return this.#boss.send(queue, data, { ...options, db: fromDrizzle(db, sql) });
  }

  /** Runs every queue's jobs in this process and keeps the cron schedules. Only for a worker. */
  async work(handlers: JobHandlers, deps: AppDeps): Promise<void> {
    if (!this.#worker) throw new Error("Jobs.work needs a worker instance");
    for (const { queue, cron } of SCHEDULES) await this.schedule(queue, cron);
    for (const queue of Object.keys(QUEUES) as QueueName[]) {
      const handler = handlers[queue] as JobHandler<QueueName>;
      await this.#boss.work<JobData[QueueName]>(queue, async ([job]) => {
        if (!job) return;
        try {
          await handler(deps, job.data);
        } catch (error) {
          logJobFailure(queue, job, error);
          throw error;
        }
      });
    }
  }

  /** Sends `queue` a job on a cron schedule (UTC), replacing any schedule it had. Only for a worker. */
  async schedule<Q extends QueueName>(queue: Q, cron: string, data?: JobData[Q]): Promise<void> {
    if (!this.#worker) throw new Error("Jobs.schedule needs a worker instance");
    // Runs missed while the app was down (a deploy) catch up with one job when it is back.
    await this.#boss.schedule(queue, cron, data ?? null, { tz: "UTC", missed: "once" });
  }

  /**
   * Runs the jobs that are due now, in this call, until none are left (tests; a handler's
   * follow-up jobs run in the next pass). Returns how many ran.
   */
  async runQueued(handlers: JobHandlers, deps: AppDeps): Promise<number> {
    await this.start();
    let ran = 0;
    for (let pass = 0; pass < 10; pass++) {
      let fetched = 0;
      for (const queue of Object.keys(QUEUES) as QueueName[]) {
        const handler = handlers[queue] as JobHandler<QueueName>;
        const due = await this.#boss.fetch<JobData[QueueName]>(queue, { batchSize: 100 });
        fetched += due.length;
        for (const job of due) {
          try {
            await handler(deps, job.data);
            await this.#boss.complete(queue, job);
          } catch (error) {
            logJobFailure(queue, job, error);
            await this.#boss.fail(queue, job, { message: String(error) });
          }
        }
      }
      if (fetched === 0) break;
      ran += fetched;
    }
    return ran;
  }

  /** Each queue's job counts, for metrics. */
  async counts() {
    await this.start();
    const queues = await this.#boss.getQueues(Object.keys(QUEUES));
    return queues.map((q) => ({
      name: q.name,
      queued: q.queuedCount,
      active: q.activeCount,
      deferred: q.deferredCount,
      failed: q.failedCount,
    }));
  }
}
