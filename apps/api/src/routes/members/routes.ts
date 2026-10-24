import { createRoute, z } from "@hono/zod-openapi";
import { BUDGET_ROLES, INVITATION_DELIVERIES, MEMBER_ROLES } from "@strictbudget/db/schema";
import { jsonError } from "../../lib/errors";
import { zAvatarColor, zPicture } from "../../lib/member-colors";
import {
  authSecurity,
  requireAuth,
  requireSession,
  sessionSecurity,
} from "../../middleware/require-auth";

/** A budget is shared by the owner and up to five others. */
export const MAX_BUDGET_PEOPLE = 6;
export const INVITATION_DAYS = 14;

const MemberSchema = z
  .object({
    userId: z.string(),
    name: z.string(),
    email: z.string(),
    role: z.enum(BUDGET_ROLES),
    joinedAt: z.string(),
    avatarColor: zAvatarColor,
    picture: zPicture,
  })
  .openapi("BudgetMember");

const InvitationSchema = z
  .object({
    id: z.string(),
    name: z.string().describe("The invitee's first name"),
    email: z.string(),
    role: z.enum(MEMBER_ROLES).describe("The role they get when they join"),
    createdAt: z.string(),
    expiresAt: z.string(),
    expired: z.boolean(),
    delivery: z
      .enum(INVITATION_DELIVERIES)
      .describe("`email`: we emailed the link; `link`: the owner shares it themselves"),
  })
  .openapi("BudgetInvitation");

const InvitationWithLinkSchema = InvitationSchema.extend({
  link: z
    .string()
    .nullable()
    .describe(
      "The invitation link to share, shown only here (the server keeps only its hash); null when " +
        "it was emailed",
    ),
}).openapi("BudgetInvitationWithLink");

const MembersSchema = z
  .object({
    members: z.array(MemberSchema).describe("The owner first, then by when they joined"),
    invitations: z
      .array(InvitationSchema)
      .describe("Pending invitations, newest first; only the owner sees them"),
    maxPeople: z.number().int().describe("How many people a budget can have, owner included"),
  })
  .openapi("BudgetMembers");

const BudgetParams = z.object({
  budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
});
const InvitationParams = BudgetParams.extend({
  invitationId: z.string().openapi({ param: { name: "invitationId", in: "path" } }),
});

function ok<T extends z.ZodType>(description: string, schema: T) {
  return { description, content: { "application/json": { schema } } };
}
function body<T extends z.ZodType>(schema: T) {
  return { required: true, content: { "application/json": { schema } } };
}
const notFound = jsonError("No such budget or invitation, or the caller isn't a member");
const ownerOnly = jsonError(
  "Only the budget's owner can manage sharing, or the account's email address isn't confirmed",
);

export const listMembers = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/members",
  operationId: "listBudgetMembers",
  tags: ["Sharing"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Who the budget is shared with, and its pending invitations",
  request: { params: BudgetParams },
  responses: {
    200: ok("Members", MembersSchema),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: notFound,
  },
});

export const createInvitation = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/invitations",
  operationId: "createBudgetInvitation",
  tags: ["Sharing"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "Invite someone to share the budget (owner only)",
  description:
    `They get an email with a link that works for ${INVITATION_DAYS} days, or, with ` +
    "`sendEmail: false`, the answer carries the link for the owner to share. Either way, joining " +
    "needs an account with the invited address. A server that sends no email (`GET /v1/instance`) " +
    "only makes links (`EMAIL_DISABLED`). A budget has at most " +
    `${MAX_BUDGET_PEOPLE} people, pending invitations included (\`BUDGET_FULL\`). Someone already ` +
    "in the budget (`ALREADY_MEMBER`) or already invited (`ALREADY_INVITED`) can't be invited.",
  request: {
    params: BudgetParams,
    body: body(
      z
        .object({
          name: z.string().trim().min(1).max(100).describe("First name"),
          email: z.email().max(254),
          role: z
            .enum(MEMBER_ROLES)
            .default("editor")
            .describe(
              "`editor` (can change everything but sharing) or `viewer` (can see the budget but " +
                "not change it)",
            ),
          sendEmail: z
            .boolean()
            .optional()
            .describe(
              "Email the link (the default when the server sends email), or return it to share",
            ),
        })
        .openapi("CreateBudgetInvitation"),
    ),
  },
  responses: {
    201: ok("Invited", InvitationWithLinkSchema),
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: ownerOnly,
    404: notFound,
    409: jsonError(
      "`BUDGET_FULL`, `ALREADY_MEMBER`, `ALREADY_INVITED` or `EMAIL_DISABLED` (asked to email it)",
    ),
  },
});

export const resendInvitation = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/invitations/{invitationId}/resend",
  operationId: "resendBudgetInvitation",
  tags: ["Sharing"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: `Send the invitation again with a new link, good for another ${INVITATION_DAYS} days`,
  request: { params: InvitationParams },
  responses: {
    200: ok("Sent", InvitationSchema),
    401: jsonError("Not signed in"),
    403: ownerOnly,
    404: notFound,
    409: jsonError(
      "`EMAIL_DISABLED`: the server sends no email (make a new link instead); `BUDGET_FULL`: an " +
        "expired invitation no longer fits",
    ),
  },
});

export const createInvitationLink = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/invitations/{invitationId}/link",
  operationId: "createBudgetInvitationLink",
  tags: ["Sharing"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: `A new link to share for the invitation, good for another ${INVITATION_DAYS} days`,
  description:
    "Nothing is emailed. The earlier link, emailed or shared, stops working, and the invitation " +
    "gets no reminder email (its new link would replace this one).",
  request: { params: InvitationParams },
  responses: {
    200: ok("The invitation and its new link", InvitationWithLinkSchema),
    401: jsonError("Not signed in"),
    403: ownerOnly,
    404: notFound,
    409: jsonError("`BUDGET_FULL`: an expired invitation no longer fits"),
  },
});

export const cancelInvitation = createRoute({
  method: "delete",
  path: "/budgets/{budgetId}/invitations/{invitationId}",
  operationId: "cancelBudgetInvitation",
  tags: ["Sharing"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "Cancel a pending invitation; its link stops working",
  request: { params: InvitationParams },
  responses: {
    204: { description: "Canceled" },
    401: jsonError("Not signed in"),
    403: ownerOnly,
    404: notFound,
  },
});

const TokenBody = body(z.object({ token: z.string().min(1).max(200) }).openapi("InvitationToken"));
const invitationGone = jsonError(
  "No such invitation, or it was canceled or already used (`INVITATION_NOT_FOUND`), or it " +
    "expired (`INVITATION_EXPIRED`)",
);

export const viewInvitation = createRoute({
  method: "post",
  path: "/invitations/view",
  operationId: "viewInvitation",
  tags: ["Sharing"],
  summary: "What an invitation link is for, before signing in to accept it",
  description: "The token from the emailed link proves it was received; no session is needed.",
  request: { body: TokenBody },
  responses: {
    200: ok(
      "Invitation",
      z
        .object({
          email: z.string().describe("The address it was sent to"),
          budgetName: z.string(),
          inviterName: z.string(),
          inviterEmail: z.string(),
          expiresAt: z.string(),
        })
        .openapi("InvitationView"),
    ),
    400: jsonError("Invalid input"),
    404: invitationGone,
    410: invitationGone,
  },
});

export const acceptInvitation = createRoute({
  method: "post",
  path: "/invitations/accept",
  operationId: "acceptInvitation",
  tags: ["Sharing"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "Join the budget an invitation is for",
  description:
    "The signed-in account's email must be the invited address (`INVITATION_EMAIL_MISMATCH`), so " +
    "a forwarded link can't be used by someone else. A link works once.",
  request: { body: TokenBody },
  responses: {
    200: ok("Joined", z.object({ budgetId: z.string() }).openapi("AcceptedInvitation")),
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "Signed in with another address (`INVITATION_EMAIL_MISMATCH`), or the email isn't confirmed",
    ),
    404: invitationGone,
    409: jsonError("The budget already has the most people it can (`BUDGET_FULL`)"),
    410: invitationGone,
  },
});

const MemberParams = BudgetParams.extend({
  userId: z.string().openapi({ param: { name: "userId", in: "path" } }),
});

export const removeMember = createRoute({
  method: "delete",
  path: "/budgets/{budgetId}/members/{userId}",
  operationId: "removeBudgetMember",
  tags: ["Sharing"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "Stop sharing the budget with someone (owner only)",
  description:
    "They lose access at once. The owner can't be removed (`CANNOT_REMOVE_OWNER`): transfer " +
    "ownership first.",
  request: { params: MemberParams },
  responses: {
    204: { description: "Removed" },
    401: jsonError("Not signed in"),
    403: ownerOnly,
    404: notFound,
    409: jsonError("The owner (`CANNOT_REMOVE_OWNER`)"),
  },
});

export const changeMemberRole = createRoute({
  method: "patch",
  path: "/budgets/{budgetId}/members/{userId}",
  operationId: "changeBudgetMemberRole",
  tags: ["Sharing"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "Make someone an editor or a viewer (owner only)",
  description:
    "A viewer sees everything but can't change anything. The " +
    "owner's own role changes only by transferring ownership (`CANNOT_CHANGE_OWNER`).",
  request: {
    params: MemberParams,
    body: body(z.object({ role: z.enum(MEMBER_ROLES) }).openapi("ChangeBudgetMemberRole")),
  },
  responses: {
    200: ok("Changed", MemberSchema),
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: ownerOnly,
    404: notFound,
    409: jsonError("The owner (`CANNOT_CHANGE_OWNER`)"),
  },
});

export const leaveBudget = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/leave",
  operationId: "leaveBudget",
  tags: ["Sharing"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "Leave a budget shared with you",
  description:
    "The owner can't leave (`OWNER_CANNOT_LEAVE`): transfer ownership to someone else first, or " +
    "delete the budget.",
  request: { params: BudgetParams },
  responses: {
    204: { description: "Left" },
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: notFound,
    409: jsonError("The owner (`OWNER_CANNOT_LEAVE`)"),
  },
});

export const transferOwnership = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/transfer-ownership",
  operationId: "transferBudgetOwnership",
  tags: ["Sharing"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "Make someone else the budget's owner (owner only)",
  description:
    "The new owner must already share the budget. The old owner keeps access as a " + "member.",
  request: {
    params: BudgetParams,
    body: body(z.object({ userId: z.string() }).openapi("TransferBudgetOwnership")),
  },
  responses: {
    204: { description: "Transferred" },
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: ownerOnly,
    404: jsonError("No such budget, or the new owner doesn't share it"),
    409: jsonError("Already the owner (`ALREADY_OWNER`)"),
  },
});
