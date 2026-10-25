import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json", origin: "http://localhost:5173" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("preferences", () => {
  it("defaults to opening the last budget with shortcuts on; changes one at a time", async () => {
    const user = await signUp(app);
    const read = async () => (await send("GET", "/v1/me/preferences", user.cookie)).json();
    expect(await read()).toEqual({
      openLastBudget: true,
      keyboardShortcuts: true,
      displayCurrency: null,
    });
    const saved = await send("PATCH", "/v1/me/preferences", user.cookie, { openLastBudget: false });
    expect(await saved.json()).toEqual({
      openLastBudget: false,
      keyboardShortcuts: true,
      displayCurrency: null,
    });
    await send("PATCH", "/v1/me/preferences", user.cookie, { keyboardShortcuts: false });
    expect(await read()).toEqual({
      openLastBudget: false,
      keyboardShortcuts: false,
      displayCurrency: null,
    });
    const other = await signUp(app);
    expect(await (await send("GET", "/v1/me/preferences", other.cookie)).json()).toEqual({
      openLastBudget: true,
      keyboardShortcuts: true,
      displayCurrency: null,
    });
  });

  it("keeps a display currency until it's set back to the budget's (null)", async () => {
    const user = await signUp(app);
    const patch = (body: unknown) => send("PATCH", "/v1/me/preferences", user.cookie, body);
    const read = async () =>
      (
        (await (await send("GET", "/v1/me/preferences", user.cookie)).json()) as {
          displayCurrency: string | null;
        }
      ).displayCurrency;
    expect((await patch({ displayCurrency: "EUR" })).status).toBe(200);
    expect(await read()).toBe("EUR");
    expect((await patch({ displayCurrency: "XYZ" })).status).toBe(400);
    expect(await read()).toBe("EUR");
    await patch({ displayCurrency: null });
    expect(await read()).toBeNull();
  });

  it("changes the first name", async () => {
    const user = await signUp(app, { name: "Old" });
    const res = await send("POST", "/api/auth/update-user", user.cookie, { name: "Robin" });
    expect(res.status).toBe(200);
    const me = (await (await send("GET", "/v1/me", user.cookie)).json()) as { name: string };
    expect(me.name).toBe("Robin");
  });
});
