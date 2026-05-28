import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@thinkwork/pi-runtime-core": path.resolve(
        __dirname,
        "../../packages/pi-runtime-core/src/index.ts",
      ),
    },
  },
  test: {
    environment: "node",
  },
});
