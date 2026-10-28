// Usage: BUDGET=<id> COOKIE_FILE=<file> node shot.mjs <path-after-/budgets/ID> <out.png> [step...]
// Opens the page in the production preview (localhost:5173) at 1440×900 @2x with the demo user's
// session cookie and saves a screenshot. Steps: "role:<role>:<name>" clicks, "eval:<js>",
// "wait:<ms>", or text to click. FULL=1 for a full-page shot, THEME=dark for dark, VW/VH for
// another viewport size.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/opt/");
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = await import("playwright"));
}

const [, , path, out, ...clicks] = process.argv;
const BUDGET = process.env.BUDGET;
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: Number(process.env.VW ?? 1440), height: Number(process.env.VH ?? 900) },
  deviceScaleFactor: 2,
  colorScheme: process.env.THEME === "dark" ? "dark" : "light",
});
const page = await context.newPage();
const raw = readFileSync(process.env.COOKIE_FILE, "utf8").trim().replace(/;$/, "");
await context.addCookies(
  raw.split(";").map((pair) => {
    const [name, ...rest] = pair.trim().split("=");
    return { name, value: rest.join("="), domain: "localhost", path: "/" };
  }),
);
await page.goto(`http://localhost:5173/budgets/${BUDGET}${path}`);
await page.waitForLoadState("networkidle");
await page.waitForTimeout(1200);
for (const c of clicks) {
  if (c.startsWith("wait:")) {
    await page.waitForTimeout(Number(c.slice(5)));
    continue;
  }
  if (c.startsWith("eval:")) {
    await page.evaluate(c.slice(5));
    continue;
  }
  if (c.startsWith("role:")) {
    const [, role, name] = c.split(":");
    await page.getByRole(role, { name, exact: true }).first().click();
  } else {
    await page.getByText(c, { exact: true }).first().click();
  }
  await page.waitForTimeout(900);
}
await page.mouse.move(0, 0);
await page.screenshot({ path: out, fullPage: process.env.FULL === "1" });
await browser.close();
