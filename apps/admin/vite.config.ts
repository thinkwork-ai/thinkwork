import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const adminRoot = new URL(".", import.meta.url).pathname;
  const env = loadEnv(mode, adminRoot, ["VITE_"]);
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
        // Ensure @hookform/resolvers can find zod despite pnpm strict isolation
        zod: path.dirname(new URL(import.meta.resolve("zod")).pathname),
      },
    },
    define: {
      // amazon-cognito-identity-js uses Node.js globals
      global: "globalThis",
      __SANDBOX_IFRAME_SRC__: JSON.stringify(sandboxIframeSrc),
    },
    server: {
      port: 5174,
    },
  };
});
