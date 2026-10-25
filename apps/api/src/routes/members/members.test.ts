import { budgetInvitation } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBudget,
  createTestApp,
  emailsTo,
  linkToken,
  resetDatabase,
  signUp,
} from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Members = {
  members: { userId: string; email: string; role: string; avatarColor: number }[];
  invitations: { id: string; email: string; name: string; expired: boolean }[];
  maxPeople: number;
};
type ErrorBody = { error: { code: string; message: string } };

function send(method: string, path: string, cookie: string | null, body?: unknown) {
  return app.request(path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;
const code = async (res: Response) => (await json<ErrorBody>(res)).error.code;

async function setup() {
  const owner = await signUp(app, { name: "Owner" });
  const budget = await createBudget(app, owner.cookie);
  const base = `/v1/budgets/${budget.id}`;
  const invite = (email: string, name = "Pat", cookie = owner.cookie) =>
    send("POST", `${base}/invitations`, cookie, { name, email });
  const members = async (cookie = owner.cookie) =>
    json<Members>(await send("GET", `${base}/members`, cookie));
  return { owner, budget, base, invite, members };
}

describe("budget invitations", () => {
  it("invites by email; the invitee views the link, signs up and joins as an editor", async () => {
    const { owner, budget, invite, members } = await setup();
    const email = `pat-${crypto.randomUUID()}@example.com`;
    const res = await invite(email.toUpperCase());
    expect(res.status).toBe(201);
    const listed = await members();
    expect(listed.invitations).toEqual([
      expect.objectContaining({ email, name: "Pat", expired: false }),
    ]);
    expect(listed.maxPeople).toBe(6);

    const sent = await emailsTo(app, email, "budget-invitation");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain(owner.email);
    // Free text (the budget's name) stays out of the email.
    expect(sent[0]?.text).not.toContain(budget.name);
    const token = linkToken(sent[0]);

    const view = await send("POST", "/v1/invitations/view", null, { token });
    expect(view.status).toBe(200);
    expect(await json(view)).toMatchObject({
      email,
      budgetName: budget.name,
      inviterName: "Owner",
      inviterEmail: owner.email,
    });

    const pat = await signUp(app, { email });
    const accepted = await send("POST", "/v1/invitations/accept", pat.cookie, { token });
    expect(accepted.status).toBe(200);
    expect(await json(accepted)).toEqual({ budgetId: budget.id });

    const after = await members();
    // Avatar colours: the owner 1, then 2 onwards by when they joined.
    expect(after.members.map((m) => [m.email, m.role, m.avatarColor])).toEqual([
      [owner.email, "owner", 1],
      [email, "editor", 2],
    ]);
    expect(after.invitations).toEqual([]);
    expect((await members(pat.cookie)).invitations).toEqual([]);

    expect((await send("POST", "/v1/invitations/accept", pat.cookie, { token })).status).toBe(404);
  });

  it("only accepts for the invited address", async () => {
    const { invite } = await setup();
    const email = `pat-${crypto.randomUUID()}@example.com`;
    await invite(email);
    const token = linkToken((await emailsTo(app, email, "budget-invitation"))[0]);
    const stranger = await signUp(app);
    const res = await send("POST", "/v1/invitations/accept", stranger.cookie, { token });
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("INVITATION_EMAIL_MISMATCH");
    expect((await send("POST", "/v1/invitations/accept", null, { token })).status).toBe(401);
  });

  it("refuses members, duplicates and a seventh person", async () => {
    const { owner, invite } = await setup();
    expect(await code(await invite(owner.email))).toBe("ALREADY_MEMBER");
    for (let i = 0; i < 5; i++) {
      expect((await invite(`p${i}-${crypto.randomUUID()}@example.com`)).status).toBe(201);
    }
    const again = await invite("x@example.com");
    expect(again.status).toBe(409);
    expect(await code(again)).toBe("BUDGET_FULL");
  });

  it("won't invite the same address twice, but resends with a new link", async () => {
    const { base, owner, invite, members } = await setup();
    const email = `pat-${crypto.randomUUID()}@example.com`;
    await invite(email);
    expect(await code(await invite(email))).toBe("ALREADY_INVITED");
    const first = linkToken((await emailsTo(app, email, "budget-invitation"))[0]);
    const { invitations } = await members();
    const id = invitations[0]?.id;
    const resent = await send("POST", `${base}/invitations/${id}/resend`, owner.cookie);
    expect(resent.status).toBe(200);
    const sent = await emailsTo(app, email, "budget-invitation");
    expect(sent).toHaveLength(2);
    const second = linkToken(sent[1]);
    expect(second).not.toBe(first);
    expect((await send("POST", "/v1/invitations/view", null, { token: first })).status).toBe(404);
    expect((await send("POST", "/v1/invitations/view", null, { token: second })).status).toBe(200);
  });

  it("cancels an invitation, and an expired one says so", async () => {
    const { base, owner, invite, members } = await setup();
    const email = `pat-${crypto.randomUUID()}@example.com`;
    await invite(email);
    const token = linkToken((await emailsTo(app, email, "budget-invitation"))[0]);
    const id = (await members()).invitations[0]?.id as string;

    await db
      .update(budgetInvitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(budgetInvitation.id, id));
    const expired = await send("POST", "/v1/invitations/view", null, { token });
    expect(expired.status).toBe(410);
    expect(await code(expired)).toBe("INVITATION_EXPIRED");
    expect((await members()).invitations[0]?.expired).toBe(true);
    expect((await invite(email)).status).toBe(201);
    const fresh = (await members()).invitations;
    expect(fresh).toHaveLength(1);

    const canceled = await send("DELETE", `${base}/invitations/${fresh[0]?.id}`, owner.cookie);
    expect(canceled.status).toBe(204);
    expect((await members()).invitations).toEqual([]);
    const latest = linkToken((await emailsTo(app, email, "budget-invitation")).at(-1));
    expect((await send("POST", "/v1/invitations/view", null, { token: latest })).status).toBe(404);
  });

  it("lets only the owner manage invitations", async () => {
    const { base, invite } = await setup();
    const email = `pat-${crypto.randomUUID()}@example.com`;
    await invite(email);
    const pat = await signUp(app, { email });
    const token = linkToken((await emailsTo(app, email, "budget-invitation"))[0]);
    await send("POST", "/v1/invitations/accept", pat.cookie, { token });
    const res = await invite(`x-${crypto.randomUUID()}@example.com`, "X", pat.cookie);
    expect(res.status).toBe(403);
    const stranger = await signUp(app);
    expect((await send("GET", `${base}/members`, stranger.cookie)).status).toBe(404);
  });
});

describe("leaving, removing and transferring ownership", () => {
  async function join(ctx: Awaited<ReturnType<typeof setup>>) {
    const email = `m-${crypto.randomUUID()}@example.com`;
    await ctx.invite(email);
    const person = await signUp(app, { email });
    const token = linkToken((await emailsTo(app, email, "budget-invitation"))[0]);
    await send("POST", "/v1/invitations/accept", person.cookie, { token });
    const id = (await ctx.members()).members.find((m) => m.email === email)?.userId as string;
    return { ...person, id };
  }

  it("lets a member leave, but not the owner", async () => {
    const ctx = await setup();
    const pat = await join(ctx);
    const owner = await send("POST", `${ctx.base}/leave`, ctx.owner.cookie);
    expect(owner.status).toBe(409);
    expect(await code(owner)).toBe("OWNER_CANNOT_LEAVE");
    expect((await send("POST", `${ctx.base}/leave`, pat.cookie)).status).toBe(204);
    expect((await send("GET", ctx.base, pat.cookie)).status).toBe(404);
    expect((await ctx.members()).members).toHaveLength(1);
  });

  it("lets only the owner remove people, never the owner", async () => {
    const ctx = await setup();
    const pat = await join(ctx);
    const sam = await join(ctx);
    const ownerId = (await ctx.members()).members[0]?.userId as string;
    expect((await send("DELETE", `${ctx.base}/members/${sam.id}`, pat.cookie)).status).toBe(403);
    const self = await send("DELETE", `${ctx.base}/members/${ownerId}`, ctx.owner.cookie);
    expect(await code(self)).toBe("CANNOT_REMOVE_OWNER");
    expect((await send("DELETE", `${ctx.base}/members/${sam.id}`, ctx.owner.cookie)).status).toBe(
      204,
    );
    expect((await send("GET", ctx.base, sam.cookie)).status).toBe(404);
    expect((await send("DELETE", `${ctx.base}/members/${sam.id}`, ctx.owner.cookie)).status).toBe(
      404,
    );
  });

  it("transfers ownership; the old owner stays as a member", async () => {
    const ctx = await setup();
    const pat = await join(ctx);
    expect(
      (await send("POST", `${ctx.base}/transfer-ownership`, pat.cookie, { userId: pat.id })).status,
    ).toBe(403);
    const stranger = await signUp(app);
    const nobody = await send("POST", `${ctx.base}/transfer-ownership`, ctx.owner.cookie, {
      userId: "not-a-member",
    });
    expect(nobody.status).toBe(404);
    const res = await send("POST", `${ctx.base}/transfer-ownership`, ctx.owner.cookie, {
      userId: pat.id,
    });
    expect(res.status).toBe(204);
    const roles = (await ctx.members(pat.cookie)).members.map((m) => [m.userId, m.role]);
    expect(roles[0]).toEqual([pat.id, "owner"]);
    expect(roles[1]?.[1]).toBe("editor");
    expect((await ctx.invite(stranger.email, "S", ctx.owner.cookie)).status).toBe(403);
    expect((await ctx.invite(stranger.email, "S", pat.cookie)).status).toBe(201);
    expect((await send("POST", `${ctx.base}/leave`, ctx.owner.cookie)).status).toBe(204);
  });
});
