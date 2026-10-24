import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig({
  // Router plugin must come before the React plugin.
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Source maps for reading minified stacks from error reports, without the
  // `sourceMappingURL` comment that would make browsers fetch them.
  build: { sourcemap: "hidden" },
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin in dev: the browser only ever talks to :5173, so auth cookies just work. The
    // API reference (/docs and its spec) comes along, as it does where the API serves the app.
    proxy: {
      "/v1": apiTarget,
      "/api": apiTarget,
      "/docs": apiTarget,
      "/openapi.json": apiTarget,
      // The MCP endpoint and OAuth / agent discovery documents.
      "/mcp": apiTarget,
      "/.well-known": apiTarget,
    },
  },
});
