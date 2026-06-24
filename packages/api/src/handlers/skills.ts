import { getConfig, getApiAuthSecret } from "@thinkwork/runtime-config";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  SecretsManagerClient,
  CreateSecretCommand,
  UpdateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";
import { eq, and, or, sql, inArray, isNull } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agentSkills,
  skillRuns,
  tenantMcpServers,
  tenantMcpContextTools,
  tenantMcpAdminKeys,
  agentMcpServers,
  agentTemplateMcpServers,
  tenantBuiltinTools,
  connections,
  connectProviders,
  users,
} from "@thinkwork/database-pg/schema";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { authenticate } from "../lib/cognito-auth.js";
import { requireTenantMembership } from "../lib/tenant-membership.js";
import { resolveUserMcpPrincipal } from "../lib/user-mcp-principal.js";
import {
  handleCors,
  json,
  error,
  notFound,
  unauthorized,
} from "../lib/response.js";
import { resolveTenantId } from "../lib/tenants.js";
import { applyMcpServerFieldUpdate } from "../lib/mcp-server-update.js";
import { computeMcpUrlHash } from "../lib/mcp-server-hash.js";
import { mcpListTools, type McpServerTarget } from "../lib/mcp-client-call.js";
import {
  mcpOAuthCompletionUrl,
  normalizeMcpOAuthReturnTo,
  resolveMcpOAuthResource,
  type McpOAuthResourceMetadata,
} from "../lib/mcp-oauth-client.js";
import { emitAuditEvent } from "../lib/compliance/emit.js";
import {
  builtinToolSecretName,
  loadTenantBuiltinTools,
  resolveBuiltinToolApiKey,
  runWebSearch,
} from "../lib/builtin-tools/web-search.js";
import { runFirecrawlScrape } from "../lib/builtin-tools/web-extract.js";
import { pluginOAuthAuthorize, pluginOAuthCallback } from "./plugin-oauth.js";

export { loadTenantBuiltinTools };

const sm = new SecretsManagerClient({});
const db = getDb();
const STAGE = process.env.STAGE || "dev";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method === "OPTIONS")
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Allow-Headers": "*",
      },
      body: "",
    };

  const method = event.requestContext.http.method;
  const path = event.rawPath;

  // MCP OAuth endpoints are public (browser redirects, no Bearer token)
  if (path.startsWith("/api/skills/mcp-oauth/")) {
    try {
      if (path === "/api/skills/mcp-oauth/authorize" && method === "GET") {
        return mcpOAuthAuthorize(event);
      }
      if (path === "/api/skills/mcp-oauth/callback" && method === "GET") {
        return mcpOAuthCallback(event);
      }
      return notFound("Route not found");
    } catch (err) {
      console.error("MCP OAuth error:", err);
      return error("Internal server error", 500);
    }
  }

  // Plugin app-level OAuth callback is public (browser redirect from the
  // AS; the HMAC-signed state is the authenticator — plan U6). The
  // authorize route is NOT here: it requires the authenticated principal.
  if (path === "/api/skills/plugin-oauth/callback" && method === "GET") {
    try {
      return await pluginOAuthCallback(event);
    } catch (err) {
      console.error("Plugin OAuth callback error:", err);
      return error("Internal server error", 500);
    }
  }

  // Accept Cognito JWT (admin UI, mobile), Bearer API_AUTH_SECRET (service), or
  // x-api-key (AppSync / app-manager). Validation lives in authenticate().
  const auth = await authenticate(event.headers);
  if (!auth) return unauthorized();

  try {
    // GET /api/skills/plugin-oauth/authorize — app-level plugin activation
    // (plan U6). Authenticated: the activating user is the CANONICAL
    // caller bound from the auth principal; a userId query param is never
    // trusted (unlike the legacy per-server mcp-oauth authorize route).
    if (path === "/api/skills/plugin-oauth/authorize" && method === "GET") {
      return pluginOAuthAuthorize(event, auth);
    }

    // --- Catalog routes ---

    // GET /api/skills/catalog
    if (path === "/api/skills/catalog" && method === "GET") {
      return legacySkillRestGone();
    }

    // GET /api/skills/catalog/:slug/files (list) or /api/skills/catalog/:slug/files/* (get)
    const catalogFilesMatch = path.match(
      /^\/api\/skills\/catalog\/([^/]+)\/files(?:\/(.+))?$/,
    );
    if (catalogFilesMatch && method === "GET") {
      return legacySkillRestGone();
    }

    // GET /api/skills/catalog/:slug
    const catalogSlugMatch = path.match(/^\/api\/skills\/catalog\/([^/]+)$/);
    if (catalogSlugMatch && method === "GET") {
      return legacySkillRestGone();
    }

    // --- Tenant routes ---

    const tenantSlug = event.headers["x-tenant-slug"];

    // GET /api/skills/tenant
    if (path === "/api/skills/tenant" && method === "GET") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles:
            (method as string) === "GET"
              ? ["owner", "admin", "member"]
              : ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return legacySkillRestGone();
    }

    // POST /api/skills/tenant/create — create a new custom skill from template
    if (path === "/api/skills/tenant/create" && method === "POST") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles:
            (method as string) === "GET"
              ? ["owner", "admin", "member"]
              : ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return legacySkillRestGone();
    }

    // POST /api/skills/tenant/:slug/install
    const installMatch = path.match(
      /^\/api\/skills\/tenant\/([^/]+)\/install$/,
    );
    if (installMatch && method === "POST") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles:
            (method as string) === "GET"
              ? ["owner", "admin", "member"]
              : ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return legacySkillRestGone();
    }

    // POST /api/skills/tenant/:slug/upload — upload skill zip
    const uploadMatch = path.match(/^\/api\/skills\/tenant\/([^/]+)\/upload$/);
    if (uploadMatch && method === "POST") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles:
            (method as string) === "GET"
              ? ["owner", "admin", "member"]
              : ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return legacySkillRestGone();
    }

    // GET /api/skills/tenant/:slug/files — list files in tenant skill
    const tenantFileListMatch = path.match(
      /^\/api\/skills\/tenant\/([^/]+)\/files$/,
    );
    if (tenantFileListMatch && method === "GET") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles:
            (method as string) === "GET"
              ? ["owner", "admin", "member"]
              : ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return legacySkillRestGone();
    }

    // GET/PUT/POST/DELETE /api/skills/tenant/:slug/files/*
    const tenantFilesMatch = path.match(
      /^\/api\/skills\/tenant\/([^/]+)\/files\/(.+)$/,
    );
    if (tenantFilesMatch) {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles:
            (method as string) === "GET"
              ? ["owner", "admin", "member"]
              : ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return legacySkillRestGone();
    }

    // GET /api/skills/tenant/:slug/upgradeable
    const upgradeableMatch = path.match(
      /^\/api\/skills\/tenant\/([^/]+)\/upgradeable$/,
    );
    if (upgradeableMatch && method === "GET") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles:
            (method as string) === "GET"
              ? ["owner", "admin", "member"]
              : ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return legacySkillRestGone();
    }

    // POST /api/skills/tenant/:slug/upgrade
    const upgradeMatch = path.match(
      /^\/api\/skills\/tenant\/([^/]+)\/upgrade$/,
    );
    if (upgradeMatch && method === "POST") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles:
            (method as string) === "GET"
              ? ["owner", "admin", "member"]
              : ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return legacySkillRestGone();
    }

    // DELETE /api/skills/tenant/:slug
    const tenantDeleteMatch = path.match(/^\/api\/skills\/tenant\/([^/]+)$/);
    if (tenantDeleteMatch && method === "DELETE") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles:
            (method as string) === "GET"
              ? ["owner", "admin", "member"]
              : ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return legacySkillRestGone();
    }

    // POST /api/skills/agent/:agentSlug/install/:skillSlug
    const agentInstallMatch = path.match(
      /^\/api\/skills\/agent\/([^/]+)\/install\/([^/]+)$/,
    );
    if (agentInstallMatch && method === "POST") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles:
            (method as string) === "GET"
              ? ["owner", "admin", "member"]
              : ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return legacySkillRestGone();
    }

    // POST /api/skills/template/:templateSlug/install/:skillSlug
    // Per docs/plans/2026-04-27-004 U1b: templates need a parallel install
    // route so the agent-template editor's "Add from catalog" can target
    // the template's _catalog prefix, mirroring the agent install path.
    const templateInstallMatch = path.match(
      /^\/api\/skills\/template\/([^/]+)\/install\/([^/]+)$/,
    );
    if (templateInstallMatch && method === "POST") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles: ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return legacySkillRestGone();
    }

    // POST /api/skills/agent/:agentId/:skillId/credentials
    const credMatch = path.match(
      /^\/api\/skills\/agent\/([^/]+)\/([^/]+)\/credentials$/,
    );
    if (credMatch && method === "POST") {
      return saveSkillCredentials(credMatch[1], credMatch[2], event);
    }

    // --- MCP Server routes (tenant-level registry) ---

    // GET /api/skills/mcp-servers — list tenant's MCP servers
    if (path === "/api/skills/mcp-servers" && method === "GET") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles:
            (method as string) === "GET"
              ? ["owner", "admin", "member"]
              : ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return mcpListTenantServers(tenantSlug);
    }

    // POST /api/skills/mcp-servers — register MCP server
    if (path === "/api/skills/mcp-servers" && method === "POST") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      let registerVerdictUserId: string | null = null;
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles:
            (method as string) === "GET"
              ? ["owner", "admin", "member"]
              : ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
        registerVerdictUserId = _v.userId;
      }
      return mcpRegisterServer(tenantSlug, registerVerdictUserId, event);
    }

    // PUT /api/skills/mcp-servers/:id — update MCP server
    const mcpUpdateMatch = path.match(/^\/api\/skills\/mcp-servers\/([^/]+)$/);
    if (mcpUpdateMatch && method === "PUT") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles:
            (method as string) === "GET"
              ? ["owner", "admin", "member"]
              : ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return mcpUpdateServer(tenantSlug, mcpUpdateMatch[1], event);
    }

    // DELETE /api/skills/mcp-servers/:id — remove MCP server
    if (mcpUpdateMatch && method === "DELETE") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      let deleteVerdictUserId: string | null = null;
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles:
            (method as string) === "GET"
              ? ["owner", "admin", "member"]
              : ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
        deleteVerdictUserId = _v.userId;
      }
      return mcpDeleteServer(
        tenantSlug,
        mcpUpdateMatch[1],
        deleteVerdictUserId,
      );
    }

    // GET /api/skills/mcp-servers/:id/key-status — whether a tenant API key
    // is configured for this MCP server (and a last-4 preview for admins).
    const mcpKeyStatusMatch = path.match(
      /^\/api\/skills\/mcp-servers\/([^/]+)\/key-status$/,
    );
    if (mcpKeyStatusMatch && method === "GET") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles: ["owner", "admin", "member"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return mcpKeyStatus(tenantSlug, mcpKeyStatusMatch[1]);
    }

    // PUT /api/skills/mcp-servers/:id/api-key — set or rotate the tenant
    // API key for an mcp server. Accepts either `{ apiKey: "..." }` to
    // store a caller-supplied key, or `{ mintNew: true }` to auto-generate
    // via the admin-ops provision path. owner/admin only — writes both
    // Secrets Manager and tenant_mcp_servers.auth_config.
    const mcpSetKeyMatch = path.match(
      /^\/api\/skills\/mcp-servers\/([^/]+)\/api-key$/,
    );
    if (mcpSetKeyMatch && method === "PUT") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles: ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return mcpSetApiKey(tenantSlug, mcpSetKeyMatch[1], event);
    }

    // GET /api/skills/mcp-servers/:id/service-credential-status — whether a
    // plugin-managed service credential has its secret value configured.
    const mcpServiceCredentialStatusMatch = path.match(
      /^\/api\/skills\/mcp-servers\/([^/]+)\/service-credential-status$/,
    );
    if (mcpServiceCredentialStatusMatch && method === "GET") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles: ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return mcpServiceCredentialStatus(
        tenantSlug,
        mcpServiceCredentialStatusMatch[1],
      );
    }

    // PUT /api/skills/mcp-servers/:id/service-credential — set or rotate a
    // service credential secret value for plugin-managed MCP servers such as
    // n8n. The DB row keeps only secretRef + header binding metadata.
    const mcpSetServiceCredentialMatch = path.match(
      /^\/api\/skills\/mcp-servers\/([^/]+)\/service-credential$/,
    );
    if (mcpSetServiceCredentialMatch && method === "PUT") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles: ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return mcpSetServiceCredential(
        tenantSlug,
        mcpSetServiceCredentialMatch[1],
        event,
      );
    }

    // POST /api/skills/mcp-servers/:id/test — test connection + cache tools
    const mcpTestMatch = path.match(
      /^\/api\/skills\/mcp-servers\/([^/]+)\/test$/,
    );
    if (mcpTestMatch && method === "POST") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles:
            (method as string) === "GET"
              ? ["owner", "admin", "member"]
              : ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return mcpTestConnection(tenantSlug, mcpTestMatch[1]);
    }

    // GET /api/skills/mcp-servers/:id/context-tools — list discovered
    // context-safe tool candidates for one MCP server.
    const mcpContextToolsMatch = path.match(
      /^\/api\/skills\/mcp-servers\/([^/]+)\/context-tools$/,
    );
    if (mcpContextToolsMatch && method === "GET") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles: ["owner", "admin", "member"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return mcpListContextTools(tenantSlug, mcpContextToolsMatch[1]);
    }

    // PUT /api/skills/mcp-context-tools/:id — operator approval/default
    // state for one discovered MCP context provider.
    const mcpContextToolUpdateMatch = path.match(
      /^\/api\/skills\/mcp-context-tools\/([^/]+)$/,
    );
    if (mcpContextToolUpdateMatch && method === "PUT") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      const _v = await requireTenantMembership(event, tenantSlug, {
        requiredRoles: ["owner", "admin"],
      });
      if (!_v.ok) return error(_v.reason, _v.status);
      return mcpUpdateContextTool(
        tenantSlug,
        mcpContextToolUpdateMatch[1],
        event,
        _v.userId,
      );
    }

    // --- Built-in Tools (per-tenant config for catalog skills like web-search) ---

    if (path === "/api/skills/builtin-tools" && method === "GET") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles:
            (method as string) === "GET"
              ? ["owner", "admin", "member"]
              : ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return builtinToolsList(tenantSlug);
    }
    const builtinToolMatch = path.match(
      /^\/api\/skills\/builtin-tools\/([^/]+)$/,
    );
    if (builtinToolMatch && method === "PUT") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles:
            (method as string) === "GET"
              ? ["owner", "admin", "member"]
              : ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return builtinToolsUpsert(tenantSlug, builtinToolMatch[1], event);
    }
    if (builtinToolMatch && method === "DELETE") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles:
            (method as string) === "GET"
              ? ["owner", "admin", "member"]
              : ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return builtinToolsDelete(tenantSlug, builtinToolMatch[1]);
    }
    const builtinToolTestMatch = path.match(
      /^\/api\/skills\/builtin-tools\/([^/]+)\/test$/,
    );
    if (builtinToolTestMatch && method === "POST") {
      if (!tenantSlug) return error("x-tenant-slug header required", 400);
      {
        const _v = await requireTenantMembership(event, tenantSlug, {
          requiredRoles:
            (method as string) === "GET"
              ? ["owner", "admin", "member"]
              : ["owner", "admin"],
        });
        if (!_v.ok) return error(_v.reason, _v.status);
      }
      return builtinToolsTest(tenantSlug, builtinToolTestMatch[1], event);
    }

    // --- MCP Server routes (agent-level assignment) ---

    // GET /api/skills/agents/:agentId/mcp-servers — list agent's assigned MCP servers
    const agentMcpListMatch = path.match(
      /^\/api\/skills\/agents\/([^/]+)\/mcp-servers$/,
    );
    if (agentMcpListMatch && method === "GET") {
      return mcpListAgentServers(agentMcpListMatch[1]);
    }

    // POST /api/skills/agents/:agentId/mcp-servers — assign MCP server to agent
    if (agentMcpListMatch && method === "POST") {
      return mcpAssignToAgent(agentMcpListMatch[1], event);
    }

    // DELETE /api/skills/agents/:agentId/mcp-servers/:mcpServerId — unassign
    const agentMcpDeleteMatch = path.match(
      /^\/api\/skills\/agents\/([^/]+)\/mcp-servers\/([^/]+)$/,
    );
    if (agentMcpDeleteMatch && method === "DELETE") {
      return mcpUnassignFromAgent(
        agentMcpDeleteMatch[1],
        agentMcpDeleteMatch[2],
      );
    }

    // GET /api/skills/oauth-providers — list configured OAuth providers (for admin dropdown)
    if (path === "/api/skills/oauth-providers" && method === "GET") {
      return mcpListOAuthProviders();
    }

    // GET /api/skills/templates/:templateId/mcp-servers — list template's MCP servers
    const templateMcpMatch = path.match(
      /^\/api\/skills\/templates\/([^/]+)\/mcp-servers$/,
    );
    if (templateMcpMatch && method === "GET") {
      return mcpGetTemplateMcpServers(templateMcpMatch[1]);
    }

    // POST /api/skills/templates/:templateId/mcp-servers — assign MCP server to template
    if (templateMcpMatch && method === "POST") {
      return mcpAssignToTemplate(templateMcpMatch[1], event);
    }

    // DELETE /api/skills/templates/:templateId/mcp-servers/:mcpServerId — unassign
    const templateMcpDeleteMatch = path.match(
      /^\/api\/skills\/templates\/([^/]+)\/mcp-servers\/([^/]+)$/,
    );
    if (templateMcpDeleteMatch && method === "DELETE") {
      return mcpUnassignFromTemplate(
        templateMcpDeleteMatch[1],
        templateMcpDeleteMatch[2],
      );
    }

    // GET /api/skills/user-mcp-servers — list MCP servers for the current user (for mobile app)
    if (path === "/api/skills/user-mcp-servers" && method === "GET") {
      const tenantIdHeader = event.headers["x-tenant-id"];
      if (!tenantIdHeader) return error("x-tenant-id header required", 400);
      const _v = await requireTenantMembership(event, tenantIdHeader, {
        requiredRoles: ["owner", "admin", "member"],
      });
      if (!_v.ok) return error(_v.reason, _v.status);
      const principal = resolveUserMcpPrincipal(_v, event.headers);
      if (!principal.ok) return error(principal.reason, principal.status);
      return mcpListUserServers(_v.tenantId, principal.userId);
    }

    // DELETE /api/skills/user-mcp-tokens/:mcpServerId — clear user's OAuth tokens for an MCP server
    const clearTokenMatch = path.match(
      /^\/api\/skills\/user-mcp-tokens\/([^/]+)$/,
    );
    if (clearTokenMatch && method === "DELETE") {
      const mcpServerId = clearTokenMatch[1];
      const tenantIdHeader = event.headers["x-tenant-id"];
      if (!tenantIdHeader) return error("x-tenant-id header required", 400);
      // User-self-service: a member clearing their own OAuth tokens.
      // Requires tenant membership but no admin/owner role — the row
      // is scoped to (user_id, tenant_id, mcp_server_id).
      const _v = await requireTenantMembership(event, tenantIdHeader, {
        requiredRoles: ["owner", "admin", "member"],
      });
      if (!_v.ok) return error(_v.reason, _v.status);
      const principal = resolveUserMcpPrincipal(_v, event.headers);
      if (!principal.ok) return error(principal.reason, principal.status);
      return mcpClearUserToken(principal.userId, _v.tenantId, mcpServerId);
    }

    // POST /api/skills/start — service-to-service wrapper around startSkillRun.
    // The AgentCore-container's dispatcher skill calls this with API_AUTH_SECRET
    // to kick off a skill run on behalf of the chat invoker. See Unit 5.
    if (path === "/api/skills/start" && method === "POST") {
      return startSkillRunService(event);
    }

    // POST /api/skills/complete — service-to-service terminal-state writeback.
    // The agentcore container calls this from its kind="run_skill" branch
    // after the unified dispatcher returns, so skill_runs.status transitions
    // out of `running`. Mirrors the auth + body-shape convention of /start.
    if (path === "/api/skills/complete" && method === "POST") {
      return completeSkillRunService(event);
    }

    return notFound("Route not found");
  } catch (err) {
    console.error("Skills handler error:", err);
    return error("Internal server error", 500);
  }
}

// ---------------------------------------------------------------------------
// Catalog routes
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// MCP OAuth — RFC 9728 discovery + proxy authorize/callback
// ---------------------------------------------------------------------------

/**
 * Step 1: Browser redirect. Discovers the MCP server's OAuth endpoints,
 * registers a client (or uses cached), and redirects to the authorize URL.
 *
 * GET /api/skills/mcp-oauth/authorize?mcpServerId=X&userId=Y&tenantId=Z
 */
async function mcpOAuthAuthorize(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const qs = event.queryStringParameters || {};
  const { mcpServerId, userId, tenantId } = qs;
  if (!mcpServerId || !userId || !tenantId) {
    return error("mcpServerId, userId, tenantId are required", 400);
  }

  const resolvedUserId = await resolveMcpOAuthUserId(tenantId, userId);
  if (!resolvedUserId) {
    return error("MCP OAuth userId must match a user in the tenant", 403);
  }

  // Look up MCP server + auth config
  const [server] = await db
    .select({
      url: tenantMcpServers.url,
      slug: tenantMcpServers.slug,
      auth_config: tenantMcpServers.auth_config,
    })
    .from(tenantMcpServers)
    .where(eq(tenantMcpServers.id, mcpServerId));
  if (!server) return error("MCP server not found", 404);

  const authConfig = (server.auth_config as Record<string, string>) || {};
  const apiBaseUrl = `https://${event.headers.host || ""}`;
  const callbackUrl = `${apiBaseUrl}/api/skills/mcp-oauth/callback`;
  const forceRediscovery = qs.force === "true";
  const rawReturnTo = qs.returnTo || qs.redirectTo;
  const returnTo = normalizeMcpOAuthReturnTo(rawReturnTo);
  if (rawReturnTo && !returnTo) {
    return error("Invalid MCP OAuth return URL", 400);
  }

  // Always discover via RFC 9728 unless we have cached endpoints/client_id AND
  // are not forcing rediscovery. A plugin repair may preserve endpoints while
  // dropping client_id; in that case we still need the registration endpoint
  // from fresh auth metadata so Dynamic Client Registration can run again.
  let authorizeEndpoint =
    (!forceRediscovery && authConfig.authorize_endpoint) || "";
  let tokenEndpoint = (!forceRediscovery && authConfig.token_endpoint) || "";
  let clientId = (!forceRediscovery && authConfig.client_id) || "";
  let registrationEndpoint = "";
  let resourceMetadata: McpOAuthResourceMetadata | null = null;

  if (!authorizeEndpoint || !tokenEndpoint || !clientId) {
    // Discover via RFC 9728
    const mcpBaseUrl = server.url.replace(/\/+$/, "");
    const serverPath = new URL(mcpBaseUrl).pathname.replace(/^\//, "");
    const wellKnownUrl = `${new URL(mcpBaseUrl).origin}/.well-known/oauth-protected-resource/${serverPath}`;

    const resourceRes = await fetch(wellKnownUrl, {
      signal: AbortSignal.timeout(10000),
    });
    if (!resourceRes.ok)
      return error(
        `Failed to discover OAuth metadata: ${resourceRes.status}`,
        502,
      );
    resourceMetadata = (await resourceRes.json()) as McpOAuthResourceMetadata;

    const authServerUrl = resourceMetadata.authorization_servers?.[0];
    if (!authServerUrl)
      return error("No authorization server in resource metadata", 502);

    // Get auth server metadata (RFC 8414 or OIDC discovery)
    const authMetaRes = await fetch(
      `${authServerUrl}/.well-known/oauth-authorization-server`,
      { signal: AbortSignal.timeout(10000) },
    ).catch(() => null);
    const oidcRes = authMetaRes?.ok
      ? authMetaRes
      : await fetch(`${authServerUrl}/.well-known/openid-configuration`, {
          signal: AbortSignal.timeout(10000),
        });
    if (!oidcRes.ok)
      return error("Failed to discover auth server endpoints", 502);
    const authMeta = (await oidcRes.json()) as {
      authorization_endpoint: string;
      token_endpoint: string;
      registration_endpoint?: string;
    };

    authorizeEndpoint = authMeta.authorization_endpoint;
    tokenEndpoint = authMeta.token_endpoint;
    if (authMeta.registration_endpoint)
      registrationEndpoint = authMeta.registration_endpoint;
  }

  const resource = resolveMcpOAuthResource({
    serverUrl: server.url,
    authConfig,
    resourceMetadata,
  });

  // RFC 7591 Dynamic Client Registration — if no client_id and registration endpoint exists
  if (!clientId && registrationEndpoint) {
    const dcrRes = await fetch(registrationEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: `Thinkwork (${server.slug || "mcp"})`,
        redirect_uris: [callbackUrl],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!dcrRes.ok) {
      const body = await dcrRes.text();
      return error(
        `Dynamic Client Registration failed: ${dcrRes.status} ${body}`,
        502,
      );
    }
    const dcrData = (await dcrRes.json()) as { client_id: string };
    clientId = dcrData.client_id;

    // Cache the discovered endpoints + client_id for next time. This is a
    // system-internal discovery write, not an admin intent change — we
    // also recompute `url_hash` so the row stays approved and the SI-5
    // defensive check in buildMcpConfigs keeps matching. Without the
    // recompute, approved OAuth servers would self-revoke the first
    // time a user initiated OAuth (auth_config drift → hash mismatch).
    const nextAuthConfig = {
      ...authConfig,
      authorize_endpoint: authorizeEndpoint,
      token_endpoint: tokenEndpoint,
      client_id: clientId,
      oauth_resource: resource,
    };
    await db
      .update(tenantMcpServers)
      .set({
        auth_config: nextAuthConfig,
        url_hash: computeMcpUrlHash(server.url, nextAuthConfig),
        updated_at: new Date(),
      })
      .where(eq(tenantMcpServers.id, mcpServerId));
  }

  if (!clientId)
    return error(
      "No client_id — server has no registration endpoint and no client_id configured",
      400,
    );
  if (!authorizeEndpoint)
    return error("Could not resolve authorize endpoint", 502);

  // Generate PKCE code_verifier + code_challenge (required for public clients)
  const { randomBytes, createHash } = await import("crypto");
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  // Build state (encode context for callback, including PKCE verifier)
  const state = Buffer.from(
    JSON.stringify({
      mcpServerId,
      userId: resolvedUserId,
      tenantId,
      tokenEndpoint,
      clientId,
      codeVerifier,
      resource,
      returnTo,
    }),
  ).toString("base64url");

  // Redirect to authorize
  const authorizeUrl = new URL(authorizeEndpoint);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "openid email profile offline_access");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("resource", resource);
  // The mobile MCP connect flow uses a persistent ASWebAuthenticationSession
  // cookie jar (no `preferEphemeralSession`) so reconnects reuse the WorkOS
  // session. If the user explicitly clears auth from the server detail
  // screen, `force=true` is set on the authorize URL to bypass the SSO
  // short-circuit server-side. Do NOT re-add `prompt=login` or `max_age=0`
  // here: `max_age=0` is literally unsatisfiable and we hit infinite
  // redirect loops the last two times we shipped it (PR #85, PR #86).

  return {
    statusCode: 302,
    headers: { Location: authorizeUrl.toString() },
    body: "",
  };
}

/**
 * OAuth completion defaults to the mobile app deep link. Desktop/web callers
 * pass `returnTo` during authorize so the callback can instead return to the
 * Settings MCP detail page with `mcpOAuth=success|error` query parameters.
 *
 * Hard-coded `thinkwork` scheme matches `apps/mobile/app.json:scheme`.
 * If we ever ship the app under a different scheme, update both at once.
 */
function deepLinkRedirect(
  status: "success" | "error",
  extras: Record<string, string> = {},
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 302,
    headers: { Location: mcpOAuthCompletionUrl(null, status, extras) },
    body: "",
  };
}

function mcpOAuthRedirect(
  returnTo: string | null | undefined,
  status: "success" | "error",
  extras: Record<string, string> = {},
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 302,
    headers: { Location: mcpOAuthCompletionUrl(returnTo, status, extras) },
    body: "",
  };
}

async function resolveMcpOAuthUserId(
  tenantId: string,
  userIdOrSub: string,
): Promise<string | null> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.tenant_id, tenantId),
        or(eq(users.id, userIdOrSub), eq(users.cognito_sub, userIdOrSub)),
      ),
    );
  return user?.id ?? null;
}

/**
 * Step 2: OAuth callback. Exchanges auth code for tokens, stores in SM,
 * then redirects to the mobile deep link so the in-app auth browser
 * auto-closes (rather than rendering a manual "you can close this
 * window" HTML page that requires a tap to dismiss).
 *
 * GET /api/skills/mcp-oauth/callback?code=X&state=Y
 */
async function mcpOAuthCallback(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const qs = event.queryStringParameters || {};
  const { code, state: stateParam } = qs;
  if (!code || !stateParam) {
    return deepLinkRedirect("error", { reason: "missing_code_or_state" });
  }

  // Decode state
  let state: {
    mcpServerId: string;
    userId: string;
    tenantId: string;
    tokenEndpoint: string;
    clientId: string;
    codeVerifier: string;
    resource?: string;
    returnTo?: string | null;
  };
  try {
    state = JSON.parse(Buffer.from(stateParam, "base64url").toString());
  } catch {
    return deepLinkRedirect("error", { reason: "invalid_state" });
  }

  const apiBaseUrl = `https://${event.headers.host || ""}`;
  const callbackUrl = `${apiBaseUrl}/api/skills/mcp-oauth/callback`;

  // Exchange code for tokens (public client — PKCE, no client_secret)
  const tokenRes = await fetch(state.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl,
      client_id: state.clientId,
      code_verifier: state.codeVerifier,
      ...(state.resource ? { resource: state.resource } : {}),
    }).toString(),
    signal: AbortSignal.timeout(10000),
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text().catch(() => "");
    console.error(
      `[mcp-oauth] Token exchange failed: ${tokenRes.status} ${errBody}`,
    );
    return mcpOAuthRedirect(state.returnTo, "error", {
      reason: "token_exchange_failed",
      status: String(tokenRes.status),
    });
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
  };

  // Store in Secrets Manager
  const secretName = `thinkwork/${STAGE}/mcp-tokens/${state.userId}/${state.mcpServerId}`;
  const secretValue = JSON.stringify({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || null,
    token_type: tokenData.token_type || "Bearer",
    obtained_at: new Date().toISOString(),
  });

  try {
    await sm.send(
      new UpdateSecretCommand({
        SecretId: secretName,
        SecretString: secretValue,
      }),
    );
  } catch (err: any) {
    if (err instanceof ResourceNotFoundException) {
      await sm.send(
        new CreateSecretCommand({
          Name: secretName,
          SecretString: secretValue,
        }),
      );
    } else {
      throw err;
    }
  }

  // Upsert user_mcp_tokens row
  const { userMcpTokens } = await import("@thinkwork/database-pg/schema");
  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : null;

  const [existing] = await db
    .select({ id: userMcpTokens.id })
    .from(userMcpTokens)
    .where(
      and(
        eq(userMcpTokens.user_id, state.userId),
        eq(userMcpTokens.mcp_server_id, state.mcpServerId),
      ),
    );

  if (existing) {
    await db
      .update(userMcpTokens)
      .set({
        secret_ref: secretName,
        expires_at: expiresAt,
        status: "active",
        updated_at: new Date(),
      })
      .where(eq(userMcpTokens.id, existing.id));
  } else {
    await db.insert(userMcpTokens).values({
      user_id: state.userId,
      tenant_id: state.tenantId,
      mcp_server_id: state.mcpServerId,
      secret_ref: secretName,
      expires_at: expiresAt,
      status: "active",
    });
  }

  console.log(
    `[mcp-oauth] Token stored for user ${state.userId}, MCP server ${state.mcpServerId}`,
  );

  // Redirect to the requested desktop/web return URL, or fall back to
  // the mobile deep link so ASWebAuthenticationSession auto-closes.
  return mcpOAuthRedirect(state.returnTo, "success", {
    mcpServerId: state.mcpServerId,
  });
}

function legacySkillRestGone(): APIGatewayProxyStructuredResultV2 {
  return json(
    {
      error: "LEGACY_SKILL_REST_RETIRED",
      message:
        "The legacy skill catalog REST API has been retired. Use the agent workspace Skills tab backed by the S3 skill catalog.",
    },
    410,
  );
}

// ---------------------------------------------------------------------------
// Agent skill credentials
// ---------------------------------------------------------------------------

async function saveSkillCredentials(
  agentId: string,
  skillId: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const body = JSON.parse(event.body || "{}");
  const env = body.env;
  if (!env || typeof env !== "object" || Object.keys(env).length === 0) {
    return error("env object with at least one key is required", 400);
  }

  const secretName = `thinkwork/${STAGE}/agent-skills/${agentId}/${skillId}`;
  const secretValue = JSON.stringify({ type: "skillEnv", env });

  let secretArn: string;
  try {
    // Try to update existing secret first
    const res = await sm.send(
      new UpdateSecretCommand({
        SecretId: secretName,
        SecretString: secretValue,
      }),
    );
    secretArn = res.ARN!;
  } catch (err: any) {
    if (err instanceof ResourceNotFoundException) {
      // Create new secret
      const res = await sm.send(
        new CreateSecretCommand({
          Name: secretName,
          SecretString: secretValue,
        }),
      );
      secretArn = res.ARN!;
    } else {
      throw err;
    }
  }

  // Update agent_skills.config with secretRef
  const [existing] = await db
    .select({ id: agentSkills.id, config: agentSkills.config })
    .from(agentSkills)
    .where(
      and(eq(agentSkills.agent_id, agentId), eq(agentSkills.skill_id, skillId)),
    );

  if (!existing) {
    return error("Skill not attached to this agent", 404);
  }

  const currentConfig = (existing.config as Record<string, unknown>) || {};
  await db
    .update(agentSkills)
    .set({ config: { ...currentConfig, secretRef: secretArn } })
    .where(eq(agentSkills.id, existing.id));

  return json({ ok: true, secretRef: secretArn });
}

// ---------------------------------------------------------------------------
// MCP Server — Tenant Registry (uses tenant_mcp_servers table)
// ---------------------------------------------------------------------------

async function mcpListTenantServers(
  tenantSlug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return error("Tenant not found", 404);

  const rows = await db
    .select()
    .from(tenantMcpServers)
    .where(eq(tenantMcpServers.tenant_id, tenantId));

  const authStatusByServerId = new Map(
    await Promise.all(
      rows.map(
        async (
          r,
        ): Promise<[string, "active" | "not_connected" | undefined]> => [
          r.id,
          await serviceCredentialAuthStatus(r.auth_type, r.auth_config),
        ],
      ),
    ),
  );

  return json({
    servers: rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      url: r.url,
      transport: r.transport,
      authType: r.auth_type,
      oauthProvider: r.oauth_provider,
      tools: r.tools,
      enabled: r.enabled,
      authStatus: authStatusByServerId.get(r.id),
      // Plan §U11 admin-approval metadata. Existing rows default to
      // 'approved' so the admin UI can filter without bespoke
      // migration logic on the client.
      status: r.status,
      urlHash: r.url_hash,
      managementSource: r.management_source,
      managedApplicationKey: r.managed_application_key,
      approvedBy: r.approved_by,
      approvedAt: r.approved_at,
      createdAt: r.created_at,
    })),
  });
}

async function mcpRegisterServer(
  tenantSlug: string,
  verdictUserId: string | null,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return error("Tenant not found", 404);

  const body = JSON.parse(event.body || "{}");
  const { name, url, transport, authType, apiKey, oauthProvider } = body;

  if (!name || !url) return error("name and url are required", 400);

  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return error("name must be lowercase alphanumeric with hyphens", 400);
  }

  // Store API key in Secrets Manager if provided
  let authConfig: Record<string, unknown> | null = null;
  if (authType === "tenant_api_key" && apiKey) {
    const secretName = `thinkwork/${STAGE}/mcp/${tenantId}/${slug}`;
    const secretValue = JSON.stringify({ type: "mcpApiKey", token: apiKey });
    try {
      await sm.send(
        new UpdateSecretCommand({
          SecretId: secretName,
          SecretString: secretValue,
        }),
      );
    } catch (err: any) {
      if (err instanceof ResourceNotFoundException) {
        await sm.send(
          new CreateSecretCommand({
            Name: secretName,
            SecretString: secretValue,
          }),
        );
      } else {
        throw err;
      }
    }
    authConfig = { secretRef: secretName };
  }

  // Check for existing
  const [existing] = await db
    .select({ id: tenantMcpServers.id })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.tenant_id, tenantId),
        eq(tenantMcpServers.slug, slug),
      ),
    );

  if (existing) {
    // SI-5: route through applyMcpServerFieldUpdate so url/auth_config
    // changes on an approved row revert the approval. Echo the
    // revert flag so the admin CLI / SPA can surface the state change.
    const { revertedToPending } = await applyMcpServerFieldUpdate(
      db,
      existing.id,
      {
        name,
        url,
        transport: transport || "streamable-http",
        auth_type: authType || "none",
        auth_config: authConfig,
        oauth_provider: oauthProvider || null,
      },
    );
    return json({ id: existing.id, slug, updated: true, revertedToPending });
  }

  // Compliance audit actor branching:
  //   apikey path → actorType: "system", actorId: "platform-credential"
  //   cognito path → actorType: "user", actorId: verdictUserId
  const auditActor: { actorId: string; actorType: "user" | "system" } =
    verdictUserId
      ? { actorId: verdictUserId, actorType: "user" }
      : { actorId: "platform-credential", actorType: "system" };

  // Wrap the insert + audit emit in a single transaction
  // (control-evidence tier per master plan U5).
  const [inserted] = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(tenantMcpServers)
      .values({
        tenant_id: tenantId,
        name,
        slug,
        url,
        transport: transport || "streamable-http",
        auth_type: authType || "none",
        auth_config: authConfig,
        oauth_provider: oauthProvider || null,
      })
      .returning({ id: tenantMcpServers.id, url: tenantMcpServers.url });

    await emitAuditEvent(tx, {
      tenantId,
      actorId: auditActor.actorId,
      actorType: auditActor.actorType,
      eventType: "mcp.added",
      source: "lambda",
      payload: {
        mcpId: row.id,
        url: row.url,
        scopes: [],
      },
      resourceType: "mcp_server",
      resourceId: row.id,
      action: "create",
      outcome: "success",
    });

    return [row];
  });

  return json({ id: inserted.id, slug, created: true });
}

/**
 * Short-circuit non-UUID path params so Postgres's UUID column doesn't throw
 * `invalid input syntax for type uuid` and bubble up as a 500. CLI users who
 * pass a slug to these endpoints should get a clean 404 pointing them at
 * `mcp list` — not an opaque server error.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireUuid(
  serverId: string,
): APIGatewayProxyStructuredResultV2 | null {
  if (UUID_RE.test(serverId)) return null;
  return notFound(
    `MCP server not found — path param must be a UUID (got "${serverId}"). Use \`thinkwork mcp list\` to see IDs, or pass a slug/name to the CLI which will resolve it client-side.`,
  );
}

async function mcpUpdateServer(
  tenantSlug: string,
  serverId: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const badUuid = requireUuid(serverId);
  if (badUuid) return badUuid;
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return error("Tenant not found", 404);

  const body = JSON.parse(event.body || "{}");

  // Confirm the row belongs to this tenant before mutating. The
  // applyMcpServerFieldUpdate helper is tenant-agnostic (matches on
  // id only), so enforce the tenant match here.
  const [existing] = await db
    .select({ id: tenantMcpServers.id })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.id, serverId),
        eq(tenantMcpServers.tenant_id, tenantId),
      ),
    )
    .limit(1);
  if (!existing) return notFound("MCP server not found");

  const { revertedToPending } = await applyMcpServerFieldUpdate(db, serverId, {
    name: body.name,
    url: body.url,
    transport: body.transport,
    auth_config: body.auth_config,
    enabled: body.enabled,
  });

  return json({ ok: true, id: serverId, revertedToPending });
}

async function mcpDeleteServer(
  tenantSlug: string,
  serverId: string,
  verdictUserId: string | null,
): Promise<APIGatewayProxyStructuredResultV2> {
  const badUuid = requireUuid(serverId);
  if (badUuid) return badUuid;
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return error("Tenant not found", 404);

  // Compliance audit actor branching (same shape as mcpRegisterServer).
  const auditActor: { actorId: string; actorType: "user" | "system" } =
    verdictUserId
      ? { actorId: verdictUserId, actorType: "user" }
      : { actorId: "platform-credential", actorType: "system" };

  // Wrap the cascade delete + audit emit in a single transaction
  // (control-evidence tier). `.returning()` captures the deleted row's
  // url in one round-trip — no SELECT-before-DELETE needed.
  //
  // Tenant ownership is verified BEFORE the cascade so a cross-tenant
  // probe (correct serverId, wrong tenantSlug) cannot delete
  // agentMcpServers rows for another tenant. The post-cascade
  // tenantMcpServers delete still runs tenant-scoped — defense in
  // depth — but the gate keeps the cascade from committing on a
  // failed ownership check.
  const result = await db
    .transaction(async (tx) => {
      const [owned] = await tx
        .select({ id: tenantMcpServers.id, url: tenantMcpServers.url })
        .from(tenantMcpServers)
        .where(
          and(
            eq(tenantMcpServers.id, serverId),
            eq(tenantMcpServers.tenant_id, tenantId),
          ),
        )
        .limit(1);

      if (!owned) {
        // Throw to roll back the entire tx — important when the gate
        // ever moves below side-effecting writes. Caught below; the
        // handler returns 404.
        throw new Error("MCP_SERVER_NOT_FOUND");
      }

      await tx
        .delete(agentMcpServers)
        .where(eq(agentMcpServers.mcp_server_id, serverId));

      const [deleted] = await tx
        .delete(tenantMcpServers)
        .where(
          and(
            eq(tenantMcpServers.id, serverId),
            eq(tenantMcpServers.tenant_id, tenantId),
          ),
        )
        .returning({ id: tenantMcpServers.id, url: tenantMcpServers.url });

      await emitAuditEvent(tx, {
        tenantId,
        actorId: auditActor.actorId,
        actorType: auditActor.actorType,
        eventType: "mcp.removed",
        source: "lambda",
        payload: {
          mcpId: deleted.id,
          url: deleted.url,
        },
        resourceType: "mcp_server",
        resourceId: deleted.id,
        action: "delete",
        outcome: "success",
      });

      return deleted;
    })
    .catch((err) => {
      if (err instanceof Error && err.message === "MCP_SERVER_NOT_FOUND") {
        return null;
      }
      throw err;
    });

  if (!result) return notFound("MCP server not found");
  return json({ ok: true, deleted: serverId });
}

/**
 * GET /api/skills/mcp-servers/:id/key-status
 *
 * Returns whether a tenant API key is configured for this MCP server.
 * For admin-ops style servers (auth_type = "tenant_api_key"), the admin
 * SPA uses this to decide whether to open the set-key dialog when an
 * admin flips the per-template enable toggle.
 *
 * Response:
 *   - `authType`: echo of auth_type so the client doesn't need to
 *     re-fetch the whole server row.
 *   - `hasKey`: true when auth_config.token is a non-empty string.
 *   - `lastFour`: last 4 characters of the stored token (admin-only
 *     readable preview; never returns the full token).
 */
async function mcpKeyStatus(
  tenantSlug: string,
  serverId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const badUuid = requireUuid(serverId);
  if (badUuid) return badUuid;
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return error("Tenant not found", 404);

  const [row] = await db
    .select({
      auth_type: tenantMcpServers.auth_type,
      auth_config: tenantMcpServers.auth_config,
    })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.id, serverId),
        eq(tenantMcpServers.tenant_id, tenantId),
      ),
    )
    .limit(1);

  if (!row) return notFound("MCP server not found");

  const authConfig = (row.auth_config as Record<string, unknown> | null) || {};
  const token = (await resolveTenantApiKeyToken(authConfig)) ?? "";
  const hasKey = token.length > 0;

  return json({
    authType: row.auth_type,
    hasKey,
    lastFour: hasKey ? token.slice(-4) : null,
  });
}

/**
 * PUT /api/skills/mcp-servers/:id/api-key
 *
 * Set or rotate the tenant API key for an MCP server. Two modes:
 *
 *   { apiKey: "tkm_..." }      — store a caller-supplied token.
 *   { mintNew: true }          — auto-generate via the admin-ops
 *                                  provision flow (tkm_ + sha256 hash
 *                                  in tenant_mcp_admin_keys; raw token
 *                                  in Secrets Manager + auth_config).
 *
 * Writes both Secrets Manager (authoritative source) and
 * tenant_mcp_servers.auth_config.token (back-compat for mcp-configs
 * readers). Returns the last-4 preview so the client can update its
 * row without a second round-trip.
 *
 * owner/admin only — gate enforced by caller.
 */
async function mcpSetApiKey(
  tenantSlug: string,
  serverId: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const badUuid = requireUuid(serverId);
  if (badUuid) return badUuid;
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return error("Tenant not found", 404);

  const [server] = await db
    .select({
      id: tenantMcpServers.id,
      slug: tenantMcpServers.slug,
      url: tenantMcpServers.url,
      auth_type: tenantMcpServers.auth_type,
    })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.id, serverId),
        eq(tenantMcpServers.tenant_id, tenantId),
      ),
    )
    .limit(1);

  if (!server) return notFound("MCP server not found");
  if (server.auth_type !== "tenant_api_key") {
    return error(
      `Server auth_type is "${server.auth_type}", not "tenant_api_key". API key management only applies to tenant_api_key servers.`,
      400,
    );
  }

  let body: { apiKey?: string; mintNew?: boolean };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return error("Invalid JSON body", 400);
  }

  let rawToken: string;
  if (body.mintNew === true) {
    // Mint a fresh tkm_ token and persist the sha256 hash in
    // tenant_mcp_admin_keys. Mirrors mcp-admin-provision's flow so
    // admin-ops validation via the sha256 lookup keeps working.
    const suffix = randomBytes(32).toString("base64url");
    rawToken = `tkm_${suffix}`;
    const hash = createHash("sha256").update(rawToken).digest("hex");
    // Revoke any existing active default key to respect the
    // partial unique index uq_tenant_mcp_admin_keys_active_name.
    await db
      .update(tenantMcpAdminKeys)
      .set({ revoked_at: new Date() })
      .where(
        and(
          eq(tenantMcpAdminKeys.tenant_id, tenantId),
          eq(tenantMcpAdminKeys.name, "default"),
          isNull(tenantMcpAdminKeys.revoked_at),
        ),
      );
    await db.insert(tenantMcpAdminKeys).values({
      tenant_id: tenantId,
      key_hash: hash,
      name: "default",
    });
  } else if (typeof body.apiKey === "string" && body.apiKey.length > 0) {
    // Caller-supplied key. Don't validate the prefix — operators may
    // BYO a token from outside the tkm_ namespace (future). We just
    // store what they gave us.
    rawToken = body.apiKey;
  } else {
    return error(
      "Either apiKey (string) or mintNew=true must be supplied",
      400,
    );
  }

  // Upsert Secrets Manager + auth_config.
  const secretName = `thinkwork/${STAGE}/mcp/${tenantId}/${server.slug}`;
  const secretValue = JSON.stringify({ type: "mcpApiKey", token: rawToken });
  try {
    await sm.send(
      new UpdateSecretCommand({
        SecretId: secretName,
        SecretString: secretValue,
      }),
    );
  } catch (err: unknown) {
    if (err instanceof ResourceNotFoundException) {
      await sm.send(
        new CreateSecretCommand({
          Name: secretName,
          SecretString: secretValue,
        }),
      );
    } else {
      throw err;
    }
  }

  const nextAuthConfig = { secretRef: secretName };
  await db
    .update(tenantMcpServers)
    .set({
      auth_config: nextAuthConfig,
      url_hash: computeMcpUrlHash(server.url, nextAuthConfig),
      updated_at: new Date(),
    })
    .where(eq(tenantMcpServers.id, serverId));

  return json({
    ok: true,
    lastFour: rawToken.slice(-4),
    minted: body.mintNew === true,
  });
}

/**
 * GET /api/skills/mcp-servers/:id/service-credential-status
 *
 * Returns admin-safe service credential state for plugin-managed MCP servers.
 * Secret refs and raw token values stay server-side; only a configured flag and
 * last-4 preview are returned so operators can tell whether a token was saved.
 */
async function mcpServiceCredentialStatus(
  tenantSlug: string,
  serverId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const resolved = await resolveServiceCredentialServer(tenantSlug, serverId);
  if (!resolved.ok) return resolved.response;
  const server = resolved.server;

  const binding = primaryServiceCredentialBinding(server.authConfig);
  const credentialKind =
    typeof server.authConfig.credentialKind === "string"
      ? server.authConfig.credentialKind
      : null;
  const secretRefConfigured = Boolean(server.secretRef);
  const rawToken = await readServiceCredentialToken(server.secretRef, binding);

  return json({
    authType: server.authType,
    credentialKind,
    hasCredential: Boolean(rawToken),
    lastFour: rawToken ? rawToken.slice(-4) : null,
    secretRefConfigured,
    headerName: binding?.name ?? null,
    secretJsonKey: binding?.secretJsonKey ?? null,
  });
}

/**
 * PUT /api/skills/mcp-servers/:id/service-credential
 *
 * Stores a caller-supplied service access token in the preconfigured Secrets
 * Manager secret. This intentionally does not write the token into
 * tenant_mcp_servers.auth_config; auth_config only declares which secret/key
 * and header binding runtime dispatch should resolve.
 */
async function mcpSetServiceCredential(
  tenantSlug: string,
  serverId: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const resolved = await resolveServiceCredentialServer(tenantSlug, serverId);
  if (!resolved.ok) return resolved.response;
  const server = resolved.server;

  const binding = primaryServiceCredentialBinding(server.authConfig);
  if (!binding) {
    return error(
      "Service credential auth_config is missing a header binding.",
      400,
    );
  }
  if (!server.secretRef) {
    return error(
      "Service credential auth_config is missing its secretRef. Retry the plugin install after the managed application deployment is configured.",
      400,
    );
  }

  let body: { token?: unknown };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return error("Invalid JSON body", 400);
  }
  const rawToken = normalizeServiceCredentialToken(body.token);
  if (!rawToken.ok) return error(rawToken.error, 400);

  const existingSecret = await readExistingServiceCredentialSecret(
    server.secretRef,
  );
  if (!existingSecret.ok) return error(existingSecret.error, 500);
  const nextSecret = {
    ...existingSecret.value,
    type: "mcpServiceCredential",
    credentialKind: server.authConfig.credentialKind ?? "service_credential",
    [binding.secretJsonKey]: rawToken.value,
    updatedAt: new Date().toISOString(),
  };

  const written = await writeServiceCredentialSecret(
    server.secretRef,
    nextSecret,
  );
  if (!written.ok) return error(written.error, 500);

  await db
    .update(tenantMcpServers)
    .set({ updated_at: new Date() })
    .where(eq(tenantMcpServers.id, serverId));

  return json({
    ok: true,
    lastFour: rawToken.value.slice(-4),
    headerName: binding.name,
    secretJsonKey: binding.secretJsonKey,
  });
}

type ServiceCredentialServer = {
  id: string;
  slug: string;
  url: string;
  authType: string;
  authConfig: Record<string, unknown>;
  secretRef: string | null;
};

type ServiceCredentialServerResult =
  | { ok: true; server: ServiceCredentialServer }
  | { ok: false; response: APIGatewayProxyStructuredResultV2 };

async function resolveServiceCredentialServer(
  tenantSlug: string,
  serverId: string,
): Promise<ServiceCredentialServerResult> {
  const badUuid = requireUuid(serverId);
  if (badUuid) return { ok: false, response: badUuid };
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return { ok: false, response: error("Tenant not found", 404) };

  const [server] = await db
    .select({
      id: tenantMcpServers.id,
      slug: tenantMcpServers.slug,
      url: tenantMcpServers.url,
      auth_type: tenantMcpServers.auth_type,
      auth_config: tenantMcpServers.auth_config,
    })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.id, serverId),
        eq(tenantMcpServers.tenant_id, tenantId),
      ),
    )
    .limit(1);

  if (!server) {
    return { ok: false, response: notFound("MCP server not found") };
  }
  if (server.auth_type !== "service_credential") {
    return {
      ok: false,
      response: error(
        `Server auth_type is "${server.auth_type}", not "service_credential". Service credential management only applies to service_credential servers.`,
        400,
      ),
    };
  }

  const authConfig =
    typeof server.auth_config === "object" &&
    server.auth_config !== null &&
    !Array.isArray(server.auth_config)
      ? (server.auth_config as Record<string, unknown>)
      : {};
  const secretRef =
    typeof authConfig.secretRef === "string" && authConfig.secretRef.trim()
      ? authConfig.secretRef.trim()
      : null;

  return {
    ok: true,
    server: {
      id: server.id,
      slug: server.slug,
      url: server.url,
      authType: server.auth_type,
      authConfig,
      secretRef,
    },
  };
}

interface ServiceCredentialHeaderBinding {
  name: string;
  secretJsonKey: string;
  valuePrefix?: string;
}

function primaryServiceCredentialBinding(
  authConfig: Record<string, unknown>,
): ServiceCredentialHeaderBinding | null {
  const headers = authConfig.headers;
  if (!Array.isArray(headers)) return null;
  const bindings = headers.flatMap(
    (entry): ServiceCredentialHeaderBinding[] => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return [];
      }
      const header = entry as Record<string, unknown>;
      if (
        typeof header.name !== "string" ||
        !header.name.trim() ||
        typeof header.secretJsonKey !== "string" ||
        !header.secretJsonKey.trim()
      ) {
        return [];
      }
      return [
        {
          name: header.name.trim(),
          secretJsonKey: header.secretJsonKey.trim(),
          ...(typeof header.valuePrefix === "string"
            ? { valuePrefix: header.valuePrefix }
            : {}),
        },
      ];
    },
  );
  return (
    bindings.find(
      (binding) => binding.name.toLowerCase() === "authorization",
    ) ??
    bindings[0] ??
    null
  );
}

function normalizeServiceCredentialToken(
  value: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: "token must be a non-empty string" };
  }
  const token = value
    .trim()
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) return { ok: false, error: "token must be a non-empty string" };
  if (/[\r\n\0]/.test(token)) {
    return {
      ok: false,
      error: "token must not contain newline or null characters",
    };
  }
  return { ok: true, value: token };
}

type ServiceCredentialSecretValue = Record<string, unknown> | string | null;

function parseServiceCredentialSecret(
  secretString?: string,
): ServiceCredentialSecretValue {
  if (!secretString) return null;
  try {
    const parsed = JSON.parse(secretString) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return secretString.trim() ? secretString.trim() : null;
  }
}

function serviceCredentialSecretField(
  secretValue: ServiceCredentialSecretValue,
  key: string,
): string | undefined {
  if (typeof secretValue === "string") {
    return key === "token" && secretValue.trim()
      ? secretValue.trim()
      : undefined;
  }
  if (!secretValue) return undefined;
  const value = secretValue[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function readServiceCredentialToken(
  secretRef: string | null,
  binding: ServiceCredentialHeaderBinding | null,
): Promise<string | null> {
  if (!secretRef || !binding) return null;
  try {
    const secret = await sm.send(
      new GetSecretValueCommand({ SecretId: secretRef }),
    );
    return (
      serviceCredentialSecretField(
        parseServiceCredentialSecret(secret.SecretString),
        binding.secretJsonKey,
      ) ?? null
    );
  } catch (err: unknown) {
    if (err instanceof ResourceNotFoundException) return null;
    throw err;
  }
}

async function readExistingServiceCredentialSecret(
  secretRef: string,
): Promise<
  { ok: true; value: Record<string, unknown> } | { ok: false; error: string }
> {
  try {
    const secret = await sm.send(
      new GetSecretValueCommand({ SecretId: secretRef }),
    );
    const parsed = parseServiceCredentialSecret(secret.SecretString);
    if (parsed && typeof parsed === "object") {
      return { ok: true, value: parsed };
    }
    return { ok: true, value: {} };
  } catch (err: unknown) {
    if (err instanceof ResourceNotFoundException) {
      return { ok: true, value: {} };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Failed to read service credential secret: ${message}`,
    };
  }
}

async function writeServiceCredentialSecret(
  secretRef: string,
  value: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const secretString = JSON.stringify(value);
  try {
    await sm.send(
      new UpdateSecretCommand({
        SecretId: secretRef,
        SecretString: secretString,
      }),
    );
    return { ok: true };
  } catch (err: unknown) {
    if (!(err instanceof ResourceNotFoundException)) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: `Failed to update service credential secret: ${message}`,
      };
    }
    if (secretRef.startsWith("arn:")) {
      return {
        ok: false,
        error:
          "Service credential secret ARN was not found. Redeploy the managed application so Terraform creates the configured secret.",
      };
    }
    try {
      await sm.send(
        new CreateSecretCommand({
          Name: secretRef,
          SecretString: secretString,
        }),
      );
      return { ok: true };
    } catch (createErr: unknown) {
      const message =
        createErr instanceof Error ? createErr.message : String(createErr);
      return {
        ok: false,
        error: `Failed to create service credential secret: ${message}`,
      };
    }
  }
}

async function mcpTestConnection(
  tenantSlug: string,
  serverId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const badUuid = requireUuid(serverId);
  if (badUuid) return badUuid;
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return error("Tenant not found", 404);

  const [row] = await db
    .select()
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.id, serverId),
        eq(tenantMcpServers.tenant_id, tenantId),
      ),
    );

  if (!row) return notFound("MCP server not found");

  const target: McpServerTarget = {
    url: row.url,
    name: row.slug || row.name,
  };
  if (row.auth_type === "tenant_api_key") {
    const authCfg = (row.auth_config as Record<string, unknown>) || {};
    const token = await resolveTenantApiKeyToken(authCfg);
    if (token) target.token = token;
  } else if (row.auth_type === "service_credential") {
    const authCfg = (row.auth_config as Record<string, unknown>) || {};
    const resolved = await resolveServiceCredentialTestAuth(authCfg);
    if (!resolved.ok) return json({ ok: false, error: resolved.error }, 502);
    if (resolved.token) target.token = resolved.token;
    if (resolved.headers) target.headers = resolved.headers;
  }

  try {
    const discoveredTools = await mcpListTools(target, { timeoutMs: 10000 });
    const discoveredToolRecords = discoveredTools.map((t) => ({
      name: t.name,
      ...(t.description !== undefined ? { description: t.description } : {}),
      ...(t.inputSchema !== undefined ? { inputSchema: t.inputSchema } : {}),
    }));
    const tools = discoveredToolRecords.map((t) => ({
      name: t.name,
      description: t.description,
    }));

    // Cache discovered tools in DB
    await db
      .update(tenantMcpServers)
      .set({ tools, updated_at: new Date() })
      .where(eq(tenantMcpServers.id, serverId));

    await upsertMcpContextToolEligibility(
      tenantId,
      serverId,
      discoveredToolRecords,
    );

    return json({ ok: true, tools });
  } catch (err: any) {
    return json({ ok: false, error: err.message || "Connection failed" }, 502);
  }
}

type ResolvedMcpTestAuth =
  | { ok: true; token?: string; headers?: Record<string, string> }
  | { ok: false; error: string };

async function resolveServiceCredentialTestAuth(
  authConfig: Record<string, unknown>,
): Promise<ResolvedMcpTestAuth> {
  if (typeof authConfig.revokedAt === "string" || authConfig.revoked === true) {
    return { ok: false, error: "Service credential is revoked" };
  }
  const secretRef =
    typeof authConfig.secretRef === "string" && authConfig.secretRef.trim()
      ? authConfig.secretRef.trim()
      : null;
  if (!secretRef) {
    return { ok: false, error: "Service credential secretRef is missing" };
  }
  const binding = primaryServiceCredentialBinding(authConfig);
  if (!binding) {
    return {
      ok: false,
      error: "Service credential auth_config is missing a header binding",
    };
  }

  let secretValue: ServiceCredentialSecretValue | null = null;
  try {
    const secret = await sm.send(
      new GetSecretValueCommand({ SecretId: secretRef }),
    );
    secretValue = parseServiceCredentialSecret(secret.SecretString);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Failed to read service credential secret: ${message}`,
    };
  }

  const raw = serviceCredentialSecretField(secretValue, binding.secretJsonKey);
  if (!raw) {
    return {
      ok: false,
      error: `Service credential secret is missing key ${binding.secretJsonKey}`,
    };
  }
  const headerValue = `${binding.valuePrefix ?? ""}${raw}`;
  if (binding.name.toLowerCase() === "authorization") {
    const bearer = headerValue.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!bearer) {
      return {
        ok: false,
        error: "Service credential Authorization header must use Bearer auth",
      };
    }
    return { ok: true, token: bearer };
  }
  return { ok: true, headers: { [binding.name]: headerValue } };
}

async function mcpListContextTools(
  tenantSlug: string,
  serverId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const badUuid = requireUuid(serverId);
  if (badUuid) return badUuid;
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return error("Tenant not found", 404);

  const [server] = await db
    .select({ id: tenantMcpServers.id })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.id, serverId),
        eq(tenantMcpServers.tenant_id, tenantId),
      ),
    )
    .limit(1);
  if (!server) return notFound("MCP server not found");

  const rows = await db
    .select()
    .from(tenantMcpContextTools)
    .where(
      and(
        eq(tenantMcpContextTools.tenant_id, tenantId),
        eq(tenantMcpContextTools.mcp_server_id, serverId),
      ),
    );

  return json({ tools: rows.map(formatMcpContextTool) });
}

async function mcpUpdateContextTool(
  tenantSlug: string,
  toolId: string,
  event: APIGatewayProxyEventV2,
  userId: string | null,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (!UUID_RE.test(toolId)) return notFound("MCP context tool not found");
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return error("Tenant not found", 404);

  const body = JSON.parse(event.body || "{}") as {
    approved?: unknown;
    defaultEnabled?: unknown;
  };
  const [existing] = await db
    .select()
    .from(tenantMcpContextTools)
    .where(
      and(
        eq(tenantMcpContextTools.id, toolId),
        eq(tenantMcpContextTools.tenant_id, tenantId),
      ),
    )
    .limit(1);
  if (!existing) return notFound("MCP context tool not found");

  const updates: Partial<typeof tenantMcpContextTools.$inferInsert> = {
    updated_at: new Date(),
  };
  let approved = existing.approved;
  if (body.approved !== undefined) {
    if (typeof body.approved !== "boolean")
      return error("approved must be a boolean", 400);
    approved = body.approved;
    updates.approved = approved;
    updates.approved_by = approved ? userId : null;
    updates.approved_at = approved ? new Date() : null;
    if (!approved) updates.default_enabled = false;
  }
  if (body.defaultEnabled !== undefined) {
    if (typeof body.defaultEnabled !== "boolean") {
      return error("defaultEnabled must be a boolean", 400);
    }
    if (body.defaultEnabled && !approved) {
      return error(
        "Approve the context tool before enabling it by default",
        400,
      );
    }
    updates.default_enabled = body.defaultEnabled;
  }

  const [updated] = await db
    .update(tenantMcpContextTools)
    .set(updates)
    .where(eq(tenantMcpContextTools.id, toolId))
    .returning();

  return json({ tool: formatMcpContextTool(updated) });
}

function formatMcpContextTool(row: typeof tenantMcpContextTools.$inferSelect) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    mcpServerId: row.mcp_server_id,
    toolName: row.tool_name,
    displayName: row.display_name,
    declaredReadOnly: row.declared_read_only,
    declaredSearchSafe: row.declared_search_safe,
    approved: row.approved,
    defaultEnabled: row.default_enabled,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function upsertMcpContextToolEligibility(
  tenantId: string,
  serverId: string,
  tools: Array<
    Record<string, unknown> & { name: string; description?: string }
  >,
): Promise<void> {
  for (const tool of tools) {
    const context = isRecord(tool.contextEngine)
      ? tool.contextEngine
      : isRecord(tool.metadata) && isRecord(tool.metadata.contextEngine)
        ? tool.metadata.contextEngine
        : {};
    const annotations = isRecord(tool.annotations) ? tool.annotations : {};
    const declaredReadOnly =
      annotations.readOnlyHint === true || context.readOnly === true;
    const declaredSearchSafe = context.searchSafe === true;
    const displayName =
      typeof tool.title === "string"
        ? tool.title
        : typeof tool.description === "string"
          ? tool.description.slice(0, 80)
          : tool.name;

    await db
      .insert(tenantMcpContextTools)
      .values({
        tenant_id: tenantId,
        mcp_server_id: serverId,
        tool_name: tool.name,
        display_name: displayName,
        declared_read_only: declaredReadOnly,
        declared_search_safe: declaredSearchSafe,
        metadata: tool,
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          tenantMcpContextTools.tenant_id,
          tenantMcpContextTools.mcp_server_id,
          tenantMcpContextTools.tool_name,
        ],
        set: {
          display_name: displayName,
          declared_read_only: declaredReadOnly,
          declared_search_safe: declaredSearchSafe,
          metadata: tool,
          updated_at: new Date(),
        },
      });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function resolveTenantApiKeyToken(
  authConfig: Record<string, unknown>,
): Promise<string | null> {
  const secretRef =
    typeof authConfig.secretRef === "string" && authConfig.secretRef.trim()
      ? authConfig.secretRef.trim()
      : null;
  if (secretRef) {
    const secret = await sm.send(
      new GetSecretValueCommand({ SecretId: secretRef }),
    );
    return extractTokenFromSecretString(secret.SecretString);
  }

  const token = authConfig.token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

function extractTokenFromSecretString(secretString?: string): string | null {
  if (!secretString) return null;
  try {
    const parsed = JSON.parse(secretString) as Record<string, unknown>;
    const token = parsed.token ?? parsed.apiKey ?? parsed.access_token;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return secretString.length > 0 ? secretString : null;
  }
}

// ---------------------------------------------------------------------------
// MCP Server — Agent Assignment (uses agent_mcp_servers table)
// ---------------------------------------------------------------------------

async function mcpListAgentServers(
  agentId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const rows = await db
    .select({
      id: agentMcpServers.id,
      mcp_server_id: agentMcpServers.mcp_server_id,
      enabled: agentMcpServers.enabled,
      config: agentMcpServers.config,
      name: tenantMcpServers.name,
      slug: tenantMcpServers.slug,
      url: tenantMcpServers.url,
      transport: tenantMcpServers.transport,
      auth_type: tenantMcpServers.auth_type,
      oauth_provider: tenantMcpServers.oauth_provider,
      tools: tenantMcpServers.tools,
      server_enabled: tenantMcpServers.enabled,
    })
    .from(agentMcpServers)
    .innerJoin(
      tenantMcpServers,
      eq(agentMcpServers.mcp_server_id, tenantMcpServers.id),
    )
    .where(eq(agentMcpServers.agent_id, agentId));

  return json({
    servers: rows.map((r) => ({
      id: r.id,
      mcpServerId: r.mcp_server_id,
      name: r.name,
      slug: r.slug,
      url: r.url,
      transport: r.transport,
      authType: r.auth_type,
      oauthProvider: r.oauth_provider,
      tools: r.tools,
      enabled: r.enabled && r.server_enabled,
      config: r.config,
    })),
  });
}

async function mcpAssignToAgent(
  agentId: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const body = JSON.parse(event.body || "{}");
  const { mcpServerId, config } = body;

  if (!mcpServerId) return error("mcpServerId is required", 400);

  // Resolve agent's tenant_id
  const { agents } = await import("@thinkwork/database-pg/schema");
  const [agentRow] = await db
    .select({ tenant_id: agents.tenant_id })
    .from(agents)
    .where(eq(agents.id, agentId));
  if (!agentRow) return error("Agent not found", 404);

  // Verify MCP server belongs to same tenant
  const [server] = await db
    .select({ id: tenantMcpServers.id })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.id, mcpServerId),
        eq(tenantMcpServers.tenant_id, agentRow.tenant_id),
      ),
    );
  if (!server) return error("MCP server not found in this tenant", 404);

  // Upsert
  const [existing] = await db
    .select({ id: agentMcpServers.id })
    .from(agentMcpServers)
    .where(
      and(
        eq(agentMcpServers.agent_id, agentId),
        eq(agentMcpServers.mcp_server_id, mcpServerId),
      ),
    );

  if (existing) {
    await db
      .update(agentMcpServers)
      .set({ enabled: true, config: config || null, updated_at: new Date() })
      .where(eq(agentMcpServers.id, existing.id));
    return json({ id: existing.id, updated: true });
  }

  const [inserted] = await db
    .insert(agentMcpServers)
    .values({
      agent_id: agentId,
      tenant_id: agentRow.tenant_id,
      mcp_server_id: mcpServerId,
      config: config || null,
    })
    .returning({ id: agentMcpServers.id });

  return json({ id: inserted.id, created: true });
}

async function mcpUnassignFromAgent(
  agentId: string,
  mcpServerId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const deleted = await db
    .delete(agentMcpServers)
    .where(
      and(
        eq(agentMcpServers.agent_id, agentId),
        eq(agentMcpServers.mcp_server_id, mcpServerId),
      ),
    )
    .returning({ id: agentMcpServers.id });

  if (deleted.length === 0) return notFound("MCP server assignment not found");
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// MCP Server — OAuth Providers + User View
// ---------------------------------------------------------------------------

async function mcpGetTemplateMcpServers(
  templateId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const rows = await db
    .select({
      id: agentTemplateMcpServers.id,
      mcp_server_id: agentTemplateMcpServers.mcp_server_id,
      enabled: agentTemplateMcpServers.enabled,
      name: tenantMcpServers.name,
      slug: tenantMcpServers.slug,
      url: tenantMcpServers.url,
      auth_type: tenantMcpServers.auth_type,
    })
    .from(agentTemplateMcpServers)
    .innerJoin(
      tenantMcpServers,
      eq(agentTemplateMcpServers.mcp_server_id, tenantMcpServers.id),
    )
    .where(eq(agentTemplateMcpServers.template_id, templateId));

  return json({
    mcpServers: rows.map((r) => ({
      mcp_server_id: r.mcp_server_id,
      enabled: r.enabled,
      name: r.name,
      slug: r.slug,
      url: r.url,
      authType: r.auth_type,
    })),
  });
}

async function mcpAssignToTemplate(
  templateId: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const body = JSON.parse(event.body || "{}");
  const { mcpServerId } = body;
  if (!mcpServerId) return error("mcpServerId is required", 400);

  // Resolve tenant_id from template
  const { agentTemplates } = await import("@thinkwork/database-pg/schema");
  const [template] = await db
    .select({ tenant_id: agentTemplates.tenant_id })
    .from(agentTemplates)
    .where(eq(agentTemplates.id, templateId));
  if (!template) return error("Template not found", 404);

  // Upsert
  const [existing] = await db
    .select({ id: agentTemplateMcpServers.id })
    .from(agentTemplateMcpServers)
    .where(
      and(
        eq(agentTemplateMcpServers.template_id, templateId),
        eq(agentTemplateMcpServers.mcp_server_id, mcpServerId),
      ),
    );

  if (existing) {
    await db
      .update(agentTemplateMcpServers)
      .set({ enabled: true, updated_at: new Date() })
      .where(eq(agentTemplateMcpServers.id, existing.id));
    return json({ id: existing.id, updated: true });
  }

  const [inserted] = await db
    .insert(agentTemplateMcpServers)
    .values({
      template_id: templateId,
      tenant_id: template.tenant_id!,
      mcp_server_id: mcpServerId,
    })
    .returning({ id: agentTemplateMcpServers.id });

  return json({ id: inserted.id, created: true });
}

async function mcpUnassignFromTemplate(
  templateId: string,
  mcpServerId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const deleted = await db
    .delete(agentTemplateMcpServers)
    .where(
      and(
        eq(agentTemplateMcpServers.template_id, templateId),
        eq(agentTemplateMcpServers.mcp_server_id, mcpServerId),
      ),
    )
    .returning({ id: agentTemplateMcpServers.id });

  if (deleted.length === 0)
    return notFound("MCP server not assigned to template");
  return json({ ok: true });
}

async function mcpListOAuthProviders(): Promise<APIGatewayProxyStructuredResultV2> {
  const { connectProviders } = await import("@thinkwork/database-pg/schema");
  const rows = await db
    .select({
      id: connectProviders.id,
      name: connectProviders.name,
      display_name: connectProviders.display_name,
      provider_type: connectProviders.provider_type,
      is_available: connectProviders.is_available,
    })
    .from(connectProviders)
    .where(eq(connectProviders.is_available, true));

  return json({
    providers: rows.map((r) => ({
      id: r.id,
      name: r.name,
      displayName: r.display_name,
      providerType: r.provider_type,
    })),
  });
}

async function mcpClearUserToken(
  userId: string,
  tenantId: string,
  mcpServerId: string,
) {
  const { userMcpTokens } = await import("@thinkwork/database-pg/schema");

  // Find the token row
  const [tokenRow] = await db
    .select({ id: userMcpTokens.id, secret_ref: userMcpTokens.secret_ref })
    .from(userMcpTokens)
    .where(
      and(
        eq(userMcpTokens.user_id, userId),
        eq(userMcpTokens.tenant_id, tenantId),
        eq(userMcpTokens.mcp_server_id, mcpServerId),
      ),
    );

  if (!tokenRow) {
    return json({ ok: true, message: "No token found" });
  }

  // Delete the secret from Secrets Manager if it exists
  if (tokenRow.secret_ref) {
    try {
      const { SecretsManagerClient, DeleteSecretCommand } =
        await import("@aws-sdk/client-secrets-manager");
      const sm = new SecretsManagerClient({
        region: process.env.AWS_REGION || "us-east-1",
      });
      await sm.send(
        new DeleteSecretCommand({
          SecretId: tokenRow.secret_ref,
          ForceDeleteWithoutRecovery: true,
        }),
      );
    } catch (err) {
      console.warn(
        "[mcp-clear-token] Failed to delete secret:",
        (err as Error).message,
      );
    }
  }

  // Delete the token row
  await db.delete(userMcpTokens).where(eq(userMcpTokens.id, tokenRow.id));

  return json({ ok: true, cleared: true });
}

async function serviceCredentialAuthStatus(
  authType: string | null,
  authConfigValue: unknown,
): Promise<"active" | "not_connected" | undefined> {
  if (authType !== "service_credential") return undefined;
  const authConfig =
    typeof authConfigValue === "object" &&
    authConfigValue !== null &&
    !Array.isArray(authConfigValue)
      ? (authConfigValue as Record<string, unknown>)
      : {};
  const secretRef =
    typeof authConfig.secretRef === "string" && authConfig.secretRef.trim()
      ? authConfig.secretRef.trim()
      : null;
  const binding = primaryServiceCredentialBinding(authConfig);
  try {
    const rawToken = await readServiceCredentialToken(secretRef, binding);
    return rawToken ? "active" : "not_connected";
  } catch (err) {
    console.warn(
      "[mcp] failed to read service credential status for tenant MCP list:",
      err,
    );
    return "not_connected";
  }
}

async function mcpListUserServers(
  tenantId: string,
  userId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { agents, userMcpTokens } =
    await import("@thinkwork/database-pg/schema");

  // Find all agents paired with this user. Agent assignments describe runtime
  // availability, but managed/plugin OAuth connectors still need to be
  // user-visible so the user can authenticate before an agent invocation needs
  // them.
  const userAgents = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(
      and(eq(agents.tenant_id, tenantId), eq(agents.human_pair_id, userId)),
    );

  const agentIds = userAgents.map((a) => a.id);

  // Get all MCP servers assigned to these agents
  const assignedRows =
    agentIds.length > 0
      ? await db
          .select({
            assignment_id: agentMcpServers.id,
            agent_id: agentMcpServers.agent_id,
            mcp_server_id: agentMcpServers.mcp_server_id,
            enabled: agentMcpServers.enabled,
            name: tenantMcpServers.name,
            slug: tenantMcpServers.slug,
            url: tenantMcpServers.url,
            auth_type: tenantMcpServers.auth_type,
            tools: tenantMcpServers.tools,
            server_enabled: tenantMcpServers.enabled,
            management_source: tenantMcpServers.management_source,
            managed_application_key: tenantMcpServers.managed_application_key,
          })
          .from(agentMcpServers)
          .innerJoin(
            tenantMcpServers,
            eq(agentMcpServers.mcp_server_id, tenantMcpServers.id),
          )
          .where(inArray(agentMcpServers.agent_id, agentIds))
      : [];

  const managedRows = await db
    .select({
      mcp_server_id: tenantMcpServers.id,
      name: tenantMcpServers.name,
      slug: tenantMcpServers.slug,
      url: tenantMcpServers.url,
      auth_type: tenantMcpServers.auth_type,
      tools: tenantMcpServers.tools,
      server_enabled: tenantMcpServers.enabled,
      management_source: tenantMcpServers.management_source,
      managed_application_key: tenantMcpServers.managed_application_key,
    })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.tenant_id, tenantId),
        or(
          eq(tenantMcpServers.management_source, "managed_application"),
          eq(tenantMcpServers.management_source, "plugin"),
        ),
        eq(tenantMcpServers.enabled, true),
        eq(tenantMcpServers.status, "approved"),
      ),
    );

  const rows = [
    ...assignedRows,
    ...managedRows
      .filter(
        (r) => r.auth_type === "oauth" || r.auth_type === "per_user_oauth",
      )
      .map((r) => ({
        ...r,
        assignment_id: null,
        agent_id: null,
        enabled: false,
      })),
  ];

  // For OAuth servers, check if user has an active token in user_mcp_tokens
  const oauthServerIds = [
    ...new Set(
      rows
        .filter(
          (r) => r.auth_type === "oauth" || r.auth_type === "per_user_oauth",
        )
        .map((r) => r.mcp_server_id),
    ),
  ];

  const userTokens =
    oauthServerIds.length > 0
      ? await db
          .select({
            mcp_server_id: userMcpTokens.mcp_server_id,
            status: userMcpTokens.status,
          })
          .from(userMcpTokens)
          .where(
            and(
              eq(userMcpTokens.user_id, userId),
              eq(userMcpTokens.tenant_id, tenantId),
              inArray(userMcpTokens.mcp_server_id, oauthServerIds),
            ),
          )
      : [];

  const tokenByServer = new Map(userTokens.map((t) => [t.mcp_server_id, t]));

  // Deduplicate MCP servers (same server may be assigned to multiple agents)
  const seen = new Set<string>();
  const servers = rows
    .filter((r) => {
      if (seen.has(r.mcp_server_id)) return false;
      seen.add(r.mcp_server_id);
      return true;
    })
    .map((r) => {
      let authStatus: "active" | "not_connected" | "expired" = "active";
      if (r.auth_type === "oauth" || r.auth_type === "per_user_oauth") {
        const tok = tokenByServer.get(r.mcp_server_id);
        if (!tok) authStatus = "not_connected";
        else if (tok.status !== "active") authStatus = "expired";
      }
      const agentName = userAgents.find((a) => a.id === r.agent_id)?.name;
      const runtimeAssigned = Boolean(r.assignment_id);
      const runtimeEnabled = runtimeAssigned && r.enabled && r.server_enabled;
      return {
        id: r.mcp_server_id,
        name: r.name,
        slug: r.slug,
        url: r.url,
        authType: r.auth_type,
        tools: r.tools,
        enabled: runtimeEnabled || (!runtimeAssigned && r.server_enabled),
        authStatus,
        agentName,
        runtimeAssigned,
        runtimeEnabled,
        managementSource: r.management_source,
        managedApplicationKey: r.managed_application_key,
      };
    });

  return json({ servers });
}

// ---------------------------------------------------------------------------
// Built-in Tools — tenant-level config for platform-owned built-ins.
// ---------------------------------------------------------------------------

const BUILTIN_TOOL_CATALOG: Record<
  string,
  { providers: string[]; keyEnvVar: Record<string, string> }
> = {
  "web-search": {
    providers: ["exa", "serpapi"],
    keyEnvVar: { exa: "EXA_API_KEY", serpapi: "SERPAPI_KEY" },
  },
  "web-extract": {
    providers: ["firecrawl"],
    keyEnvVar: { firecrawl: "FIRECRAWL_API_KEY" },
  },
};

async function builtinToolsList(
  tenantSlug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return error("Tenant not found", 404);

  const rows = await db
    .select()
    .from(tenantBuiltinTools)
    .where(eq(tenantBuiltinTools.tenant_id, tenantId));

  return json({
    tools: rows.map((r) => ({
      id: r.id,
      toolSlug: r.tool_slug,
      provider: r.provider,
      enabled: r.enabled,
      config: r.config,
      hasSecret: !!r.secret_ref,
      lastTestedAt: r.last_tested_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  });
}

async function builtinToolsUpsert(
  tenantSlug: string,
  slug: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return error("Tenant not found", 404);

  const catalogEntry = BUILTIN_TOOL_CATALOG[slug];
  if (!catalogEntry) return error(`Unknown built-in tool '${slug}'`, 400);

  const body = JSON.parse(event.body || "{}") as {
    provider?: string;
    enabled?: boolean;
    config?: Record<string, unknown>;
    apiKey?: string;
  };

  if (body.provider && !catalogEntry.providers.includes(body.provider)) {
    return error(
      `provider must be one of ${catalogEntry.providers.join(", ")}`,
      400,
    );
  }

  const [existing] = await db
    .select()
    .from(tenantBuiltinTools)
    .where(
      and(
        eq(tenantBuiltinTools.tenant_id, tenantId),
        eq(tenantBuiltinTools.tool_slug, slug),
      ),
    );

  let secretRef = existing?.secret_ref ?? null;
  if (body.apiKey) {
    const secretName = builtinToolSecretName(STAGE, tenantId, slug);
    const secretValue = JSON.stringify({
      type: "builtinToolApiKey",
      token: body.apiKey,
    });
    try {
      await sm.send(
        new UpdateSecretCommand({
          SecretId: secretName,
          SecretString: secretValue,
        }),
      );
    } catch (err: any) {
      if (err instanceof ResourceNotFoundException) {
        await sm.send(
          new CreateSecretCommand({
            Name: secretName,
            SecretString: secretValue,
          }),
        );
      } else {
        throw err;
      }
    }
    secretRef = secretName;
  }

  if (existing) {
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (body.provider !== undefined) updates.provider = body.provider;
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.config !== undefined) updates.config = body.config;
    if (secretRef !== existing.secret_ref) updates.secret_ref = secretRef;

    await db
      .update(tenantBuiltinTools)
      .set(updates)
      .where(eq(tenantBuiltinTools.id, existing.id));
    return json({ id: existing.id, toolSlug: slug, updated: true });
  }

  const [inserted] = await db
    .insert(tenantBuiltinTools)
    .values({
      tenant_id: tenantId,
      tool_slug: slug,
      provider: body.provider ?? null,
      enabled: body.enabled ?? false,
      config: body.config ?? null,
      secret_ref: secretRef,
    })
    .returning({ id: tenantBuiltinTools.id });

  return json({ id: inserted.id, toolSlug: slug, created: true });
}

async function builtinToolsDelete(
  tenantSlug: string,
  slug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return error("Tenant not found", 404);

  const [row] = await db
    .select()
    .from(tenantBuiltinTools)
    .where(
      and(
        eq(tenantBuiltinTools.tenant_id, tenantId),
        eq(tenantBuiltinTools.tool_slug, slug),
      ),
    );

  if (!row) return notFound("Built-in tool config not found");

  if (row.secret_ref) {
    try {
      await sm.send(
        new DeleteSecretCommand({
          SecretId: row.secret_ref,
          ForceDeleteWithoutRecovery: true,
        }),
      );
    } catch (err) {
      console.warn(
        `[builtin-tools] Failed to delete secret: ${(err as Error).message}`,
      );
    }
  }

  await db.delete(tenantBuiltinTools).where(eq(tenantBuiltinTools.id, row.id));
  return json({ ok: true, deleted: slug });
}

async function builtinToolsTest(
  tenantSlug: string,
  slug: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return error("Tenant not found", 404);

  // Allow testing with a key supplied in the request body (before it's saved)
  // OR with the stored secret_ref for an existing row.
  const body = (event.body ? JSON.parse(event.body) : {}) as {
    provider?: string;
    apiKey?: string;
    url?: string;
  };

  let provider = body.provider;
  let apiKey = body.apiKey;

  if (!apiKey) {
    const [row] = await db
      .select()
      .from(tenantBuiltinTools)
      .where(
        and(
          eq(tenantBuiltinTools.tenant_id, tenantId),
          eq(tenantBuiltinTools.tool_slug, slug),
        ),
      );
    if (!row) return error("No saved config and no apiKey provided", 400);
    provider = provider ?? row.provider ?? undefined;
    if (row.secret_ref) {
      apiKey = (await resolveBuiltinToolApiKey(row.secret_ref)) ?? undefined;
    }
  }

  if (!provider) return error("provider is required", 400);
  if (!apiKey)
    return error("apiKey is required (and no stored secret was found)", 400);

  try {
    if (slug === "web-extract") {
      if (provider !== "firecrawl") {
        return error("provider must be firecrawl", 400);
      }
      const result = await runFirecrawlScrape({
        provider: "firecrawl",
        apiKey,
        url: body.url || "https://example.com/",
      });
      await markBuiltinToolTested(tenantId, slug);
      return json({
        ok: true,
        provider,
        resultCount: result.markdown ? 1 : 0,
      });
    }

    if (slug !== "web-search") {
      return error(`Test not implemented for tool '${slug}'`, 400);
    }

    if (provider === "exa") {
      const results = await runWebSearch({
        provider: "exa",
        apiKey,
        query: "ping",
        limit: 1,
      });
      await markBuiltinToolTested(tenantId, slug);
      return json({ ok: true, provider, resultCount: results.length });
    }

    if (provider === "serpapi") {
      const results = await runWebSearch({
        provider: "serpapi",
        apiKey,
        query: "ping",
        limit: 1,
      });
      await markBuiltinToolTested(tenantId, slug);
      return json({ ok: true, provider, resultCount: results.length });
    }

    return error(`Unknown provider '${provider}'`, 400);
  } catch (err: any) {
    return json({ ok: false, error: err.message || "Test failed" }, 502);
  }
}

async function markBuiltinToolTested(
  tenantId: string,
  slug: string,
): Promise<void> {
  await db
    .update(tenantBuiltinTools)
    .set({ last_tested_at: new Date() })
    .where(
      and(
        eq(tenantBuiltinTools.tenant_id, tenantId),
        eq(tenantBuiltinTools.tool_slug, slug),
      ),
    );
}

// ---------------------------------------------------------------------------
// Skill-run start (Unit 5) — service-to-service wrapper around startSkillRun.
//
// The AgentCore-container dispatcher skill calls this with API_AUTH_SECRET
// to start a skill run on behalf of the chat invoker. We trust the caller
// (container runs inside our infra + has the secret) to assert the invoker's
// identity. Cognito-JWT-driven callers should use the GraphQL mutation
// instead — this endpoint is explicitly for service identities that have
// already resolved the user.
// ---------------------------------------------------------------------------

const VALID_INVOCATION_SOURCES = new Set([
  "chat",
  "scheduled",
  "catalog",
  "webhook",
]);

interface StartSkillRunServiceBody {
  tenantId: string;
  invokerUserId: string;
  agentId?: string;
  skillId: string;
  skillVersion?: number;
  invocationSource: string;
  inputs?: Record<string, unknown>;
  deliveryChannels?: unknown[];
}

async function startSkillRunService(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  let body: StartSkillRunServiceBody;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return error("Invalid JSON body", 400);
  }

  const {
    tenantId,
    invokerUserId,
    agentId,
    skillId,
    skillVersion = 1,
    invocationSource,
    inputs = {},
    deliveryChannels = [],
  } = body;

  if (!tenantId || !invokerUserId || !skillId || !invocationSource) {
    return error(
      "Missing required fields: tenantId, invokerUserId, skillId, invocationSource",
      400,
    );
  }
  if (!VALID_INVOCATION_SOURCES.has(invocationSource)) {
    return error(
      `invocationSource must be one of chat|scheduled|catalog|webhook (got ${invocationSource})`,
      400,
    );
  }

  // Sanity check: the claimed invoker belongs to the claimed tenant.
  // Prevents a compromised container (or a bad call) from pinning one
  // tenant's user to another tenant's run.
  const [invoker] = await db
    .select({ id: users.id, tenant_id: users.tenant_id })
    .from(users)
    .where(eq(users.id, invokerUserId));
  if (!invoker) return error("invokerUserId not found", 404);
  if (invoker.tenant_id !== tenantId) {
    return error("invokerUserId tenant mismatch", 403);
  }

  const resolvedInputs = inputs;
  const resolvedInputsHash = hashResolvedInputs(resolvedInputs);
  // Per-run HMAC secret for /api/skills/complete authentication. Shipped
  // to the agentcore container in the run_skill envelope; burned to NULL
  // when the row transitions to a terminal status (single-use).
  const completionHmacSecret = randomBytes(32).toString("hex");

  const inserted = await db
    .insert(skillRuns)
    .values({
      tenant_id: tenantId,
      agent_id: agentId ?? null,
      invoker_user_id: invokerUserId,
      skill_id: skillId,
      skill_version: skillVersion,
      invocation_source: invocationSource,
      inputs: resolvedInputs,
      resolved_inputs: resolvedInputs,
      resolved_inputs_hash: resolvedInputsHash,
      delivery_channels: deliveryChannels,
      status: "running",
      completion_hmac_secret: completionHmacSecret,
    })
    .onConflictDoNothing({
      target: [
        skillRuns.tenant_id,
        skillRuns.invoker_user_id,
        skillRuns.skill_id,
        skillRuns.resolved_inputs_hash,
      ],
      // Match the partial unique index `uq_skill_runs_dedup_active`
      // (WHERE status='running'). Without this predicate Postgres
      // cannot resolve the ON CONFLICT target against a partial index
      // and raises error 42P10.
      where: sql`status = 'running'`,
    })
    .returning();

  if (inserted.length === 0) {
    // Dedup hit — surface the active run so the dispatcher can tell
    // the user "already running, view progress" without starting a
    // duplicate skill run.
    const [existing] = await db
      .select()
      .from(skillRuns)
      .where(
        and(
          eq(skillRuns.tenant_id, tenantId),
          eq(skillRuns.invoker_user_id, invokerUserId),
          eq(skillRuns.skill_id, skillId),
          eq(skillRuns.resolved_inputs_hash, resolvedInputsHash),
          eq(skillRuns.status, "running"),
        ),
      );
    if (!existing) {
      return error(
        "concurrent start race: no row inserted, no active match",
        500,
      );
    }
    return json({ runId: existing.id, status: existing.status, deduped: true });
  }

  const runRow = inserted[0];
  const invokeResult = await invokeAgentcoreRunSkill({
    runId: runRow.id,
    tenantId,
    agentId: agentId ?? null,
    invokerUserId,
    skillId,
    skillVersion: runRow.skill_version,
    resolvedInputs,
    invocationSource,
    completionHmacSecret,
  });

  if (!invokeResult.ok) {
    await db
      .update(skillRuns)
      .set({
        status: "failed",
        failure_reason: invokeResult.error.slice(0, 500),
        finished_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(skillRuns.id, runRow.id));
    return error(`skill run invoke failed: ${invokeResult.error}`, 502);
  }

  return json({ runId: runRow.id, status: "running", deduped: false });
}

// ---------------------------------------------------------------------------
// Skill-run complete — terminal-state writeback from the agentcore container.
//
// After the unified dispatcher returns, the container POSTs the terminal state
// here so skill_runs.status transitions out of `running`. Service-auth only
// (Bearer API_AUTH_SECRET); tenant-integrity-checked against the row by id.
// ---------------------------------------------------------------------------

// Transitions permitted from `running`. The skill_runs CHECK constraint
// permits these terminal statuses. `invoker_deprovisioned` + `skipped_disabled`
// are owned by job-trigger, not this endpoint — a container-completion can't
// produce those signals.
const SKILL_RUN_TERMINAL_FROM_RUNNING = new Set([
  "complete",
  "failed",
  "cancelled",
  "cost_bounded_error",
]);

interface CompleteSkillRunBody {
  runId: string;
  tenantId: string;
  status: string;
  failureReason?: string | null;
  deliveredArtifactRef?: unknown;
}

async function completeSkillRunService(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  let body: CompleteSkillRunBody;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return error("Invalid JSON body", 400);
  }

  const { runId, tenantId, status, failureReason, deliveredArtifactRef } = body;

  if (!runId || !tenantId || !status) {
    return error("Missing required fields: runId, tenantId, status", 400);
  }
  if (!SKILL_RUN_TERMINAL_FROM_RUNNING.has(status)) {
    return error(
      `status must be one of ${Array.from(SKILL_RUN_TERMINAL_FROM_RUNNING).join("|")} (got ${status})`,
      400,
    );
  }
  if (status !== "complete" && !failureReason) {
    return error(
      "failureReason is required when status is not 'complete'",
      400,
    );
  }

  const [row] = await db
    .select({
      id: skillRuns.id,
      tenant_id: skillRuns.tenant_id,
      status: skillRuns.status,
      completion_hmac_secret: skillRuns.completion_hmac_secret,
    })
    .from(skillRuns)
    .where(eq(skillRuns.id, runId));
  if (!row) return error("runId not found", 404);
  if (row.tenant_id !== tenantId) {
    return error("tenantId does not match skill_run", 403);
  }

  // Per-run HMAC verification. The secret was generated by
  // startSkillRunService and shipped to the agentcore container in the
  // run_skill envelope. A NULL secret means the row is either already
  // completed (secret burned) or pre-dates the hardening migration — both
  // are terminal from the completion endpoint's perspective. Returning 401
  // here rather than 400 is deliberate: the Python retry helper treats 4xx
  // as terminal and does NOT retry (see _urlopen_with_retry), so a 401
  // ends the callback loop cleanly.
  if (!row.completion_hmac_secret) {
    return unauthorized(
      "completion signature required: run is no longer active",
    );
  }
  if (!verifyCompletionHmac(event, runId, row.completion_hmac_secret)) {
    return unauthorized("invalid completion signature");
  }

  // Only `running` rows are eligible for this writeback. Terminal-to-terminal
  // transitions (e.g. failed → cancelled) aren't something the dispatcher
  // should be producing — reject so we don't silently overwrite prior state.
  // The atomic CAS in the UPDATE (change 5) is the authoritative check;
  // this early return is a fast-path for the common case.
  if (row.status !== "running") {
    return error(`invalid transition: ${row.status} → ${status}`, 400);
  }

  const updates: Record<string, unknown> = {
    status,
    finished_at: new Date(),
    updated_at: new Date(),
    // Burn the secret so a retry (or a leaked runId) cannot forge a
    // second completion. Any subsequent POST with this runId hits the
    // "completion signature required" 401 branch above.
    completion_hmac_secret: null,
  };
  if (failureReason != null) {
    updates.failure_reason = String(failureReason).slice(0, 500);
  }
  if (deliveredArtifactRef !== undefined && deliveredArtifactRef !== null) {
    updates.delivered_artifact_ref = deliveredArtifactRef;
  }

  // Atomic compare-and-swap on status='running'. A concurrent cancel
  // (admin, reconciler, deprovisioner) that flips status between the
  // SELECT above and this UPDATE would be silently clobbered without
  // this predicate. The fast-path 400 above is a best-effort early
  // rejection; this is the authoritative guard.
  const [updated] = await db
    .update(skillRuns)
    .set(updates)
    .where(and(eq(skillRuns.id, runId), eq(skillRuns.status, "running")))
    .returning({
      id: skillRuns.id,
      status: skillRuns.status,
      finished_at: skillRuns.finished_at,
    });
  if (!updated) {
    return error("run no longer in running state", 409);
  }

  return json({
    runId: updated.id,
    status: updated.status,
    finishedAt: updated.finished_at,
  });
}

function verifyCompletionHmac(
  event: APIGatewayProxyEventV2,
  runId: string,
  secret: string,
): boolean {
  const header =
    event.headers["x-skill-run-signature"] ||
    event.headers["X-Skill-Run-Signature"] ||
    "";
  if (!header) return false;
  // Accept either "sha256=<hex>" or a bare hex digest — callers may drop
  // the scheme prefix. Only sha256 is supported.
  const provided = header.startsWith("sha256=") ? header.slice(7) : header;
  if (provided.length % 2 !== 0) return false;
  let providedBuf: Buffer;
  try {
    providedBuf = Buffer.from(provided, "hex");
  } catch {
    return false;
  }
  const expectedHex = createHmac("sha256", secret).update(runId).digest("hex");
  const expectedBuf = Buffer.from(expectedHex, "hex");
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

// Shared helpers — mirror the canonicalization/invoke shape used by the
// GraphQL startSkillRun resolver (packages/api/src/graphql/utils.ts) and by
// job-trigger's inline skill_run branch. Drift would collapse the
// skill_runs dedup partial unique index.

function canonicalizeForHash(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalizeForHash(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalizeForHash(obj[k])}`,
  );
  return `{${entries.join(",")}}`;
}

function hashResolvedInputs(resolvedInputs: Record<string, unknown>): string {
  return createHash("sha256")
    .update(canonicalizeForHash(resolvedInputs))
    .digest("hex");
}

async function invokeAgentcoreRunSkill(payload: {
  runId: string;
  tenantId: string;
  agentId: string | null;
  invokerUserId: string;
  skillId: string;
  skillVersion: number;
  resolvedInputs: Record<string, unknown>;
  invocationSource: string;
  completionHmacSecret: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const fnName = getConfig("AGENTCORE_PI_FUNCTION_NAME");
  if (!fnName)
    return { ok: false, error: "AGENTCORE_PI_FUNCTION_NAME env var not set" };
  try {
    const { LambdaClient, InvokeCommand } =
      await import("@aws-sdk/client-lambda");
    // Plan §U4: kind=run_skill uses InvocationType: Event so the agent
    // loop has the full 900s AgentCore Lambda budget rather than the
    // 28s socket cap RequestResponse required. Execution result comes
    // back via the HMAC-signed /api/skills/complete callback.
    const lambda = new LambdaClient({});
    const envelope = {
      kind: "run_skill" as const,
      runId: payload.runId,
      tenantId: payload.tenantId,
      agentId: payload.agentId,
      invokerUserId: payload.invokerUserId,
      skillId: payload.skillId,
      skillVersion: payload.skillVersion,
      invocationSource: payload.invocationSource,
      resolvedInputs: payload.resolvedInputs,
      // Event invokes can land in AgentCore containers whose env was
      // bootstrapped before deploy-time API vars were injected. Carry the
      // service callback credentials in the envelope so the dispatcher can
      // fetch runtime config and POST /api/skills/complete deterministically.
      thinkworkApiUrl:
        getConfig("THINKWORK_API_URL") || process.env.MCP_BASE_URL || "",
      apiAuthSecret: getApiAuthSecret(),
      // snake_case — the container's dispatch reads tenant_id/user_id/
      // skill_id. See change 4 of the hardening plan.
      scope: {
        tenant_id: payload.tenantId,
        user_id: payload.invokerUserId,
        skill_id: payload.skillId,
      },
      // Per-run HMAC secret the container uses to sign its
      // /api/skills/complete callback. Never put this secret in logs or
      // persist it outside skill_runs.completion_hmac_secret.
      completionHmacSecret: payload.completionHmacSecret,
    };
    const res = await lambda.send(
      new InvokeCommand({
        FunctionName: fnName,
        InvocationType: "Event",
        Payload: new TextEncoder().encode(
          JSON.stringify({
            requestContext: { http: { method: "POST", path: "/invocations" } },
            rawPath: "/invocations",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${getApiAuthSecret()}`,
            },
            body: JSON.stringify(envelope),
            isBase64Encoded: false,
          }),
        ),
      }),
    );
    // Event-type invoke: AWS returns 202 on successful enqueue. Only
    // enqueue-level errors surface here; execution errors arrive via
    // the /api/skills/complete callback writing skill_runs.status.
    if (typeof res.StatusCode === "number" && res.StatusCode >= 400) {
      return {
        ok: false,
        error: `agentcore-invoke Event enqueue returned ${res.StatusCode}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
