import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "lib/**/*.test.ts",
      "components/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname,
      // Resolve the workspace SDK from source so tests don't depend on a
      // prebuilt dist/ (CI runs tests without building workspace packages).
      "@thinkwork/react-native-sdk": new URL(
        "../../packages/react-native-sdk/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
