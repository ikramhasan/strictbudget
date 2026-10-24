import { newId } from "@strictbudget/db";
import { budgetMember, user } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../test/helpers";
import {
  forgetFormerMemberColor,
  keepFormerMemberColor,
  memberAvatarColors,
} from "./member-colors";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

describe("former members keep their avatar colour", () => {
  async function budgetWith(names: string[]) {
    const [first = "Owner", ...rest] = names;
    const owner = await signUp(app, { name: first });
    const { id: budgetId } = await createBudget(app, owner.cookie);
    const members = await db.select().from(budgetMember).where(eq(budgetMember.budgetId, budgetId));
    const ids = [members[0]?.userId ?? ""];
    for (const [i, name] of rest.entries()) {
      const id = newId();
      ids.push(id);
      await db.insert(user).values({ id, name, email: `${id}@x.test`, emailVerified: true });
      await db.insert(budgetMember).values({
        id: newId(),
        budgetId,
        userId: id,
        role: "editor",
        createdAt: new Date(Date.now() + (i + 1) * 1000),
      });
    }
    return { budgetId, ids };
  }

  it("keeps a leaver's colour while later members shift up, and drops it on rejoin", async () => {
    const { budgetId, ids } = await budgetWith(["Owner", "Pat", "Sam"]);
    const [, pat, sam] = ids as [string, string, string];
    await db.transaction((tx) => keepFormerMemberColor(tx, budgetId, pat));
    await db.delete(budgetMember).where(eq(budgetMember.userId, pat));
    const colors = await memberAvatarColors(db, budgetId);
    expect(colors.get(pat)).toEqual({ color: 2, removed: true });
    // Sam moves up to the second place; Pat keeps the colour they had.
    expect(colors.get(sam)).toEqual({ color: 2, removed: false });

    await db.transaction((tx) => forgetFormerMemberColor(tx, budgetId, pat));
    expect((await memberAvatarColors(db, budgetId)).has(pat)).toBe(false);
  });
});
