import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

const TESTS = "src/**/*.test.{ts,tsx}";

/**
 * Test files that replace modules or globals for the whole file (vi.mock, or vi.hoisted to swap
 * fetch before the API client is imported). They run isolated, with a fresh module registry each;
 * the rest share their worker's modules, which skips re-importing React, Radix and the app for
 * every file (~3x faster). In a shared worker such a replacement would leak into the next file.
 */
const isolated = globSync(TESTS, { cwd: import.meta.dirname }).filter((file) =>
  /\bvi\.(mock|doMock|hoisted|stubGlobal|useFakeTimers)\(/.test(
    readFileSync(join(import.meta.dirname, file), "utf8"),
  ),
);

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      // Under a full parallel run (pnpm check) a test that renders a long list (the currency
      // picker's ~160 options) and types into it can pass 5 s; one that times out keeps typing
      // into the next test's form. Same allowance as the API tests.
      testTimeout: 15_000,
      restoreMocks: true,
      unstubEnvs: true,
      projects: [
        { extends: true, test: { name: "isolated", include: isolated } },
        {
          extends: true,
          test: { name: "shared", include: [TESTS], exclude: isolated, isolate: false },
        },
      ],
    },
  }),
);
