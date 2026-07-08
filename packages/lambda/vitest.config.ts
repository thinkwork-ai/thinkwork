import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Cross-package import used ONLY by the analyst broker integration
      // test: the real packages/api MCP wire client round-trips against the
      // broker handler. Aliased so the lambda package's tsc project doesn't
      // swallow the whole packages/api module graph (rootDir violation) —
      // the test imports this specifier with @ts-expect-error.
      "virtual:api-mcp-client": resolve(
        __dirname,
        "../api/src/lib/mcp-client-call.ts",
      ),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
  },
});
