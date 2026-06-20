import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rootDir = dirname(fileURLToPath(import.meta.url));
const entryName =
  process.env.JSON_RENDER_SMOKE_ENTRY === "baseline" ? "baseline" : "renderer";
const entryFile =
  entryName === "baseline"
    ? "src/components/workbench/genui/json-render-bundle-baseline.tsx"
    : "src/components/workbench/genui/json-render-bundle-smoke.tsx";

export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: true,
    minify: "esbuild",
    outDir: `dist/json-render-smoke-${entryName}`,
    rollupOptions: {
      input: resolve(rootDir, entryFile),
      output: {
        assetFileNames: "assets/[name][extname]",
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name].js",
      },
    },
    sourcemap: false,
  },
});
