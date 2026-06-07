import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import { loadEnv, mergeConfig, type UserConfig as ViteUserConfig } from "vite";
import webConfig from "../web/vite.config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const webDir = resolve(rootDir, "../web");
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

async function resolveWebConfig(env: {
  command: "build" | "serve";
  mode: string;
}): Promise<ViteUserConfig> {
  const baseConfig =
    typeof webConfig === "function" ? await webConfig(env) : await webConfig;

  return mergeConfig(baseConfig, {
    root: webDir,
    envDir: webDir,
    // electron-vite defaults the renderer to a relative base ("./"), which
    // emits relative asset URLs in index.html. That only resolves when the
    // document itself sits at the app root — a full document load at a nested
    // route (a dropped link, a reload, a deep link) resolves assets against
    // e.g. thinkwork://app/threads/, 404s every chunk, and blanks the window.
    // The thinkwork:// protocol handler roots at the renderer dir, so an
    // absolute base makes "/assets/..." resolve from root at any path — and
    // matches the web build, which already defaults to "/".
    base: "/",
    define: {
      __DESKTOP_BUILD__: "true",
    },
    build: {
      outDir: resolve(rootDir, "out/renderer"),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(webDir, "index.html"),
      },
    },
  } satisfies ViteUserConfig);
}

function loadWebEnv(mode: string): Record<string, string> {
  const env = loadEnv(mode, webDir, ["VITE_"]);
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
  const webEnv = loadWebEnv(env.mode);

  return {
    main: {
      define: {
        __THINKWORK_APPLE_TEAM_ID__: JSON.stringify(
          process.env.APPLE_TEAM_ID ??
            process.env.THINKWORK_APPLE_TEAM_ID ??
            "",
        ),
        __THINKWORK_DESKTOP_ENV__: JSON.stringify(webEnv),
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
    renderer: await resolveWebConfig(env),
  };
});
