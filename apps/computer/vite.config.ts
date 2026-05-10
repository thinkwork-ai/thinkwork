import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

// Plan-012 U10/U11.5: the parent IframeAppletController consumes
// `__SANDBOX_IFRAME_SRC__` (build-time-injected) as the pinned iframe
// src. scripts/build-computer.sh writes VITE_SANDBOX_IFRAME_SRC into
// apps/computer/.env.production from the terraform output
// computer_sandbox_url, then runs `pnpm --filter computer build`
// without re-exporting the value inline. Vite plugin code inside
// configs runs in Node and only sees `process.env` — it does NOT
// auto-load `.env.production` for plugin/define logic. We therefore
// call loadEnv(mode, ...) to merge .env.<mode> into the values seen
// here, then substitute into the build-time `define` map. Falls back
// to the production default when nothing is set so local `vite dev`
// runs without a .env.production still produce a coherent value.

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, new URL(".", import.meta.url).pathname, [
    "VITE_",
  ]);

  const sandboxIframeSrc =
    env.VITE_SANDBOX_IFRAME_SRC ||
    process.env.VITE_SANDBOX_IFRAME_SRC ||
    (mode === "development"
      ? "http://localhost:5175/iframe-shell.html"
      : "https://sandbox.thinkwork.ai/iframe-shell.html");

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
      __SANDBOX_IFRAME_SRC__: JSON.stringify(sandboxIframeSrc),
      // Note: __ALLOWED_PARENT_ORIGINS__ is iframe-side trust
      // configuration — defined in vite.iframe-shell.config.ts only.
      // The host bundle does not need it.
    },
    server: {
      port: 5174,
      strictPort: true,
    },
  };
});
