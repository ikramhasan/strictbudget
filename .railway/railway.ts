import {
  bucket,
  defineRailway,
  github,
  postgres,
  preserve,
  project,
  ref,
  service,
} from "railway/iac";

/**
 * The app: one service built from the repo's Dockerfile (API + web app on one origin), Postgres,
 * and a bucket for transaction attachments. The image is the same one any host runs. Next to it,
 * the marketing site (apps/site), a static build served by Caddy.
 */
/**
 * The service has the custom domain and a Railway one, so RAILWAY_PUBLIC_DOMAIN could name either.
 * PR environments (served only on their own Railway domain) take their URL from
 * RAILWAY_PUBLIC_DOMAIN instead (`isPreviewDeploy` in apps/api/src/env.ts).
 */
const PUBLIC_URL = "https://web.strictbudget.app";
const REPO = "ikramhasan/strictbudget";
// US East (Virginia), where most customers are, next to the bucket.
const REGION = "us-east4-eqdc4a";

export default defineRailway(() => {
  const db = postgres("db", { region: REGION });
  // Private and S3-compatible; the API hands browsers presigned links (bucket egress is free).
  // A bucket's region can't change once it exists (iad is US East).
  const files = bucket("files", { region: "iad" });

  const app = service("strictbudget", {
    // Deploys every push to main once its CI checks pass. Needs Railway's GitHub app on the repo.
    source: github(REPO, { branch: "main", checkSuites: true }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
      // Everything but the marketing site, which has its own service.
      watchPatterns: ["**", "!/apps/site/**"],
    },
    replicas: { [REGION]: 1 },
    domains: ["web.strictbudget.app"],
    // Migrations and the job queue's schema, once per deploy, before the new version starts.
    preDeploy: "node dist/migrate.mjs",
    healthcheck: "/v1/health",
    healthcheckTimeout: 60,
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      // Email is required (`isCloud` in apps/api/src/env.ts).
      STRICTBUDGET_DEPLOYMENT: "cloud",
      BETTER_AUTH_URL: PUBLIC_URL,
      WEB_ORIGIN: PUBLIC_URL,
      // Railway's edge overwrites X-Real-IP on every request and publishes no proxy ranges, so
      // rate limits read it rather than X-Forwarded-For through TRUSTED_PROXIES. This holds only
      // while the domains' DNS records aren't proxied by Cloudflare (its IP would be the client's).
      CLIENT_IP_HEADER: "x-real-ip",
      OTEL_SERVICE_NAME: "strictbudget-api",
      BETTER_AUTH_SECRET: preserve(),
      RESEND_API_KEY: preserve(),
      FROM_EMAIL: preserve(),
      AI_API_KEY: preserve(),
      TINYFISH_API_KEY: preserve(),
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: preserve(),
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: preserve(),
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: preserve(),
      OTEL_EXPORTER_OTLP_LOGS_HEADERS: preserve(),
      S3_BUCKET: ref(files, "BUCKET"),
      S3_ENDPOINT: ref(files, "ENDPOINT"),
      S3_REGION: ref(files, "REGION"),
      S3_ACCESS_KEY_ID: ref(files, "ACCESS_KEY_ID"),
      S3_SECRET_ACCESS_KEY: ref(files, "SECRET_ACCESS_KEY"),
    },
  });

  // strictbudget.app. Static, so it needs no variables; www redirects to the apex (its Caddyfile).
  const site = service("site", {
    source: github(REPO, { branch: "main", checkSuites: true }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "apps/site/Dockerfile",
      watchPatterns: [
        "/apps/site/**",
        "/packages/ui/**",
        "/package.json",
        "/pnpm-lock.yaml",
        "/pnpm-workspace.yaml",
      ],
    },
    replicas: { [REGION]: 1 },
    domains: ["strictbudget.app", "www.strictbudget.app"],
    healthcheck: "/",
  });

  return project("strictbudget", { resources: [app, site, db, files] });
});
