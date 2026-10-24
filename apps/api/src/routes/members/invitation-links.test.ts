import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBudget,
  createTestApp,
  emailsTo,
  linkToken,
  resetDatabase,
  signUp,
} from "../../../test/helpers";

const withEmail = createTestApp();
const withoutEmail = createTestApp({ sendsEmail: false });
beforeEach(() => resetDatabase(withEmail.db));
afterAll(async () => {
  await withEmail.close();
  await withoutEmail.close();
});

type App = typeof withEmail.app;
type Invitation = { id: string; email: string; delivery: string; link: string | null };
type ErrorBody = { error: { code: string } };

function send(app: App, method: string, path: string, cookie: string | null, body?: unknown) {
  return app.request(path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;

function tokenOf(link: string | null) {
  const token = link && new URLSearchParams(new URL(link).hash.slice(1)).get("token");
  if (!token) throw new Error(`no token in ${link}`);
  return token;
}

async function setup(app: App) {
  const owner = await signUp(app, { name: "Owner" });
  const budget = await createBudget(app, owner.cookie);
  const base = `/v1/budgets/${budget.id}`;
  const email = `pat-${crypto.randomUUID()}@example.com`;
  const invite = (extra: object = {}) =>
    send(app, "POST", `${base}/invitations`, owner.cookie, { name: "Pat", email, ...extra });
  let pat: string | undefined;
  const accept = async (token: string) => {
    pat ??= (await signUp(app, { email, name: "Pat" })).cookie;
    return send(app, "POST", "/v1/invitations/accept", pat, { token });
  };
  return { owner, budget, base, email, invite, accept };
}

describe("invitation links, on a server that sends email", () => {
  it("returns a link to share instead of emailing it; the invitee joins with it", async () => {
    const { app } = withEmail;
    const { budget, email, invite, accept } = await setup(app);
    const res = await invite({ sendEmail: false });
    expect(res.status).toBe(201);
    const invitation = await json<Invitation>(res);
    expect(invitation).toMatchObject({ email, delivery: "link" });
    expect(invitation.link).toMatch(/^http:\/\/localhost:5173\/invitation#token=/);
    expect(await emailsTo(app, email, "budget-invitation")).toHaveLength(0);

    const accepted = await accept(tokenOf(invitation.link));
    expect(accepted.status).toBe(200);
    expect(await json(accepted)).toEqual({ budgetId: budget.id });
  });

  it("emails by default, without a link in the answer", async () => {
    const { app } = withEmail;
    const { email, invite } = await setup(app);
    const invitation = await json<Invitation>(await invite());
    expect(invitation).toMatchObject({ delivery: "email", link: null });
    expect(await emailsTo(app, email, "budget-invitation")).toHaveLength(1);
  });

  it("only lets the owner make a new link", async () => {
    const { app } = withEmail;
    const { base, invite } = await setup(app);
    const { id } = await json<Invitation>(await invite());
    const stranger = await signUp(app);
    const res = await send(app, "POST", `${base}/invitations/${id}/link`, stranger.cookie);
    expect(res.status).toBe(404);
  });

  it("makes a new link that stops the emailed one working", async () => {
    const { app } = withEmail;
    const { owner, base, email, invite, accept } = await setup(app);
    const { id } = await json<Invitation>(await invite());
    const emailed = linkToken((await emailsTo(app, email, "budget-invitation"))[0]);

    const res = await send(app, "POST", `${base}/invitations/${id}/link`, owner.cookie);
    expect(res.status).toBe(200);
    const renewed = await json<Invitation>(res);
    expect(renewed).toMatchObject({ id, delivery: "link" });
    expect(await emailsTo(app, email, "budget-invitation")).toHaveLength(1);

    const view = (token: string) => send(app, "POST", "/v1/invitations/view", null, { token });
    expect((await view(emailed)).status).toBe(404);
    expect((await accept(tokenOf(renewed.link))).status).toBe(200);
  });
});

describe("invitation links, on a server that sends no email", () => {
  it("shares a link by default and refuses to email one", async () => {
    const { app } = withoutEmail;
    const { owner, base, email, invite, accept } = await setup(app);
    const asked = await invite({ sendEmail: true });
    expect(asked.status).toBe(409);
    expect((await json<ErrorBody>(asked)).error.code).toBe("EMAIL_DISABLED");

    const invitation = await json<Invitation>(await invite());
    expect(invitation).toMatchObject({ email, delivery: "link" });

    const resend = await send(
      app,
      "POST",
      `${base}/invitations/${invitation.id}/resend`,
      owner.cookie,
    );
    expect(resend.status).toBe(409);
    expect((await json<ErrorBody>(resend)).error.code).toBe("EMAIL_DISABLED");

    const renewed = await json<Invitation>(
      await send(app, "POST", `${base}/invitations/${invitation.id}/link`, owner.cookie),
    );
    expect((await accept(tokenOf(invitation.link))).status).toBe(404);
    expect((await accept(tokenOf(renewed.link))).status).toBe(200);
  });

  it("still needs the invited address to join", async () => {
    const { app } = withoutEmail;
    const { invite } = await setup(app);
    const { link } = await json<Invitation>(await invite());
    const other = await signUp(app);
    const res = await send(app, "POST", "/v1/invitations/accept", other.cookie, {
      token: tokenOf(link),
    });
    expect(res.status).toBe(403);
    expect((await json<ErrorBody>(res)).error.code).toBe("INVITATION_EMAIL_MISMATCH");
  });
});
