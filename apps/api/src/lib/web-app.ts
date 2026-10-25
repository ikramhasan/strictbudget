import { serveStatic } from "@hono/node-server/serve-static";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../types";

/** Paths the API answers itself; everything else is the web app. */
const API_PATH = /^\/(v1|api)(\/|$)|^\/(docs|openapi\.json)$/;

/**
 * Serves the built web app (`apps/web/dist`) from the API, so one service and one origin run
 * strictbudget: cookies and the API need no cross-origin setup. Hashed assets are cached for a year;
 * any other path that isn't a file gets `index.html` (the web app routes on the client). Source
 * maps are built for reading error reports, not served.
 */
export function serveWebApp(app: OpenAPIHono<AppEnv>, root: string) {
  const files = serveStatic<AppEnv>({ root });
  const shell = serveStatic<AppEnv>({ root, path: "index.html" });
  const cached = (res: Response, path: string) => {
    res.headers.set(
      "Cache-Control",
      path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    );
    return res;
  };
  app.get("*", async (c, next) => {
    const path = c.req.path;
    if (API_PATH.test(path) || path.endsWith(".map")) return next();
    // A file that exists, else the app shell for a client-side route (but not for a missing
    // asset, which should stay a 404).
    const file = await files(c, async () => {});
    if (file) return cached(file, path);
    if (path.startsWith("/assets/")) return next();
    const page = await shell(c, next);
    return page ? cached(page, "/index.html") : page;
  });
}
