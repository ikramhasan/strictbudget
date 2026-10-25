import { createRoute, z } from "@hono/zod-openapi";
import { zCurrencyCode } from "@strictbudget/engine";
import { jsonError } from "../../lib/errors";
import {
  authSecurity,
  requireAuth,
  requireSession,
  sessionSecurity,
} from "../../middleware/require-auth";

export const UserSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.email(),
    emailVerified: z.boolean(),
    twoFactorEnabled: z.boolean().describe("Two-step verification is on"),
    image: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .openapi("User");

const unverified = jsonError("The account's email address isn't confirmed");

export const getMe = createRoute({
  method: "get",
  path: "/me",
  operationId: "getMe",
  tags: ["Users"],
  summary: "The signed-in user",
  security: authSecurity,
  middleware: [requireAuth] as const,
  responses: {
    200: {
      description: "The current user",
      content: { "application/json": { schema: UserSchema } },
    },
    401: jsonError("Not signed in"),
    403: unverified,
  },
});

export const changeEmail = createRoute({
  method: "post",
  path: "/me/email",
  operationId: "changeEmail",
  tags: ["Users"],
  summary: "Start changing the account's email address",
  description:
    "Checks the current password, then emails the current address a link to approve the change; once approved, the new address gets a link to confirm it, and only then does the email change. The answer is the same whether or not the new address already has an account, so it can't be used to find accounts (an address that's taken just never gets a link). On a server that sends no email (`GET /v1/instance`), the address changes at once instead (200), unless another account has it (`EMAIL_TAKEN`).",
  security: sessionSecurity,
  middleware: [requireSession] as const,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              newEmail: z.email().max(254),
              password: z.string().min(1).max(128).describe("The account's current password"),
            })
            .openapi("ChangeEmail"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Changed (a server that sends no email)",
      content: {
        "application/json": {
          schema: z
            .object({ status: z.literal("changed"), email: z.string() })
            .openapi("ChangeEmailDone"),
        },
      },
    },
    202: {
      description: "Approval link sent to the current address",
      content: {
        "application/json": {
          schema: z.object({ status: z.literal("approval_sent") }).openapi("ChangeEmailResult"),
        },
      },
    },
    400: jsonError(
      "Invalid input (VALIDATION_ERROR), or the new address is the current one (SAME_EMAIL)",
    ),
    401: jsonError("Not signed in"),
    403: jsonError(
      "Wrong password (INVALID_PASSWORD), or the account's email address isn't confirmed",
    ),
    409: jsonError("Another account has the new address (EMAIL_TAKEN; only without email)"),
    429: jsonError("Too many password attempts (RATE_LIMITED)"),
  },
});

const SessionSchema = z
  .object({
    id: z.string(),
    current: z.boolean().describe("The session making this request"),
    browser: z.string().nullable().describe("e.g. Chrome; null when the user agent is unknown"),
    os: z.string().nullable().describe("e.g. macOS"),
    deviceType: z.enum(["desktop", "mobile", "tablet", "other"]),
    ipAddress: z.string().nullable(),
    createdAt: z.iso.datetime().describe("When this device signed in"),
    lastActiveAt: z.iso.datetime().describe("Last time the session was refreshed (about daily)"),
  })
  .openapi("Session");

export const listSessions = createRoute({
  method: "get",
  path: "/me/sessions",
  operationId: "listSessions",
  tags: ["Users"],
  summary: "Devices signed in to the account, current one first",
  security: sessionSecurity,
  middleware: [requireSession] as const,
  responses: {
    200: {
      description: "Active sessions",
      content: {
        "application/json": {
          schema: z.object({ sessions: z.array(SessionSchema) }).openapi("SessionList"),
        },
      },
    },
    401: jsonError("Not signed in"),
    403: unverified,
  },
});

const SessionParams = z.object({
  sessionId: z.string().openapi({ param: { name: "sessionId", in: "path" } }),
});

export const revokeSession = createRoute({
  method: "delete",
  path: "/me/sessions/{sessionId}",
  operationId: "revokeSession",
  tags: ["Users"],
  summary: "Sign out another device",
  security: sessionSecurity,
  middleware: [requireSession] as const,
  request: { params: SessionParams },
  responses: {
    204: { description: "Signed out" },
    400: jsonError("That's this device: sign out instead (CURRENT_SESSION)"),
    401: jsonError("Not signed in"),
    403: unverified,
    404: jsonError("No such session for this account"),
  },
});

export const revokeOtherSessions = createRoute({
  method: "delete",
  path: "/me/sessions",
  operationId: "revokeOtherSessions",
  tags: ["Users"],
  summary: "Sign out every device except this one",
  security: sessionSecurity,
  middleware: [requireSession] as const,
  responses: {
    204: { description: "Signed out" },
    401: jsonError("Not signed in"),
    403: unverified,
  },
});

export const disableTwoFactor = createRoute({
  method: "post",
  path: "/me/two-factor/disable",
  operationId: "disableTwoFactor",
  tags: ["Users"],
  summary: "Turn off two-step verification with a code from the verification app",
  description:
    "Confirmed with the current 6-digit code (`INVALID_CODE` when wrong). Attempts " +
    "share the password-check limit (`RATE_LIMITED`).",
  security: sessionSecurity,
  middleware: [requireSession] as const,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") })
            .openapi("DisableTwoFactor"),
        },
      },
    },
  },
  responses: {
    204: { description: "Turned off" },
    400: jsonError("Invalid input, or two-step verification isn't on (`TWO_FACTOR_NOT_ENABLED`)"),
    401: jsonError("Not signed in"),
    403: jsonError("Wrong code (`INVALID_CODE`), or the email isn't confirmed"),
    429: jsonError("Too many attempts (`RATE_LIMITED`)"),
  },
});

const PreferencesSchema = z
  .object({
    openLastBudget: z
      .boolean()
      .describe("Open the last used budget at start (else the budget list)"),
    keyboardShortcuts: z.boolean().describe("Keyboard shortcuts, undo and redo included"),
    displayCurrency: zCurrencyCode
      .nullable()
      .describe(
        "The currency account totals and net worth are shown in, in every budget (converted at " +
          "today's rates); null shows each budget's own currency",
      ),
  })
  .openapi("Preferences");

export const getPreferences = createRoute({
  method: "get",
  path: "/me/preferences",
  operationId: "getPreferences",
  tags: ["Users"],
  summary: "The account's options (Account Settings → Options)",
  security: sessionSecurity,
  middleware: [requireSession] as const,
  responses: {
    200: { description: "Options", content: { "application/json": { schema: PreferencesSchema } } },
    401: jsonError("Not signed in"),
    403: unverified,
  },
});

export const updatePreferences = createRoute({
  method: "patch",
  path: "/me/preferences",
  operationId: "updatePreferences",
  tags: ["Users"],
  summary: "Change the account's options",
  security: sessionSecurity,
  middleware: [requireSession] as const,
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: PreferencesSchema.partial().openapi("UpdatePreferences") },
      },
    },
  },
  responses: {
    200: { description: "Saved", content: { "application/json": { schema: PreferencesSchema } } },
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: unverified,
  },
});

export const deleteAccount = createRoute({
  method: "post",
  path: "/me/delete",
  operationId: "deleteMyAccount",
  tags: ["Users"],
  summary: "Permanently delete the account and its data",
  description:
    "Confirmed with the password (`INVALID_PASSWORD`; attempts share the " +
    "password-check limit), it deletes every budget the account owns, shared ones included, and " +
    "removes the account from budgets others shared with it. Logins, sessions, options and " +
    "two-step verification go too. Can't be undone.",
  security: sessionSecurity,
  middleware: [requireSession] as const,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ password: z.string().min(1).max(200) }).openapi("DeleteAccount"),
        },
      },
    },
  },
  responses: {
    204: { description: "Deleted; the session is gone too" },
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError("Wrong password (`INVALID_PASSWORD`), or the email isn't confirmed"),
    429: jsonError("Too many attempts (`RATE_LIMITED`)"),
  },
});
