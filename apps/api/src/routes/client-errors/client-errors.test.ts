import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, resetDatabase } from "../../../test/helpers";
import { CLIENT_ERRORS_PER_CLIENT } from "../../lib/throttle";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterEach(() => vi.restoreAllMocks());
afterAll(close);

const report = (body: unknown, client = "203.0.113.7") =>
  app.request("/v1/client-errors", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": client },
    body: JSON.stringify(body),
  });

describe("POST /v1/client-errors", () => {
  it("logs a web app error without a session, keeping the page's path only", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await report({
      message: "TypeError: x is undefined",
      stack: "at a (index-abc.js:1:2)",
      path: "/invitation#token=secret-token",
    });
    expect(res.status).toBe(204);
    expect(logged).toHaveBeenCalledTimes(1);
    const [message, attributes] = logged.mock.calls[0] ?? [];
    expect(message).toBe("Web app error");
    expect(attributes).toMatchObject({
      source: "web",
      path: "/invitation",
      "exception.message": "TypeError: x is undefined",
    });
    expect(JSON.stringify(attributes)).not.toContain("secret-token");
  });

  it("drops reports past the limit per client, and answers the same", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < CLIENT_ERRORS_PER_CLIENT + 3; i++) {
      expect((await report({ message: `boom ${i}` })).status).toBe(204);
    }
    expect(logged).toHaveBeenCalledTimes(CLIENT_ERRORS_PER_CLIENT);
    expect((await report({ message: "another client" }, "198.51.100.1")).status).toBe(204);
    expect(logged).toHaveBeenCalledTimes(CLIENT_ERRORS_PER_CLIENT + 1);
  });

  it("masks quoted text and amounts, keeping stack positions", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await report({
      message: `Error: can't save "Costco Wholesale" for $1,234.56`,
      stack: "Error: x\n    at save (https://app.example/assets/index-abc.js:12:345)",
    });
    const [, attributes] = logged.mock.calls[0] ?? [];
    const text = JSON.stringify(attributes);
    expect(text).not.toContain("Costco");
    expect(text).not.toContain("1,234");
    expect(text).toContain("index-abc.js:12:345");
  });

  it("refuses an empty report", async () => {
    expect((await report({ message: "" })).status).toBe(400);
  });
});
