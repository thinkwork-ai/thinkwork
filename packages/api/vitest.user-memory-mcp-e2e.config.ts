/**
 * Separate vitest config for User Memory MCP E2E checks. Runs against live
 * infra when endpoint/stage env vars are supplied; otherwise emits blocked
 * diagnostics and exits cleanly.
 *
 * Invoked via `pnpm --filter @thinkwork/api user-memory-mcp:e2e`.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/integration/user-memory-mcp/**/*.e2e.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    printConsoleTrace: true,
  },
});
