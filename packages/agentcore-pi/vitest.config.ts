import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Plan §005 U8 — alias `@thinkwork/pi-aws` to its source so vitest can
 * resolve the workspace dep without requiring the dist/ output to exist
 * first. The package.json's `exports` map points `import` at compiled
 * `dist/src/index.js` so Node ESM works at runtime in the Lambda
 * container; vitest resolves through this alias instead, avoiding a
 * "build pi-aws before testing agentcore-pi" pre-step in CI.
 *
 * The resolved source still imports from
 * `../connectors/agentcore-codeinterpreter.js` (a relative path inside
 * the pi-aws package), and that connector imports from
 * `../src/pi-types.js` directly (no path-remap), so the chain
 * type-checks and runs cleanly under vitest without pi-aws being
 * built.
 *
 * `@thinkwork/pi-extensions` (plan §004 U5) gets the same treatment: server.ts
 * imports the memory extension from it, and its package.json `import` condition
 * points at `dist/`, so without this alias vitest fails to load every suite that
 * touches server.ts in CI (where `pnpm test` runs with no prior build step).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@thinkwork/pi-aws": path.resolve(__dirname, "../pi-aws/src/index.ts"),
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
});
