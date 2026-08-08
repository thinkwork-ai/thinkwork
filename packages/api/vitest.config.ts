import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Subpath aliases MUST precede the package-root alias — vite alias keys
      // are prefix matches applied in order.
      "@thinkwork/pi-runtime-core/provenance": path.resolve(
        __dirname,
        "../pi-runtime-core/src/provenance.ts",
      ),
      "@thinkwork/pi-runtime-core": path.resolve(
        __dirname,
        "../pi-runtime-core/src/index.ts",
      ),
      "@thinkwork/pi-extensions": path.resolve(
        __dirname,
        "../pi-extensions/src/index.ts",
      ),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/**/*.test.ts",
      // One-shot scripts that mutate prod data (backfills, wipes)
      // live under scripts/ to keep them out of the normal API
      // entry-point graph. Their logic is still unit-tested with
      // mocked db.execute.
      "scripts/**/*.test.ts",
      // Unit 8 — integration tests for the skill-runs surface. They
      // use the harness under test/integration/skill-runs/_harness/
      // and never talk to real infra. See that directory's README.
      "test/integration/**/*.test.ts",
      "../../seeds/eval-test-cases/__tests__/**/*.test.ts",
    ],
    // Sandbox E2E tests hit live infra (deployed stage). They are
    // opted into via `pnpm sandbox:e2e` (separate config below).
    // The `.e2e.test.ts` extension marks live-infra tests; other
    // `.test.ts` files inside test/integration/sandbox/ (pure
    // logic) still run under the default config. See
    // packages/api/test/integration/sandbox/README.md.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "test/integration/sandbox/**/*.e2e.test.ts",
    ],
  },
});
