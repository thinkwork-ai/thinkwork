import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "node:path";

export default defineConfig({
  plugins: [TanStackRouterVite(), react(), tailwindcss()],
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
  },
  server: {
    port: 5174,
  },
});
