/**
 * Separate Vitest config for live Company Brain / Context Engine E2E checks.
 *
 * Runs against deployed API infrastructure when API_URL, API_AUTH_SECRET,
 * TENANT_ID, and USER_ID are supplied. Without those env vars, the tests
 * skip cleanly so normal CI does not depend on a dogfood tenant.
 *
 * Example:
 *   source scripts/smoke/_env.sh
 *   TENANT_ID=... USER_ID=... CONTEXT_ENGINE_E2E_REQUIRE_WIKI_HIT=true \
 *     pnpm --filter @thinkwork/api context-engine:e2e
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/integration/context-engine/**/*.e2e.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    printConsoleTrace: true,
  },
});
