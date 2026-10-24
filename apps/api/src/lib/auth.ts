import { agentAuth } from "@better-auth/agent-auth";
import { apiKey } from "@better-auth/api-key";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { type Database, newId, sql } from "@strictbudget/db";
import * as schema from "@strictbudget/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { haveIBeenPwned, jwt, organization, twoFactor } from "better-auth/plugins";
import { jwtVerify } from "jose";
import type { Env } from "../env";
import { agentAuthOptions, recordApproval } from "./agents/agent-auth";
import { MCP_SCOPES, mcpResource } from "./agents/mcp-auth";
import { AgentRuntime } from "./agents/runtime";
import {
  API_KEY_MAX_DAYS,
  API_KEY_NAME_MAX,
  API_KEY_PREFIX,
  API_KEY_START_LENGTH,
} from "./api-keys";
import { budgetAc, budgetRoles } from "./budget-access-control";
import { deleteBudgetTransactions } from "./delete-budget";
import type { EmailMessage, EmailSender } from "./email/sender";
import { emails } from "./email/templates";
import { log } from "./log";
import { seedInternalCategories } from "./starter-categories";
import { tryPasswordCheck } from "./throttle";

export interface AuthOptions {
  /** Better Auth's rate limiter. On everywhere but tests unless a test turns it on. */
  rateLimit?: boolean;
  /** Password hashing. Better Auth's scrypt unless given; tests pass a cheap one. */
  password?: {
    hash: (password: string) => Promise<string>;
    verify: (data: { hash: string; password: string }) => Promise<boolean>;
  };
}

/** Both email-verification links and reset links stop working after this long. */
const LINK_LIFETIME_SECONDS = 60 * 60;

/** The `requestType` Better Auth signs into change-email tokens (absent for sign-up verification). */
function tokenRequestType(token: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString());
    return typeof payload.requestType === "string" ? payload.requestType : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The addresses a change-email link moves between, from a token whose signature checks out (so a
 * made-up token can't ask whether an address has an account). Undefined for any other token.
 */
async function changeEmailTarget(token: string, secret: string) {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
    });
    const { email, updateTo, requestType } = payload as Record<string, unknown>;
    if (
      typeof email === "string" &&
      typeof updateTo === "string" &&
      (requestType === "change-email-confirmation" || requestType === "change-email-verification")
    ) {
      return { from: email, to: updateTo };
    }
  } catch {
    // Expired or invalid: Better Auth answers that itself.
  }
  return undefined;
}

/**
 * Whether another account has `to` while the account changing from `from` still exists. Once the
 * change is done, `from` is gone and `to` is the account's own: a replayed link is then left to
 * Better Auth ("isn't valid any more"), not reported as taken.
 */
async function addressTakenByOther(db: Database, from: string, to: string) {
  const rows = await db
    .select({ id: schema.user.id, email: schema.user.email })
    .from(schema.user)
    .where(sql`lower(${schema.user.email}) in (${from.toLowerCase()}, ${to.toLowerCase()})`);
  const owner = rows.find((r) => r.email.toLowerCase() === from.toLowerCase());
  const holder = rows.find((r) => r.email.toLowerCase() === to.toLowerCase());
  return owner !== undefined && holder !== undefined && holder.id !== owner.id;
}

/**
 * `email` is null on a server that sends no email (`createEmailSender`). Addresses are then taken
 * as given: accounts start confirmed and sign in straight after sign-up, and there's no reset link.
 */
export function createAuth(
  db: Database,
  env: Env,
  email: EmailSender | null,
  options: AuthOptions = {},
) {
  const web = env.WEB_ORIGIN;
  const sendsEmail = email !== null;
  const logFailure = (message: EmailMessage, e: unknown) =>
    log.error("Email not queued", { kind: message.kind }, e);
  /**
   * Hands the email on (in the app, `QueuedEmailSender`: queued for the worker, which retries) without
   * holding up the response, so an endpoint answers in the same time whether or not it sent
   * anything (timing would otherwise reveal which addresses have accounts). Better Auth awaits some
   * send callbacks itself (resend confirmation), so this can't be left to its background tasks.
   * Tests await, so the job is queued before they read the outbox.
   */
  const deliver = async (message: EmailMessage) => {
    if (!email) return;
    if (env.NODE_ENV === "test") return email.send(message);
    void email.send(message).catch((e) => logFailure(message, e));
  };
  /** Notices that mustn't fail the action they report (a password change has already happened). */
  const notify = async (message: EmailMessage) => {
    try {
      await deliver(message);
    } catch (e) {
      logFailure(message, e);
    }
  };

  const agentRuntime = new AgentRuntime();

  const auth = betterAuth({
    appName: "strictbudget",
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [web],
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      // No session until the address is confirmed. This also makes a sign-up with a taken
      // address answer exactly like a new one, so sign-up can't be used to find accounts.
      // Without email there's nothing to confirm with, so sign-up signs straight in.
      requireEmailVerification: sendsEmail,
      autoSignIn: !sendsEmail,
      ...(options.password ? { password: options.password } : {}),
      // Better Auth's links go to its own GET endpoints; ours go to the web app, which only
      // acts when the person clicks (see email/templates.ts). Without email, Better Auth answers
      // a reset request with an error.
      ...(sendsEmail && {
        sendResetPassword: async ({ user, token }: { user: { email: string }; token: string }) => {
          await deliver(emails.resetPassword(user.email, web, token));
        },
      }),
      resetPasswordTokenExpiresIn: LINK_LIFETIME_SECONDS,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => {
        await notify(emails.passwordChanged(user.email, web));
      },
      onExistingUserSignUp: async ({ user }) => {
        await deliver(emails.existingAccount(user.email, web));
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, token }) => {
        // Sign-up (and sign-in while unverified) tokens confirm the address; a
        // change-email-verification token goes to the new address (`user.email` is already it).
        const message =
          tokenRequestType(token) === "change-email-verification"
            ? emails.changeEmailVerify(user.email, web, token)
            : emails.verifyEmail(user.email, web, token);
        await deliver(message);
      },
      sendOnSignUp: sendsEmail,
      sendOnSignIn: sendsEmail,
      // Confirming proves the inbox, not the password: sign in afterwards as usual.
      autoSignInAfterVerification: false,
      expiresIn: LINK_LIFETIME_SECONDS,
    },
    user: {
      changeEmail: {
        enabled: true,
        // A verified account's current address approves the change before the new one is
        // asked to confirm it. Clients reach this through POST /v1/me/email, which checks the
        // password first; the endpoint itself is blocked in app.ts.
        sendChangeEmailConfirmation: async ({ user, newEmail, token }) => {
          await deliver(emails.changeEmailConfirm(user.email, newEmail, web, token));
        },
      },
    },
    // `user.image` is ours: the profile picture's API path, set by PUT /v1/me/picture through the
    // database. Better Auth's sign-up and update-user would take any string, which the user's own
    // browser then loads, so they can't set it.
    databaseHooks: {
      user: {
        // Without email, an address can't be confirmed, so it starts confirmed.
        create: {
          before: async (user) => ({
            data: { ...user, image: null, emailVerified: sendsEmail ? user.emailVerified : true },
          }),
        },
        // Better Auth merges what this returns over its input, so the field is cleared to
        // undefined (left unchanged) rather than left out.
        update: { before: async (data) => ({ data: { ...data, image: undefined } }) },
      },
    },
    // Reset tokens are stored as hashes: a leaked database row can't be used to reset a password.
    verification: { storeIdentifier: "hashed" },
    rateLimit: {
      enabled: options.rateLimit ?? env.NODE_ENV !== "test",
      storage: "database",
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Agent Auth reads its capability list from the runtime, filled on first use.
        if (/^\/(agent|capability|host)(\/|-)/.test(ctx.path)) agentRuntime.ensureCapabilities();
        if (ctx.path === "/change-password") {
          // Shares the per-user limit with /v1/me/email: both answer whether a password is right.
          const session = await getSessionFromCtx(ctx);
          if (!session) return;
          const retryAfter = await tryPasswordCheck(db, session.user.id);
          if (retryAfter !== null) {
            throw new APIError("TOO_MANY_REQUESTS", {
              code: "RATE_LIMITED",
              message: "Too many attempts. Try again later.",
            });
          }
        }
        if (ctx.path === "/verify-email") {
          // Better Auth signs in whoever opens a change-email confirmation link without a
          // session. Confirming a new address must come from the account's own signed-in
          // browser, so the link alone never yields a session.
          const token = typeof ctx.query?.token === "string" ? ctx.query.token : "";
          if (
            tokenRequestType(token) === "change-email-verification" &&
            !(await getSessionFromCtx(ctx))
          ) {
            throw new APIError("UNAUTHORIZED", {
              code: "SIGN_IN_REQUIRED",
              message: "Sign in to your account on this device, then open the link again.",
            });
          }
          // Someone may have signed up with the new address since the change was asked for.
          // Confirming would then fail on the taken address with a generic error; say why.
          const change = await changeEmailTarget(token, env.BETTER_AUTH_SECRET);
          if (change && (await addressTakenByOther(db, change.from, change.to))) {
            throw new APIError("CONFLICT", {
              code: "EMAIL_TAKEN",
              message: "That address now belongs to another account, so your email wasn't changed.",
            });
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const returned = ctx.context.returned;
        if (returned instanceof Error) return;
        if (ctx.path === "/change-password") {
          const user = ctx.context.session?.user;
          if (user) await notify(emails.passwordChanged(user.email, web));
        }
        // An account left unconfirmed from when the server sent email can't be confirmed now:
        // signing in confirms it, as new accounts start (see `databaseHooks`).
        const signedIn = ctx.context.newSession?.user;
        if (!sendsEmail && ctx.path === "/sign-in/email" && signedIn && !signedIn.emailVerified) {
          await db
            .update(schema.user)
            .set({ emailVerified: true })
            .where(sql`${schema.user.id} = ${signedIn.id}`);
        }
        // An agent shows as connected once approved, before it's first used.
        if (ctx.path === "/oauth2/consent" || ctx.path === "/agent/approve-capability") {
          const userId = ctx.context.session?.user.id;
          if (userId) await recordApproval(db, userId, ctx.path, ctx.body);
        }
        // The session cookie is httpOnly so scripts can't read it; don't hand the same token to
        // the browser in /get-session's JSON. Server-side calls (no request) keep it.
        if (
          ctx.path === "/get-session" &&
          ctx.request &&
          returned &&
          typeof returned === "object"
        ) {
          const body = returned as { session?: Record<string, unknown> | null };
          if (body.session) {
            const { token: _token, ...session } = body.session;
            return ctx.json({ ...body, session });
          }
        }
      }),
    },
    advanced: {
      database: { generateId: () => newId() },
      ipAddress: {
        ...(env.CLIENT_IP_HEADER ? { ipAddressHeaders: [env.CLIENT_IP_HEADER] } : {}),
        trustedProxies: env.TRUSTED_PROXIES?.split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      },
    },
    telemetry: { enabled: false },
    // The jwt plugin's session-token endpoint: nothing uses session JWTs.
    disabledPaths: ["/token"],
    logger: {
      // Through our structured log. A wrong or expired API key is an expected 401
      // (`requireAuth`), not an error: the api-key plugin would log one for every bad request.
      log: (level, message, ...args) => {
        if (message.startsWith("Failed to validate API key")) return;
        const text = `Better Auth: ${message}`;
        if (level === "error") log.error(text, undefined, args[0]);
        else if (level === "warn") log.warn(text, undefined, args[0]);
        else log.info(text);
      },
    },
    plugins: [
      // Refuses passwords found in known breaches (sign-up, change, reset). Only the first five
      // characters of the password's SHA-1 leave the server. Off in tests: it calls the network.
      haveIBeenPwned({ enabled: env.NODE_ENV !== "test" }),
      // An authenticator app plus one emergency backup code, no "remember this device". Turning it
      // off goes through /v1/me/two-factor, which asks for a code, instead of the plugin's
      // password-based endpoint.
      twoFactor({
        issuer: "strictbudget",
        backupCodeOptions: { amount: 1, length: 10 },
        schema: { twoFactor: { modelName: "twoFactor" } },
      }),
      // Personal API keys (`lib/api-keys.ts`). Its HTTP endpoints are blocked in
      // app.ts: keys are managed through /v1/me/api-keys and checked by `requireAuth`. Keys never
      // become sessions (`enableSessionForAPIKeys` stays off), so they can't reach /api/auth/*.
      apiKey({
        defaultPrefix: API_KEY_PREFIX,
        requireName: true,
        maximumNameLength: API_KEY_NAME_MAX,
        startingCharactersConfig: { shouldStore: true, charactersLength: API_KEY_START_LENGTH },
        keyExpiration: { defaultExpiresIn: null, minExpiresIn: 1, maxExpiresIn: API_KEY_MAX_DAYS },
        // Our own per-key limit (`consumeApiKeyRequest`) replaces this one.
        rateLimit: { enabled: false },
        enableMetadata: false,
        schema: { apikey: { modelName: "apiKey" } },
      }),
      // Budgets are organizations. Its HTTP endpoints are blocked in app.ts; our /v1/budgets
      // routes call auth.api.* instead so everything goes through our validation.
      organization({
        ac: budgetAc,
        roles: budgetRoles,
        creatorRole: "owner",
        organizationHooks: {
          afterCreateOrganization: async ({ organization }) => {
            // Every budget needs these, however it was created.
            await seedInternalCategories(db, organization.id);
          },
          // Split lines would block the cascade from the budget to its categories.
          beforeDeleteOrganization: async ({ organization }) => {
            await deleteBudgetTransactions(db, organization.id);
          },
        },
        schema: {
          organization: {
            modelName: "budget",
            additionalFields: {
              currency: { type: "string", required: true, input: true },
              numberFormat: { type: "string", required: true, input: true },
              currencySymbolPosition: { type: "string", required: true, input: true },
              dateFormat: { type: "string", required: true, input: true },
            },
          },
          member: { modelName: "budgetMember", fields: { organizationId: "budgetId" } },
          invitation: { modelName: "budgetInvitation", fields: { organizationId: "budgetId" } },
        },
      }),
      // Signs the MCP access tokens (JWTs the /mcp endpoint verifies against /jwks).
      jwt({ disableSettingJwtHeader: true }),
      // The OAuth 2.1 authorization server MCP clients (Claude, Cursor, …) sign in through. The
      // web app's /oauth/authorize page signs the person in and sends them back; /oauth/consent
      // asks what the client may do.
      mcp({
        resource: mcpResource(env),
        loginPage: `${web}/oauth/authorize`,
        consentPage: `${web}/oauth/consent`,
        scopes: ["openid", "profile", "email", "offline_access", ...MCP_SCOPES],
        // Short-lived: a disconnected client's token is refused at once anyway (connected_agent),
        // but a shorter life bounds what a leaked token can do.
        accessTokenExpiresIn: 15 * 60,
        // Clients register themselves: by a client metadata URL (CIMD, below) where they support
        // it, otherwise by dynamic registration (Claude Code, Cursor and others today).
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultApplicationType: "infer",
      }),
      cimd({
        // Fetches only public addresses, pinned, without redirects.
        fetchClientMetadataResource,
        metadataProfile: "mcp-2026-07-28",
      }),
      // Agent Auth Protocol: agents register, the person approves their capabilities (one per API
      // operation) in the web app, and they call them through POST /api/auth/capability/execute.
      agentAuth(agentAuthOptions({ env, db, runtime: agentRuntime })),
    ],
  });
  return Object.assign(auth, { agentRuntime });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthUser = Auth["$Infer"]["Session"]["user"];
export type AuthSession = Auth["$Infer"]["Session"]["session"];
