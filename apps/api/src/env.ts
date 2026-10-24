import { ANTHROPIC_MODELS } from "@tanstack/ai-anthropic";
import { z } from "zod";

/** An empty value in .env means "unset". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    /**
     * `self-hosted` (default) or `cloud`, the hosted strictbudget we run. Cloud requires what running
     * the service needs (email); self-hosted leaves those optional (`isCloud`).
     */
    STRICTBUDGET_DEPLOYMENT: optional(z.enum(["self-hosted", "cloud"])).transform(
      (v) => v ?? "self-hosted",
    ),
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
    BETTER_AUTH_URL: z.url(),
    WEB_ORIGIN: z.url(),
    /**
     * Resend API key. Without it, development logs emails to the console instead of sending, and a
     * self-hosted production server sends none (`createEmailSender`). Cloud requires it.
     */
    RESEND_API_KEY: optional(z.string().startsWith("re_", "must be a Resend API key (re_…)")),
    /**
     * Sender: an address (`hello@example.com`), a display form (`strictbudget <hello@example.com>`),
     * or just a verified sending domain (`mail.example.com`, sent as `no-reply@` that domain).
     */
    FROM_EMAIL: optional(z.string().min(3)),
    /**
     * Comma-separated CIDRs of the reverse proxies in front of the API. Rate limits key on the
     * client IP from `x-forwarded-for`; with this set, the chain is trusted only through these hops.
     */
    TRUSTED_PROXIES: optional(z.string()),
    /**
     * A header the host's edge sets to the client's IP and overwrites on every request, read
     * instead of `x-forwarded-for` (Railway: `x-real-ip`; it publishes no proxy ranges for
     * TRUSTED_PROXIES). Only safe when clients can't reach the API except through that edge.
     */
    CLIENT_IP_HEADER: optional(
      z
        .string()
        .regex(/^[A-Za-z0-9-]+$/)
        .toLowerCase(),
    ),
    /**
     * `all` (default): the API process also runs background jobs. `api`: it only queues them, and
     * a separate `node dist/worker.mjs` process runs them.
     */
    JOBS_MODE: z.enum(["all", "api"]).default("all"),
    /**
     * The built web app (`apps/web/dist`) for the API to serve on the same origin; the Docker
     * image sets it. Unset, the API serves only the API (development runs Vite).
     */
    WEB_DIST_DIR: optional(z.string().min(1)),
    /**
     * Transaction attachments go to an S3-compatible bucket when S3_BUCKET and its keys are set
     * (Railway Buckets: reference the bucket's BUCKET, ENDPOINT, REGION, ACCESS_KEY_ID and
     * SECRET_ACCESS_KEY). S3_ENDPOINT is unset for AWS itself.
     */
    S3_BUCKET: optional(z.string().min(1)),
    S3_ENDPOINT: optional(z.url()),
    S3_REGION: optional(z.string().min(1)).transform((v) => v ?? "auto"),
    S3_ACCESS_KEY_ID: optional(z.string().min(1)),
    S3_SECRET_ACCESS_KEY: optional(z.string().min(1)),
    /** Path-style bucket URLs (older Railway buckets, MinIO). */
    S3_FORCE_PATH_STYLE: optional(z.enum(["true", "false"])).transform((v) => v === "true"),
    /**
     * Without a bucket, attachments are files under this directory (development defaults to
     * `.storage`). Production with neither turns attachments off.
     */
    STORAGE_DIR: optional(z.string().min(1)),
    /**
     * An Anthropic API key for the in-app AI assistant (TanStack AI's Anthropic adapter). Unset,
     * in-app AI is off for every budget and budget settings say why.
     */
    AI_API_KEY: optional(z.string().min(1)),
    AI_MODEL: optional(z.enum(ANTHROPIC_MODELS)).transform((v) => v ?? "claude-sonnet-5-5"),
  })
  .superRefine((env, ctx) => {
    const s3 = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;
    if (s3.some((key) => env[key])) {
      for (const key of s3) {
        if (!env[key])
          ctx.addIssue({ code: "custom", path: [key], message: "required with S3_BUCKET" });
      }
    }
    if (env.RESEND_API_KEY && !env.FROM_EMAIL) {
      ctx.addIssue({
        code: "custom",
        path: ["FROM_EMAIL"],
        message: "required with RESEND_API_KEY",
      });
    }
    if (env.NODE_ENV !== "production" || env.STRICTBUDGET_DEPLOYMENT !== "cloud") return;
    for (const key of ["RESEND_API_KEY", "FROM_EMAIL"] as const) {
      if (!env[key])
        ctx.addIssue({ code: "custom", path: [key], message: "required in cloud production" });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

type EnvSource = Record<string, string | undefined>;

/** The hosted strictbudget we run, rather than a self-hosted server. */
export function isCloud(env: Pick<Env, "STRICTBUDGET_DEPLOYMENT">): boolean {
  return env.STRICTBUDGET_DEPLOYMENT === "cloud";
}

/**
 * A Railway PR environment: a deploy Railway made from a git branch other than `main`, the only
 * branch production deploys (`.railway/railway.ts`). Railway sets RAILWAY_GIT_BRANCH only on
 * deploys it triggered from GitHub, so a manual redeploy, CI or any other host reads as false.
 */
export function isPreviewDeploy(source: EnvSource = process.env): boolean {
  const branch = source.RAILWAY_GIT_BRANCH;
  return Boolean(source.RAILWAY_ENVIRONMENT_ID && branch && branch !== "main");
}

/**
 * A PR environment copies production's variables, URLs included, but is served only on its own
 * Railway domain (custom domains aren't copied), so there that domain is the public URL.
 */
function withPreviewUrl(source: EnvSource): EnvSource {
  const domain = source.RAILWAY_PUBLIC_DOMAIN;
  if (!isPreviewDeploy(source) || !domain) return source;
  const url = `https://${domain}`;
  return { ...source, BETTER_AUTH_URL: url, WEB_ORIGIN: url };
}

export function parseEnv(source: EnvSource = process.env): Env {
  const result = EnvSchema.safeParse(withPreviewUrl(source));
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
