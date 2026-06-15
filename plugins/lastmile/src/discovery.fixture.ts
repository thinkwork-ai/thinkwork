/**
 * Recorded LastMile OAuth discovery metadata (plan 2026-06-12-001 U9).
 *
 * Captured 2026-06-12 from the live RFC 9728 protected-resource metadata
 * endpoints:
 *
 *   https://dev-mcp.lastmile-tei.com/.well-known/oauth-protected-resource/{crm,tasks,routing}
 *
 * `lastmile-discovery.test.ts` asserts the manifest against this fixture,
 * and `plugins/lastmile/smoke/lastmile-plugin-smoke.mjs` re-fetches the live
 * endpoints to catch drift between LastMile's deployment and this
 * recording. If LastMile changes its auth server, resources, or scope
 * vocabulary, update this fixture AND the manifest together.
 *
 * NOTE: these are LastMile's DEVELOP-stage endpoints (prod is
 * mcp.lastmile-tei.com). Per-stage endpoint parameterization is a known
 * v1 gap — see the manifest header.
 */

export interface RecordedProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  scopes_supported: string[];
  resource_documentation: string;
}

export const LASTMILE_DISCOVERY_CAPTURED_AT = "2026-06-12";

export const lastmileDiscoveryFixture: Record<
  "crm" | "tasks" | "routing",
  RecordedProtectedResourceMetadata
> = {
  crm: {
    resource: "https://dev-mcp.lastmile-tei.com/crm",
    authorization_servers: [
      "https://straightforward-dragon-14-staging.authkit.app",
    ],
    bearer_methods_supported: ["header"],
    scopes_supported: ["openid", "email", "profile", "offline_access"],
    resource_documentation:
      "https://github.com/homecareintel/web-apps/blob/main/docs/MCP.md",
  },
  tasks: {
    resource: "https://dev-mcp.lastmile-tei.com/tasks",
    authorization_servers: [
      "https://straightforward-dragon-14-staging.authkit.app",
    ],
    bearer_methods_supported: ["header"],
    scopes_supported: ["openid", "email", "profile", "offline_access"],
    resource_documentation:
      "https://github.com/homecareintel/web-apps/blob/main/docs/MCP.md",
  },
  routing: {
    resource: "https://dev-mcp.lastmile-tei.com/routing",
    authorization_servers: [
      "https://straightforward-dragon-14-staging.authkit.app",
    ],
    bearer_methods_supported: ["header"],
    scopes_supported: ["openid", "email", "profile", "offline_access"],
    resource_documentation:
      "https://github.com/homecareintel/web-apps/blob/main/docs/MCP.md",
  },
};
