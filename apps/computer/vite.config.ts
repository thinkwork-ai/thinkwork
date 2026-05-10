import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

// Plan-012 U10/U11.5: the parent IframeAppletController consumes
// `__SANDBOX_IFRAME_SRC__` (build-time-injected) as the pinned iframe
// src. scripts/build-computer.sh writes VITE_SANDBOX_IFRAME_SRC into
// .env.production from the terraform output computer_sandbox_url; we
// substitute it into a global at build time so the controller does
// not need to read import.meta.env at runtime (and tests can override
// via the existing globalThis.__SANDBOX_IFRAME_SRC__ hook). Falls
// back to the production default when unset (matches the fallback in
// iframe-protocol.ts so dev runs without terraform-driven env still
// produce a coherent value).
const SANDBOX_IFRAME_SRC =
  process.env.VITE_SANDBOX_IFRAME_SRC ??
  "https://sandbox.thinkwork.ai/iframe-shell.html";

export default defineConfig({
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
    __SANDBOX_IFRAME_SRC__: JSON.stringify(SANDBOX_IFRAME_SRC),
    // Note: __ALLOWED_PARENT_ORIGINS__ is iframe-side trust
    // configuration — defined in vite.iframe-shell.config.ts only.
    // The host bundle does not need it.
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
