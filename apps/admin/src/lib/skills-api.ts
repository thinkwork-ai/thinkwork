const API_URL = import.meta.env.VITE_API_URL || "";
const API_AUTH_SECRET = import.meta.env.VITE_API_AUTH_SECRET || "";

async function apiFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(API_AUTH_SECRET ? { Authorization: `Bearer ${API_AUTH_SECRET}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CatalogSkill = {
  slug: string;
  name: string;
  description: string;
  category: string;
  version: string;
  author: string;
  icon: string;
  tags: string[];
  requires_env: string[];
  env_defaults?: Record<string, string>;
  oauth_provider?: string;
  oauth_scopes?: string[];
  mcp_server?: string;
  // PRD-31 additions
  execution?: "script" | "mcp" | "context";
  is_default?: boolean;
  mcp_tools?: string[];
  dependencies?: string[];
  triggers?: string[];
  // Permissions UI (Unit 4 of agent-skill permissions plan). Present
  // when the manifest declares `permissions_model: operations` AND the
  // REST endpoint returns the full parsed YAML — specifically
  // `getCatalogSkill(slug)`. The list endpoint `listCatalog()` omits
  // these fields for payload size.
  permissions_model?: "operations";
  scripts?: Array<{
    name: string;
    path: string;
    description?: string;
    default_enabled?: boolean;
  }>;
};

export type InstalledSkill = {
  slug: string;
  name: string;
  description: string;
  category: string;
  version: string;
  icon: string;
  installedAt: string;
  // PRD-31 additions
  source?: "builtin" | "catalog" | "tenant";
  execution?: "script" | "mcp" | "context";
  is_default?: boolean;
  catalogVersion?: string;
  oauthProvider?: string;
  mcpServer?: string;
  triggers?: string[];
};

// ---------------------------------------------------------------------------
// Catalog (read-only)
// ---------------------------------------------------------------------------

export function listCatalog(): Promise<CatalogSkill[]> {
  return apiFetch("/api/skills/catalog");
}

export function getCatalogSkill(slug: string): Promise<CatalogSkill> {
  return apiFetch(`/api/skills/catalog/${slug}`);
}

export function listCatalogFiles(slug: string): Promise<string[]> {
  return apiFetch(`/api/skills/catalog/${slug}/files`);
}

export function getCatalogFile(
  slug: string,
  path: string,
): Promise<{ path: string; content: string }> {
  return apiFetch(`/api/skills/catalog/${slug}/files/${path}`);
}

// ---------------------------------------------------------------------------
// Tenant skills (read/write)
// ---------------------------------------------------------------------------

export function listTenantSkills(
  tenantSlug: string,
): Promise<InstalledSkill[]> {
  return apiFetch("/api/skills/tenant", {
    headers: { "x-tenant-slug": tenantSlug },
  });
}

export function installSkill(
  tenantSlug: string,
  slug: string,
): Promise<{ success: boolean; slug: string }> {
  return apiFetch(`/api/skills/tenant/${slug}/install`, {
    method: "POST",
    headers: { "x-tenant-slug": tenantSlug },
  });
}

export function uninstallSkill(
  tenantSlug: string,
  slug: string,
): Promise<{ success: boolean; slug: string }> {
  return apiFetch(`/api/skills/tenant/${slug}`, {
    method: "DELETE",
    headers: { "x-tenant-slug": tenantSlug },
  });
}

export function getTenantFile(
  tenantSlug: string,
  slug: string,
  path: string,
): Promise<{ path: string; content: string }> {
  return apiFetch(`/api/skills/tenant/${slug}/files/${path}`, {
    headers: { "x-tenant-slug": tenantSlug },
  });
}

export function saveTenantFile(
  tenantSlug: string,
  slug: string,
  path: string,
  content: string,
): Promise<{ success: boolean }> {
  return apiFetch(`/api/skills/tenant/${slug}/files/${path}`, {
    method: "PUT",
    headers: { "x-tenant-slug": tenantSlug },
    body: JSON.stringify({ content }),
  });
}

// ---------------------------------------------------------------------------
// Agent-level skill install
// ---------------------------------------------------------------------------

export function installSkillToAgent(
  tenantSlug: string,
  agentSlug: string,
  skillSlug: string,
): Promise<{ success: boolean; slug: string }> {
  return apiFetch(`/api/skills/agent/${agentSlug}/install/${skillSlug}`, {
    method: "POST",
    headers: { "x-tenant-slug": tenantSlug },
  });
}

// ---------------------------------------------------------------------------
// Agent skill credentials
// ---------------------------------------------------------------------------

export function saveSkillCredentials(
  agentId: string,
  skillId: string,
  env: Record<string, string>,
): Promise<{ ok: boolean; secretRef: string }> {
  return apiFetch(`/api/skills/agent/${agentId}/${skillId}/credentials`, {
    method: "POST",
    body: JSON.stringify({ env }),
  });
}

// ---------------------------------------------------------------------------
// PRD-31 Phase 3: Tenant custom skill management
// ---------------------------------------------------------------------------

export function createTenantSkill(
  tenantSlug: string,
  opts: { name: string; slug?: string; description?: string },
): Promise<{ success: boolean; slug: string; files: string[] }> {
  return apiFetch("/api/skills/tenant/create", {
    method: "POST",
    headers: { "x-tenant-slug": tenantSlug },
    body: JSON.stringify(opts),
  });
}

export function getUploadUrl(
  tenantSlug: string,
  slug: string,
): Promise<{ uploadUrl: string; key: string }> {
  return apiFetch(`/api/skills/tenant/${slug}/upload`, {
    method: "POST",
    headers: { "x-tenant-slug": tenantSlug },
  });
}

export function listTenantSkillFiles(
  tenantSlug: string,
  slug: string,
): Promise<string[]> {
  return apiFetch(`/api/skills/tenant/${slug}/files`, {
    headers: { "x-tenant-slug": tenantSlug },
  });
}

export function createTenantFile(
  tenantSlug: string,
  slug: string,
  path: string,
  content: string,
): Promise<{ success: boolean; path: string }> {
  return apiFetch(`/api/skills/tenant/${slug}/files/${path}`, {
    method: "POST",
    headers: { "x-tenant-slug": tenantSlug },
    body: JSON.stringify({ content }),
  });
}

export function deleteTenantFile(
  tenantSlug: string,
  slug: string,
  path: string,
): Promise<{ success: boolean; path: string }> {
  return apiFetch(`/api/skills/tenant/${slug}/files/${path}`, {
    method: "DELETE",
    headers: { "x-tenant-slug": tenantSlug },
  });
}

// ---------------------------------------------------------------------------
// PRD-31: Version checking
// ---------------------------------------------------------------------------

export function checkUpgradeable(
  tenantSlug: string,
  slug: string,
): Promise<{
  upgradeable: boolean;
  currentVersion: string;
  latestVersion: string;
}> {
  return apiFetch(`/api/skills/tenant/${slug}/upgradeable`, {
    headers: { "x-tenant-slug": tenantSlug },
  });
}

export function upgradeSkill(
  tenantSlug: string,
  slug: string,
  force?: boolean,
): Promise<{
  upgraded?: boolean;
  hasCustomizations?: boolean;
  currentVersion?: string;
  latestVersion?: string;
  customizedFiles?: string[];
  previousVersion?: string;
  newVersion?: string;
}> {
  const query = force ? "?force=true" : "";
  return apiFetch(`/api/skills/tenant/${slug}/upgrade${query}`, {
    method: "POST",
    headers: { "x-tenant-slug": tenantSlug },
  });
}

