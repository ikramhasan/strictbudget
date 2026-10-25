import { createDb, runMigrations, sql } from "@strictbudget/db";
import { JOBS_SCHEMA } from "../src/lib/jobs";
import { installJobs } from "../src/lib/jobs/install";
import { loadRootEnv } from "../src/load-env";
import { TEST_WORKERS, workerDatabaseUrl } from "./worker-db";

export default async function setup() {
  loadRootEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
  await runMigrations(url);
  await installJobs(url);
  // Each test worker has a database of its own, so files can run in parallel. One left from an
  // earlier run is migrated in place: DROP DATABASE forces a checkpoint, which costs seconds
  // after a test run. Tests empty the tables themselves (resetDatabase); old jobs are cleared here.
  // A missing one is copied from the migrated database (connected to `postgres`: copying a
  // database needs no other session on it).
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const { db, close } = createDb(admin.toString(), { max: 1 });
  try {
    const template = new URL(url).pathname.slice(1);
    const existing = new Set(
      (await db.execute<{ datname: string }>(sql`SELECT datname FROM pg_database`)).map(
        (r) => r.datname,
      ),
    );
    const reused: string[] = [];
    for (let worker = 1; worker <= TEST_WORKERS; worker++) {
      const workerUrl = workerDatabaseUrl(url, worker);
      const name = new URL(workerUrl).pathname.slice(1);
      if (existing.has(name)) reused.push(workerUrl);
      else await db.execute(sql.raw(`CREATE DATABASE "${name}" TEMPLATE "${template}"`));
    }
    await Promise.all(reused.map(prepareReused));
  } finally {
    await close();
  }
}

async function prepareReused(url: string) {
  await runMigrations(url);
  await installJobs(url);
  const { db, close } = createDb(url, { max: 1 });
  try {
    await db.execute(sql.raw(`TRUNCATE "${JOBS_SCHEMA}".job, "${JOBS_SCHEMA}".job_dependency`));
  } finally {
    await close();
  }
}
