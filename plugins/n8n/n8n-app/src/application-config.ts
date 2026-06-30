export const N8N_APP_SURFACE_KEY = "workflow-operations";
export const N8N_APP_KEY = "n8n-workflow-operations";
export const N8N_APP_ROUTE_SEGMENT = "workflows";
export const N8N_APP_DISPLAY_NAME = "n8n Workflows";
export const N8N_APP_DESCRIPTION =
  "Read-only workflow and execution operations surface for the tenant n8n runtime.";
export const N8N_APP_ICON = "workflow";

export const n8nApplicationConfig = {
  schemaVersion: 1,
  appKey: N8N_APP_KEY,
  displayName: N8N_APP_DISPLAY_NAME,
  description: N8N_APP_DESCRIPTION,
  host: {
    mount: "main-shell",
    runtime: "trusted-bundled-react",
    route: `/apps/n8n/${N8N_APP_ROUTE_SEGMENT}`,
    sourceRoot: "plugins/n8n/n8n-app",
    frontComponent: {
      source: "src/front-components/thinkwork-workflows.front-component.tsx",
      exportName: "ThinkWorkN8nWorkflowsApp",
    },
  },
  dataAccess: {
    mode: "thinkwork-session",
    boundary: "server-mediated",
    allowedCredentials: [
      "tenant-service-credential:n8n-mcp-access-token",
      "tenant-plugin-credential:n8n-api",
    ],
    forbidden: [
      "browser-entered-api-key",
      "unauthenticated-proxy",
      "workflow-publish",
      "workflow-unpublish",
      "workflow-activate",
      "workflow-deactivate",
      "workflow-delete",
      "execution-retry",
      "execution-stop",
    ],
    redaction:
      "The app may render workflow, execution, trigger, readiness, and bridge evidence fields, but not raw credentials, idempotency keys, callback URLs, or arbitrary execution payloads.",
  },
} as const;
