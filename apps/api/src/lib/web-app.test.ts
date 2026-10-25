import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRouter } from "./router";
import { serveWebApp } from "./web-app";

const root = mkdtempSync(join(tmpdir(), "strictbudget-web-"));
mkdirSync(join(root, "assets"));
writeFileSync(join(root, "index.html"), "<!doctype html><div id=root></div>");
writeFileSync(join(root, "assets", "index-abc.js"), "console.log(1)");
writeFileSync(join(root, "assets", "index-abc.js.map"), "{}");

const app = createRouter();
app.get("/v1/health", (c) => c.json({ status: "ok" }));
serveWebApp(app, root);
app.notFound((c) => c.json({ error: { code: "NOT_FOUND" } }, 404));

describe("serving the web app", () => {
  it("serves files, and the app shell for client-side routes", async () => {
    const home = await app.request("/");
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("id=root");
    expect(home.headers.get("cache-control")).toBe("no-cache");

    const route = await app.request("/budgets/b-1/plan");
    expect(route.status).toBe(200);
    expect(await route.text()).toContain("id=root");

    const asset = await app.request("/assets/index-abc.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("leaves the API, missing assets and source maps alone", async () => {
    expect((await app.request("/v1/health")).status).toBe(200);
    const missingApi = await app.request("/v1/nope");
    expect(missingApi.status).toBe(404);
    expect(await missingApi.json()).toEqual({ error: { code: "NOT_FOUND" } });
    expect((await app.request("/assets/missing.js")).status).toBe(404);
    expect((await app.request("/assets/index-abc.js.map")).status).toBe(404);
  });
});
