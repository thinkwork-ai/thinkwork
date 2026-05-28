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
 */
export default defineConfig({
  resolve: {
    alias: {
      "@thinkwork/pi-aws": path.resolve(__dirname, "../pi-aws/src/index.ts"),
      "@thinkwork/pi-runtime-core": path.resolve(
        __dirname,
        "../pi-runtime-core/src/index.ts",
      ),
    },
  },
});
