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
      {
        name: "thinkwork-dev-n8n-api-proxy",
        configureServer(server) {
          server.middlewares.use(
            "/__thinkwork-dev/n8n/workflows",
            async (req, res) => {
              if (req.method !== "GET") {
                res.statusCode = 405;
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ error: "Method not allowed" }));
                return;
              }
              const requestUrl = new URL(req.url ?? "/", "http://localhost");
              const baseUrl = requestUrl.searchParams.get("baseUrl");
              const cursor = requestUrl.searchParams.get("cursor");
              const apiKey = Array.isArray(req.headers["x-n8n-api-key"])
                ? req.headers["x-n8n-api-key"][0]
                : req.headers["x-n8n-api-key"];
              if (!baseUrl || !apiKey) {
                res.statusCode = 400;
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ error: "baseUrl and API key are required" }));
                return;
              }

              try {
                const origin = new URL(baseUrl).origin;
                const upstream = new URL("/api/v1/workflows", origin);
                upstream.searchParams.set("limit", "100");
                if (cursor) upstream.searchParams.set("cursor", cursor);
                const upstreamResponse = await fetch(upstream, {
                  method: "GET",
                  headers: {
                    accept: "application/json",
                    "X-N8N-API-KEY": apiKey,
                  },
                });
                const body = await upstreamResponse.text();
                res.statusCode = upstreamResponse.status;
                res.setHeader(
                  "content-type",
                  upstreamResponse.headers.get("content-type") ??
                    "application/json",
                );
                if (!upstreamResponse.ok) {
                  res.end(body);
                  return;
                }
                const payload = JSON.parse(body) as {
                  data?: Array<Record<string, unknown>>;
                  [key: string]: unknown;
                };
                if (Array.isArray(payload.data)) {
                  payload.data = await Promise.all(
                    payload.data.map(async (workflow) => {
                      if (hasWorkflowTriggerData(workflow)) return workflow;
                      const workflowId =
                        typeof workflow.id === "string" ? workflow.id : null;
                      if (!workflowId) return workflow;
                      const detailUrl = new URL(
                        `/api/v1/workflows/${encodeURIComponent(workflowId)}`,
                        origin,
                      );
                      const detailResponse = await fetch(detailUrl, {
                        method: "GET",
                        headers: {
                          accept: "application/json",
                          "X-N8N-API-KEY": apiKey,
                        },
                      });
                      if (!detailResponse.ok) return workflow;
                      const detail = (await detailResponse.json()) as Record<
                        string,
                        unknown
                      >;
                      return { ...workflow, ...detail };
                    }),
                  );
                }
                res.end(JSON.stringify(payload));
              } catch (error) {
                res.statusCode = 502;
                res.setHeader("content-type", "application/json");
                res.end(
                  JSON.stringify({
                    error:
                      error instanceof Error
                        ? error.message
                        : "Failed to proxy n8n workflows",
                  }),
                );
              }
            },
          );
        },
      },
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

function hasWorkflowTriggerData(workflow: Record<string, unknown>): boolean {
  if (Array.isArray(workflow.triggerTypes) && workflow.triggerTypes.length > 0) {
    return true;
  }
  return Array.isArray(workflow.nodes) && workflow.nodes.length > 0;
}
