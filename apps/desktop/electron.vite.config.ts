import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import { loadEnv, mergeConfig, type UserConfig as ViteUserConfig } from "vite";
import spacesConfig from "../spaces/vite.config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const spacesDir = resolve(rootDir, "../spaces");
const bundledWorkspaceDeps = [
  "@thinkwork/deployment-profile",
  "@thinkwork/desktop-ipc",
] as const;
const DESKTOP_BUILD_ENV_KEYS = [
  "THINKWORK_DESKTOP_APP_ID",
  "THINKWORK_DESKTOP_CHANNEL",
  "THINKWORK_DESKTOP_PRODUCT_NAME",
  "THINKWORK_DESKTOP_SCHEME",
  "THINKWORK_DESKTOP_VERSION",
] as const;

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
    envDir: spacesDir,
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

function loadSpacesEnv(mode: string): Record<string, string> {
  const env = loadEnv(mode, spacesDir, ["VITE_"]);
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("VITE_") && value) env[key] = value;
  }
  for (const key of DESKTOP_BUILD_ENV_KEYS) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

export default defineConfig(async (env) => {
  const spacesEnv = loadSpacesEnv(env.mode);

  return {
    main: {
      define: {
        __THINKWORK_APPLE_TEAM_ID__: JSON.stringify(
          process.env.APPLE_TEAM_ID ??
            process.env.THINKWORK_APPLE_TEAM_ID ??
            "",
        ),
        __THINKWORK_DESKTOP_ENV__: JSON.stringify(spacesEnv),
      },
      build: {
        externalizeDeps: {
          exclude: [...bundledWorkspaceDeps],
        },
        outDir: "out/main",
        rollupOptions: {
          input: {
            index: resolve(rootDir, "src/main/index.ts"),
          },
        },
      },
    },
    preload: {
      build: {
        externalizeDeps: {
          exclude: [...bundledWorkspaceDeps],
        },
        outDir: "out/preload",
        rollupOptions: {
          input: resolve(rootDir, "src/preload/index.ts"),
          output: {
            entryFileNames: "[name].cjs",
            format: "cjs" as const,
          },
        },
      },
    },
    renderer: await resolveSpacesConfig(env),
  };
});
