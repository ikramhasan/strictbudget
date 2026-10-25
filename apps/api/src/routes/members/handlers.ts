import type { RouteHandler } from "@hono/zod-openapi";
import { newId, sql } from "@strictbudget/db";
import { budget, budgetInvitation, budgetMember, user } from "@strictbudget/db/schema";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { loadBudgetAccess } from "../../lib/budget-access";
import { deliverEmail } from "../../lib/email/deliver";
import { emails } from "../../lib/email/templates";
import { AppError } from "../../lib/errors";
import { hashToken, invitationUrl, newInvitationToken as newToken } from "../../lib/invitations";
import type { Db, Tx } from "../../lib/ledger";
import {
  forgetFormerMemberColor,
  keepFormerMemberColor,
  pictureUrlSql,
} from "../../lib/member-colors";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import {
  type acceptInvitation,
  type cancelInvitation,
  type changeMemberRole,
  type createInvitation,
  type createInvitationLink,
  INVITATION_DAYS,
  type leaveBudget,
  type listMembers,
  MAX_BUDGET_PEOPLE,
  type removeMember,
  type resendInvitation,
  type transferOwnership,
  type viewInvitation,
} from "./routes";

type Env = AppEnv & AuthedEnv;

const MANAGE = { invitation: ["create"] } as const;
const expiry = () => new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000);

type InvitationRow = typeof budgetInvitation.$inferSelect;
function toInvitationJson(row: InvitationRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role === "viewer" ? ("viewer" as const) : ("editor" as const),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    expired: row.expiresAt.getTime() <= Date.now(),
    delivery: row.delivery,
  };
}

const EMAIL_DISABLED = () =>
  new AppError(
    409,
    "EMAIL_DISABLED",
    "This server doesn't send email. Share an invitation link instead.",
  );

/** People in the budget plus invitations still waiting, with the budget row locked. */
async function headcount(tx: Tx, budgetId: string) {
  await tx.select({ id: budget.id }).from(budget).where(eq(budget.id, budgetId)).for("update");
  const [members] = await tx
    .select({ n: count() })
    .from(budgetMember)
    .where(eq(budgetMember.budgetId, budgetId));
  const [pending] = await tx
    .select({ n: count() })
    .from(budgetInvitation)
    .where(
      and(
        eq(budgetInvitation.budgetId, budgetId),
        eq(budgetInvitation.status, "pending"),
        sql`${budgetInvitation.expiresAt} > now()`,
      ),
    );
  return { members: members?.n ?? 0, pending: pending?.n ?? 0 };
}

const FULL = () =>
  new AppError(
    409,
    "BUDGET_FULL",
    `A budget can be shared with up to ${MAX_BUDGET_PEOPLE - 1} people`,
  );

/** The owner first, then by when they joined (the avatar order). */
async function listedMembers(db: Db, budgetId: string) {
  const members = await db
    .select({
      userId: budgetMember.userId,
      name: user.name,
      email: user.email,
      picture: pictureUrlSql(user.id),
      role: budgetMember.role,
      joinedAt: budgetMember.createdAt,
    })
    .from(budgetMember)
    .innerJoin(user, eq(user.id, budgetMember.userId))
    .where(eq(budgetMember.budgetId, budgetId))
    .orderBy(sql`${budgetMember.role} <> 'owner'`, asc(budgetMember.createdAt));
  return {
    members: members.map((m, i) => ({
      ...m,
      joinedAt: m.joinedAt.toISOString(),
      avatarColor: Math.min(i + 1, 6),
    })),
  };
}

export const listMembersHandler: RouteHandler<typeof listMembers, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { db } = c.var.deps;
  const { role } = await loadBudgetAccess(c, budgetId);
  const invitations =
    role === "owner"
      ? await db
          .select()
          .from(budgetInvitation)
          .where(
            and(eq(budgetInvitation.budgetId, budgetId), eq(budgetInvitation.status, "pending")),
          )
          .orderBy(desc(budgetInvitation.createdAt))
      : [];
  return c.json(
    {
      ...(await listedMembers(db, budgetId)),
      invitations: invitations.map(toInvitationJson),
      maxPeople: MAX_BUDGET_PEOPLE,
    },
    200,
  );
};

export const createInvitationHandler: RouteHandler<typeof createInvitation, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const input = c.req.valid("json");
  const deps = c.var.deps;
  await loadBudgetAccess(c, budgetId, MANAGE);
  const email = input.email.toLowerCase();
  if (input.sendEmail && !deps.email) throw EMAIL_DISABLED();
  const sendEmail = input.sendEmail ?? deps.email !== null;
  const { token, tokenHash } = newToken();
  const row = await deps.db.transaction(async (tx) => {
    const people = await headcount(tx, budgetId);
    const [member] = await tx
      .select({ id: budgetMember.id })
      .from(budgetMember)
      .innerJoin(user, eq(user.id, budgetMember.userId))
      .where(and(eq(budgetMember.budgetId, budgetId), sql`lower(${user.email}) = ${email}`));
    if (member) {
      throw new AppError(409, "ALREADY_MEMBER", "That person already shares this budget");
    }
    const [waiting] = await tx
      .select()
      .from(budgetInvitation)
      .where(
        and(
          eq(budgetInvitation.budgetId, budgetId),
          eq(budgetInvitation.status, "pending"),
          eq(budgetInvitation.email, email),
        ),
      );
    if (waiting && waiting.expiresAt.getTime() > Date.now()) {
      throw new AppError(
        409,
        "ALREADY_INVITED",
        "That address already has an invitation. Resend it instead.",
      );
    }
    if (waiting) {
      await tx
        .update(budgetInvitation)
        .set({ status: "canceled", tokenHash: null })
        .where(eq(budgetInvitation.id, waiting.id));
    }
    if (people.members + people.pending >= MAX_BUDGET_PEOPLE) throw FULL();
    const [created] = await tx
      .insert(budgetInvitation)
      .values({
        id: newId(),
        budgetId,
        email,
        name: input.name,
        role: input.role,
        status: "pending",
        tokenHash,
        delivery: sendEmail ? "email" : "link",
        expiresAt: expiry(),
        inviterId: c.var.user.id,
      })
      .returning();
    if (!created) throw new Error("Invitation insert returned nothing");
    return created;
  });
  if (!sendEmail) {
    return c.json(
      { ...toInvitationJson(row), link: invitationUrl(deps.env.WEB_ORIGIN, token) },
      201,
    );
  }
  await deliverEmail(
    deps,
    emails.budgetInvitation(email, c.var.user.email, deps.env.WEB_ORIGIN, token),
  );
  return c.json({ ...toInvitationJson(row), link: null }, 201);
};

async function pendingInvitation(tx: Tx, budgetId: string, invitationId: string) {
  const [row] = await tx
    .select()
    .from(budgetInvitation)
    .where(
      and(
        eq(budgetInvitation.id, invitationId),
        eq(budgetInvitation.budgetId, budgetId),
        eq(budgetInvitation.status, "pending"),
      ),
    )
    .for("update");
  if (!row) throw new AppError(404, "NOT_FOUND", "Invitation not found");
  return row;
}

/**
 * A new token and expiry for a pending invitation (the old link stops working), by the caller,
 * delivered as `delivery` says.
 */
async function renewInvitation(
  db: Db,
  budgetId: string,
  invitationId: string,
  inviterId: string,
  delivery: InvitationRow["delivery"],
) {
  const { token, tokenHash } = newToken();
  const row = await db.transaction(async (tx) => {
    const existing = await pendingInvitation(tx, budgetId, invitationId);
    // An expired invitation stopped counting toward the limit, so it has to fit again.
    if (existing.expiresAt.getTime() <= Date.now()) {
      const people = await headcount(tx, budgetId);
      if (people.members + people.pending >= MAX_BUDGET_PEOPLE) throw FULL();
    }
    const [updated] = await tx
      .update(budgetInvitation)
      .set({ tokenHash, delivery, expiresAt: expiry(), inviterId, remindedAt: null })
      .where(eq(budgetInvitation.id, invitationId))
      .returning();
    if (!updated) throw new Error("Invitation update returned nothing");
    return updated;
  });
  return { row, token };
}

export const resendInvitationHandler: RouteHandler<typeof resendInvitation, Env> = async (c) => {
  const { budgetId, invitationId } = c.req.valid("param");
  const deps = c.var.deps;
  await loadBudgetAccess(c, budgetId, MANAGE);
  if (!deps.email) throw EMAIL_DISABLED();
  const { row, token } = await renewInvitation(
    deps.db,
    budgetId,
    invitationId,
    c.var.user.id,
    "email",
  );
  await deliverEmail(
    deps,
    emails.budgetInvitation(row.email, c.var.user.email, deps.env.WEB_ORIGIN, token),
  );
  return c.json(toInvitationJson(row), 200);
};

export const createInvitationLinkHandler: RouteHandler<typeof createInvitationLink, Env> = async (
  c,
) => {
  const { budgetId, invitationId } = c.req.valid("param");
  const deps = c.var.deps;
  await loadBudgetAccess(c, budgetId, MANAGE);
  const { row, token } = await renewInvitation(
    deps.db,
    budgetId,
    invitationId,
    c.var.user.id,
    "link",
  );
  return c.json({ ...toInvitationJson(row), link: invitationUrl(deps.env.WEB_ORIGIN, token) }, 200);
};

export const cancelInvitationHandler: RouteHandler<typeof cancelInvitation, Env> = async (c) => {
  const { budgetId, invitationId } = c.req.valid("param");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, MANAGE);
  await db.transaction(async (tx) => {
    await pendingInvitation(tx, budgetId, invitationId);
    await tx
      .update(budgetInvitation)
      .set({ status: "canceled", tokenHash: null })
      .where(eq(budgetInvitation.id, invitationId));
  });
  return c.body(null, 204);
};

/** The invitation a link's token belongs to: pending and unexpired, or a 404/410. */
async function invitationFor(db: Db, token: string) {
  const [row] = await db
    .select({ invitation: budgetInvitation, budgetName: budget.name })
    .from(budgetInvitation)
    .innerJoin(budget, eq(budget.id, budgetInvitation.budgetId))
    .where(eq(budgetInvitation.tokenHash, hashToken(token)));
  if (!row || row.invitation.status !== "pending") {
    throw new AppError(
      404,
      "INVITATION_NOT_FOUND",
      "This invitation was canceled or has already been used",
    );
  }
  if (row.invitation.expiresAt.getTime() <= Date.now()) {
    throw new AppError(
      410,
      "INVITATION_EXPIRED",
      "This invitation has expired. Ask the person who sent it to resend it.",
    );
  }
  return row;
}

export const viewInvitationHandler: RouteHandler<typeof viewInvitation, AppEnv> = async (c) => {
  const { token } = c.req.valid("json");
  const { db } = c.var.deps;
  const { invitation, budgetName } = await invitationFor(db, token);
  const [inviter] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, invitation.inviterId));
  return c.json(
    {
      email: invitation.email,
      budgetName,
      inviterName: inviter?.name ?? "",
      inviterEmail: inviter?.email ?? "",
      expiresAt: invitation.expiresAt.toISOString(),
    },
    200,
  );
};

export const acceptInvitationHandler: RouteHandler<typeof acceptInvitation, Env> = async (c) => {
  const { token } = c.req.valid("json");
  const { db } = c.var.deps;
  const me = c.var.user;
  const budgetId = await db.transaction(async (tx) => {
    const { invitation } = await invitationFor(tx, token);
    if (invitation.email.toLowerCase() !== me.email.toLowerCase()) {
      throw new AppError(
        403,
        "INVITATION_EMAIL_MISMATCH",
        `This invitation is for ${invitation.email}. Sign in with that address to accept it.`,
      );
    }
    const [member] = await tx
      .select({ id: budgetMember.id })
      .from(budgetMember)
      .where(and(eq(budgetMember.budgetId, invitation.budgetId), eq(budgetMember.userId, me.id)));
    if (!member) {
      // The invitation itself was counted while pending, so joining never needs more room than
      // it had; a full budget only happens if members were added some other way.
      const people = await headcount(tx, invitation.budgetId);
      if (people.members + people.pending > MAX_BUDGET_PEOPLE) throw FULL();
      await forgetFormerMemberColor(tx, invitation.budgetId, me.id);
      await tx.insert(budgetMember).values({
        id: newId(),
        budgetId: invitation.budgetId,
        userId: me.id,
        role: invitation.role === "viewer" ? "viewer" : "editor",
      });
    }
    await tx
      .update(budgetInvitation)
      .set({ status: "accepted", tokenHash: null })
      .where(eq(budgetInvitation.id, invitation.id));
    return invitation.budgetId;
  });
  return c.json({ budgetId }, 200);
};

/** The budget's member row for `userId`, locked; a 404 when they don't share it. */
async function memberRow(tx: Tx, budgetId: string, userId: string) {
  const [row] = await tx
    .select()
    .from(budgetMember)
    .where(and(eq(budgetMember.budgetId, budgetId), eq(budgetMember.userId, userId)))
    .for("update");
  if (!row) throw new AppError(404, "NOT_FOUND", "That person doesn't share this budget");
  return row;
}

export const removeMemberHandler: RouteHandler<typeof removeMember, Env> = async (c) => {
  const { budgetId, userId } = c.req.valid("param");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { member: ["delete"] });
  await db.transaction(async (tx) => {
    const row = await memberRow(tx, budgetId, userId);
    if (row.role === "owner") {
      throw new AppError(
        409,
        "CANNOT_REMOVE_OWNER",
        "The owner can't be removed. Transfer ownership first.",
      );
    }
    await keepFormerMemberColor(tx, budgetId, row.userId);
    await tx.delete(budgetMember).where(eq(budgetMember.id, row.id));
  });
  return c.body(null, 204);
};

export const changeMemberRoleHandler: RouteHandler<typeof changeMemberRole, Env> = async (c) => {
  const { budgetId, userId } = c.req.valid("param");
  const { role } = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { member: ["update"] });
  await db.transaction(async (tx) => {
    const row = await memberRow(tx, budgetId, userId);
    if (row.role === "owner") {
      throw new AppError(
        409,
        "CANNOT_CHANGE_OWNER",
        "The owner's role can't change. Transfer ownership first.",
      );
    }
    await tx.update(budgetMember).set({ role }).where(eq(budgetMember.id, row.id));
  });
  const { members } = await listedMembers(db, budgetId);
  const member = members.find((m) => m.userId === userId);
  if (!member) throw new AppError(404, "NOT_FOUND", "That person doesn't share this budget");
  return c.json(member, 200);
};

export const leaveBudgetHandler: RouteHandler<typeof leaveBudget, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId);
  await db.transaction(async (tx) => {
    const row = await memberRow(tx, budgetId, c.var.user.id);
    if (row.role === "owner") {
      throw new AppError(
        409,
        "OWNER_CANNOT_LEAVE",
        "The owner can't leave a budget. Transfer ownership to someone else first, or delete it.",
      );
    }
    await keepFormerMemberColor(tx, budgetId, row.userId);
    await tx.delete(budgetMember).where(eq(budgetMember.id, row.id));
  });
  return c.body(null, 204);
};

export const transferOwnershipHandler: RouteHandler<typeof transferOwnership, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { userId } = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { organization: ["delete"] });
  await db.transaction(async (tx) => {
    const me = await memberRow(tx, budgetId, c.var.user.id);
    const next = await memberRow(tx, budgetId, userId);
    if (next.id === me.id) throw new AppError(409, "ALREADY_OWNER", "You already own this budget");
    await tx.update(budgetMember).set({ role: "owner" }).where(eq(budgetMember.id, next.id));
    await tx.update(budgetMember).set({ role: "editor" }).where(eq(budgetMember.id, me.id));
  });
  return c.body(null, 204);
};
