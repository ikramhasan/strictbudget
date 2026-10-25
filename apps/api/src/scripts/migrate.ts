import { runMigrations } from "@strictbudget/db";
import { isPreviewDeploy, parseEnv } from "../env";
import { seedDemoUser } from "../lib/demo-user";
import { installJobs } from "../lib/jobs/install";
import { loadRootEnv } from "../load-env";

/**
 * The deploy step: database migrations, then the job queue's schema and queues. Run it once per
 * release before the new version starts (`pnpm db:migrate`; in the image, `node dist/migrate.mjs`).
 * A Railway PR environment starts with an empty database, so there it also adds the demo user
 * and its sample budget.
 */
if (process.env.NODE_ENV !== "production") loadRootEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

await runMigrations(url);
await installJobs(url);
console.log("Migrations applied");

if (isPreviewDeploy()) {
  const env = parseEnv();
  await seedDemoUser(env);
  console.log(`Preview: demo user and sample budget ready (${env.WEB_ORIGIN})`);
}
