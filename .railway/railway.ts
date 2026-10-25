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
 * One service built from the repo's Dockerfile (API + web app on one origin), Postgres, and a
 * bucket for transaction attachments. The image is the same one any host runs.
 */
/**
 * The service has the custom domain and a Railway one, so RAILWAY_PUBLIC_DOMAIN could name either.
 * PR environments (served only on their own Railway domain) take their URL from
 * RAILWAY_PUBLIC_DOMAIN instead (`isPreviewDeploy` in apps/api/src/env.ts).
 */
const PUBLIC_URL = "https://everycent.ikramhasan.com";

export default defineRailway(() => {
  const db = postgres("postgres");
  // Private and S3-compatible; the API hands browsers presigned links (bucket egress is free).
  // Next to the service (Singapore); a bucket's region can't change once it exists.
  const files = bucket("attachments", { region: "sin" });

  const app = service("strictbudget", {
    // Deploys every push to main once its CI checks pass. Needs Railway's GitHub app on the repo.
    source: github("ikramhasan/strictbudget", { branch: "main", checkSuites: true }),
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
      // rate limits read it rather than X-Forwarded-For through TRUSTED_PROXIES.
      CLIENT_IP_HEADER: "x-real-ip",
      BETTER_AUTH_SECRET: preserve(),
      RESEND_API_KEY: preserve(),
      FROM_EMAIL: preserve(),
      OTEL_SERVICE_NAME: preserve(),
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

  return project("strictbudget", { resources: [app, db, files] });
});
