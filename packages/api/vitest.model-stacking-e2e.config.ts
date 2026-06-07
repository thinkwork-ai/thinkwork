/**
 * Hermetic model-stacking proof.
 *
 * This suite uses literal layered TOOLS.md policy, the real policy parser,
 * workspace_skill extension, and Pi loop event capture. It does not mutate a
 * deployed stack; live demo setup/cleanup is documented separately in
 * docs/verification/model-stacking-e2e.md.
 */
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
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
    include: ["test/integration/model-stacking/**/*.e2e.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
