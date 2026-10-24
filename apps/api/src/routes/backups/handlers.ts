import type { RouteHandler } from "@hono/zod-openapi";
import { stream } from "hono/streaming";
import { writeBackup } from "../../lib/backup/export";
import { importBackup as fillFromBackup } from "../../lib/backup/import";
import { createFilledBudget } from "../../lib/backup/new-budget";
import { loadBudgetAccess } from "../../lib/budget-access";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import { toBudgetJson } from "../budgets/handlers";
import type { exportBackup, importBackup } from "./routes";

type Env = AppEnv & AuthedEnv;

/** A file name made of the budget's name and the day: "Household 2026-10-17.strictbudget.json". */
function backupFileName(name: string, now: Date) {
  const safe = name.replace(/[^\p{L}\p{N} _-]+/gu, " ").trim() || "budget";
  return `${safe} ${now.toISOString().slice(0, 10)}.strictbudget.json`;
}

export const exportBackupHandler: RouteHandler<typeof exportBackup, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { budget } = await loadBudgetAccess(c, budgetId);
  const now = new Date();
  c.header("Content-Type", "application/json; charset=utf-8");
  c.header("Cache-Control", "no-store");
  c.header(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(backupFileName(budget.name, now))}`,
  );
  const { db } = c.var.deps;
  // One read-only snapshot, so every reference in the file resolves inside it even while the
  // budget is being edited.
  return stream(c, async (s) => {
    await db.transaction(
      (tx) =>
        writeBackup(
          tx,
          budget,
          async (chunk) => {
            await s.write(chunk);
          },
          now,
        ),
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }) as never;
};

export const importBackupHandler: RouteHandler<typeof importBackup, Env> = async (c) => {
  const doc = c.req.valid("json");
  const { name } = c.req.valid("query");
  const { budgetId, result: counts } = await createFilledBudget(
    c,
    { ...doc.budget, name: name ?? doc.budget.name },
    (tx, id) => fillFromBackup(tx, doc, id),
  );
  return c.json({ budget: toBudgetJson(await loadBudgetAccess(c, budgetId)), counts }, 201);
};
