import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Mirror the esbuild `--loader:.py=text` used for routine-exec-git: import a
// .py file as its source string (the capability-sdk is materialized into the
// sandbox from these). `enforce: "pre"` runs before Vite's JS import-analysis.
const pyAsText = {
  name: "py-as-text",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (id.endsWith(".py")) {
      return { code: `export default ${JSON.stringify(code)};`, map: null };
    }
    return null;
  },
};

export default defineConfig({
  plugins: [pyAsText],
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
