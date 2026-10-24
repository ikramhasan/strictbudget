import { defineConfig } from "vitest/config";
import { TEST_WORKERS } from "./test/worker-db";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    // Test files run in parallel, each worker on its own copy of the test database (global-setup).
    maxWorkers: TEST_WORKERS,
    // Files share a worker's modules instead of importing the whole app again (~3 s a file).
    // Nothing keeps state between files: each one creates its own app (createTestApp) and resets
    // the database per test; spies and stubbed env are undone after every test.
    isolate: false,
    restoreMocks: true,
    unstubEnvs: true,
    // Most tests sign up through Better Auth (scrypt-hashing the password at sign-up and again at
    // sign-in), so a test that takes ~1 s alone can pass 5 s when the machine is busy (dev
    // servers, a browser, other checkouts' test runs). Keep tests short; this only stops load
    // from failing them.
    testTimeout: 15_000,
  },
});
