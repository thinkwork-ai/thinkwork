import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import packageJson from "./package.json";

// Plan-012 U10/U11.5: the parent IframeAppletController consumes
// `__SANDBOX_IFRAME_SRC__` (build-time-injected) as the pinned iframe
// src. scripts/build-web.sh writes VITE_SANDBOX_IFRAME_SRC into
// apps/web/.env.production from the terraform output
// computer_sandbox_url, then runs `pnpm --filter computer build`
// without re-exporting the value inline. Vite plugin code inside
// configs runs in Node and only sees `process.env` — it does NOT
// auto-load `.env.production` for plugin/define logic. We therefore
// call loadEnv(mode, ...) to merge .env.<mode> into the values seen
// here, then substitute into the build-time `define` map. Falls back
// to the production default when nothing is set so local `vite dev`
// runs without a .env.production still produce a coherent value.

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, new URL(".", import.meta.url).pathname, ["VITE_"]);
  const appVersion =
    env.VITE_APP_VERSION ||
    process.env.VITE_APP_VERSION ||
    `${packageJson.version}-dev`;

  const sandboxIframeSrc =
    env.VITE_SANDBOX_IFRAME_SRC ||
    process.env.VITE_SANDBOX_IFRAME_SRC ||
    (mode === "development"
      ? "http://localhost:5175/iframe-shell.html"
      : "https://sandbox.thinkwork.ai/iframe-shell.html");
  const devServerPort = Number.parseInt(
    process.env.THINKWORK_SPACES_DEV_PORT || env.VITE_SPACES_DEV_PORT || "5174",
    10,
  );

  return {
    plugins: [
      TanStackRouterVite({ quoteStyle: "double", semicolons: true }),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        "@": new URL("./src", import.meta.url).pathname,
      },
    },
    define: {
      // amazon-cognito-identity-js uses Node.js globals
      global: "globalThis",
      __THINKWORK_WEB_VERSION__: JSON.stringify(appVersion),
      // The Electron renderer config overrides this to true. Keeping the web
      // default false lets Rollup tree-shake desktop-only dynamic imports.
      __DESKTOP_BUILD__: "false",
      __SANDBOX_IFRAME_SRC__: JSON.stringify(sandboxIframeSrc),
      // Note: __ALLOWED_PARENT_ORIGINS__ is iframe-side trust
      // configuration — defined in vite.iframe-shell.config.ts only.
      // The host bundle does not need it.
    },
    server: {
      port:
        Number.isFinite(devServerPort) && devServerPort > 0
          ? devServerPort
          : 5174,
      strictPort: true,
    },
  };
});
