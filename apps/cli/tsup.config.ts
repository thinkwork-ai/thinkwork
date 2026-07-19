import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: "esm",
  dts: true,
  clean: true,
  banner: {
    // CJS deps bundled into the ESM output (e.g. yaml's `require('process')`)
    // hit esbuild's throwing __require shim unless a real require exists.
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});
