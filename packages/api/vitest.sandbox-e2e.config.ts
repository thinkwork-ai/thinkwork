/**
 * Separate vitest config for the sandbox E2E suite. Runs against live
 * infra — env vars must be populated before invoking. See
 * packages/api/test/integration/sandbox/README.md.
 *
 * Invoked via `pnpm --filter @thinkwork/api sandbox:e2e` which wraps
 * `vitest run --config vitest.sandbox-e2e.config.ts`.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/integration/sandbox/**/*.e2e.test.ts"],
    // Live-infra runs take 30-90s per scenario; default 5s is way too short.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // Sequential — parallel runs would race on the shared stage.
    fileParallelism: false,
    // Surface AWS SDK + DB errors without collapsing the stack trace.
    printConsoleTrace: true,
  },
});
