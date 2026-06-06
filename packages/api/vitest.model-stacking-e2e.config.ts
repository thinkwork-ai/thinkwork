/**
 * Hermetic model-stacking proof.
 *
 * This suite uses literal layered TOOLS.md policy, the real policy parser,
 * workspace_skill extension, and Pi loop event capture. It does not mutate a
 * deployed stack; live demo setup/cleanup is documented separately in
 * docs/verification/model-stacking-e2e.md.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/integration/model-stacking/**/*.e2e.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
