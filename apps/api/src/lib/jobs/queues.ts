import type { BudgetMonth } from "@strictbudget/engine";
import type { QueueOptions } from "pg-boss";

/**
 * Every background queue and its retry and retention policy. `installJobs` creates (or updates)
 * them on deploy, so a queue added here exists before any code sends to it.
 */
export const QUEUES = {
  /** One email, sealed (`lib/sealed.ts`): links carry sign-in and reset tokens. */
  "email.send": {
    retryLimit: 8,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 60 * 60,
    expireInSeconds: 60,
    // Sent emails don't stay around; a failed one is kept a week for inspection, still sealed.
    deleteAfterSeconds: 60,
    retentionSeconds: 7 * 24 * 60 * 60,
  },
  /** Hourly: reminds invitees whose invitation has 3 days left. */
  "invitations.remind": { retryLimit: 3, retryDelay: 60, expireInSeconds: 300 },
  /** Today's exchange rates, fetched ahead of reads. */
  "fx.prefetch": { retryLimit: 2, retryDelay: 300, expireInSeconds: 300 },
  /** Deletes the files of deleted attachments from object storage (`storage_deletion`). */
  "storage.purge": { retryLimit: 3, retryDelay: 60, expireInSeconds: 300 },
  /** Monthly: queues each budget's summary for the month just ended. */
  "summaries.monthly": { retryLimit: 3, retryDelay: 300, expireInSeconds: 600 },
  /** One budget's monthly summary: its numbers, its AI overview, an email to each member. */
  "summaries.budget": {
    retryLimit: 3,
    retryDelay: 300,
    retryBackoff: true,
    expireInSeconds: 600,
  },
} as const satisfies Record<string, QueueOptions>;

export type QueueName = keyof typeof QUEUES;

/** What each queue's jobs carry. */
export interface JobData {
  "email.send": { sealed: string };
  "invitations.remind": null;
  "fx.prefetch": null;
  "storage.purge": null;
  /** `month` is for running it by hand; the schedule sends none and gets last month's. */
  "summaries.monthly": { month?: BudgetMonth } | null;
  "summaries.budget": { budgetId: string; month: BudgetMonth };
}

/** Cron schedules (UTC) the worker keeps; each sends its queue a job. */
export const SCHEDULES: { queue: QueueName; cron: string }[] = [
  { queue: "invitations.remind", cron: "0 * * * *" },
  // Four tries a day: a provider may not have today's rates until later in the day.
  { queue: "fx.prefetch", cron: "0 1,7,13,19 * * *" },
  // A delete queues a run straight away; this catches cascades (an account or budget deleted).
  { queue: "storage.purge", cron: "*/15 * * * *" },
  // The 1st at 14:00 UTC: the month has ended in every time zone (it's 02:00 at UTC−12).
  { queue: "summaries.monthly", cron: "0 14 1 * *" },
];
