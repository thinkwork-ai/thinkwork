import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import { mergeConfig, type UserConfig as ViteUserConfig } from "vite";
import spacesConfig from "../spaces/vite.config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const spacesDir = resolve(rootDir, "../spaces");

async function resolveSpacesConfig(env: {
  command: "build" | "serve";
  mode: string;
}): Promise<ViteUserConfig> {
  const baseConfig =
    typeof spacesConfig === "function"
      ? await spacesConfig(env)
      : await spacesConfig;

  return mergeConfig(baseConfig, {
    root: spacesDir,
    define: {
      __DESKTOP_BUILD__: "true",
    },
    build: {
      outDir: resolve(rootDir, "out/renderer"),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(spacesDir, "index.html"),
      },
    },
  } satisfies ViteUserConfig);
}

export default defineConfig(async (env) => ({
  main: {
    build: {
      outDir: "out/main",
      rollupOptions: {
        input: resolve(rootDir, "src/main/index.ts"),
      },
    },
  },
  preload: {
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: resolve(rootDir, "src/preload/index.ts"),
      },
    },
  },
  renderer: await resolveSpacesConfig(env),
}));
