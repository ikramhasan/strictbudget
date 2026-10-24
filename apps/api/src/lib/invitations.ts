import { createHash, randomBytes } from "node:crypto";
import { budgetInvitation, user } from "@strictbudget/db/schema";
import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { enqueueEmail } from "./email/queue";
import { emails, link } from "./email/templates";
import type { JobHandler } from "./jobs";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A fresh link token (returned once, for the email) and its hash (stored). */
export function newInvitationToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export const invitationUrl = (webOrigin: string, token: string) =>
  link(webOrigin, "/invitation", { token });

/** An invitee is reminded this long before their invitation expires. */
export const REMINDER_DAYS = 3;

/**
 * The `invitations.remind` job (hourly): one reminder for each pending invitation with
 * `REMINDER_DAYS` or less left, unless the owner shares its link themselves. Only the token's hash
 * is stored, so the reminder carries a new link that replaces the first one (as a resend does);
 * the expiry stays. Each invitation is
 * claimed and its email queued in one transaction, so overlapping runs can't send two.
 */
export const remindInvitations: JobHandler<"invitations.remind"> = async (deps) => {
  if (!deps.email) return;
  const now = new Date();
  const soon = new Date(now.getTime() + REMINDER_DAYS * 24 * 60 * 60 * 1000);
  const due = await deps.db
    .select({ id: budgetInvitation.id })
    .from(budgetInvitation)
    .where(
      and(
        eq(budgetInvitation.status, "pending"),
        eq(budgetInvitation.delivery, "email"),
        isNull(budgetInvitation.remindedAt),
        gt(budgetInvitation.expiresAt, now),
        lte(budgetInvitation.expiresAt, soon),
      ),
    );
  for (const { id } of due) {
    await deps.db.transaction(async (tx) => {
      const { token, tokenHash } = newInvitationToken();
      const [claimed] = await tx
        .update(budgetInvitation)
        .set({ tokenHash, remindedAt: now })
        .where(
          and(
            eq(budgetInvitation.id, id),
            eq(budgetInvitation.status, "pending"),
            isNull(budgetInvitation.remindedAt),
          ),
        )
        .returning({ email: budgetInvitation.email, inviterId: budgetInvitation.inviterId });
      if (!claimed) return;
      const [inviter] = await tx
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, claimed.inviterId));
      if (!inviter) return;
      await enqueueEmail(
        deps.jobs,
        tx,
        deps.env,
        emails.invitationReminder(claimed.email, inviter.email, deps.env.WEB_ORIGIN, token),
      );
    });
  }
};
