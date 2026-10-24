import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", worker: "src/worker.ts", migrate: "src/scripts/migrate.ts" },
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: true,
  clean: true,
  // Workspace packages ship TypeScript source, so they must be bundled into the server.
  deps: { alwaysBundle: [/^@strictbudget\//] },
});
