import { sendQueuedEmail } from "../email/queue";
import { prefetchFxRates } from "../fx";
import { remindInvitations } from "../invitations";
import { purgeStorage } from "../storage/purge";
import { queueMonthlySummaries, sendBudgetSummary } from "../summary/job";
import type { JobHandlers } from "./index";

export const jobHandlers: JobHandlers = {
  "email.send": sendQueuedEmail,
  "invitations.remind": remindInvitations,
  "fx.prefetch": prefetchFxRates,
  "storage.purge": purgeStorage,
  "summaries.monthly": queueMonthlySummaries,
  "summaries.budget": sendBudgetSummary,
};
