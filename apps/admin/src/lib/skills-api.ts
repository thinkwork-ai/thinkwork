import { apiFetch, ApiError } from "@/lib/api-fetch";

// Preserve the legacy external error shape (`new Error(body.error || "HTTP N")`)
// so consumers that string-match on the message keep working. apiFetch already
// surfaces the best-effort error body; we just re-throw as a plain Error.
async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: string;
    extraHeaders?: Record<string, string>;
  } = {},
): Promise<T> {
  try {
    return await apiFetch<T>(path, options);
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      throw new Error(body?.error || `HTTP ${err.status}`);
    }
    throw err;
  }
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

export type CatalogSkillFilter = "all" | "runbooks";

export function isRunbookCatalogSkill(skill: CatalogSkill): boolean {
  return skill.tags.some((tag) => tag.toLowerCase() === "computer-runbook");
}

export function filterCatalogSkills(
  skills: CatalogSkill[],
  filter: CatalogSkillFilter,
): CatalogSkill[] {
  if (filter === "runbooks") return skills.filter(isRunbookCatalogSkill);
  return skills;
}

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
  return request("/api/skills/catalog");
}

export function getCatalogSkill(slug: string): Promise<CatalogSkill> {
  return request(`/api/skills/catalog/${slug}`);
}

export function listCatalogFiles(slug: string): Promise<string[]> {
  return request(`/api/skills/catalog/${slug}/files`);
}

export function getCatalogFile(
  slug: string,
  path: string,
): Promise<{ path: string; content: string }> {
  return request(`/api/skills/catalog/${slug}/files/${path}`);
}

// ---------------------------------------------------------------------------
// Tenant skills (read/write)
// ---------------------------------------------------------------------------

export function listTenantSkills(
  tenantSlug: string,
): Promise<InstalledSkill[]> {
  return request("/api/skills/tenant", {
    extraHeaders: { "x-tenant-slug": tenantSlug },
  });
}

export function installSkill(
  tenantSlug: string,
  slug: string,
): Promise<{ success: boolean; slug: string }> {
  return request(`/api/skills/tenant/${slug}/install`, {
    method: "POST",
    extraHeaders: { "x-tenant-slug": tenantSlug },
  });
}

export function uninstallSkill(
  tenantSlug: string,
  slug: string,
): Promise<{ success: boolean; slug: string }> {
  return request(`/api/skills/tenant/${slug}`, {
    method: "DELETE",
    extraHeaders: { "x-tenant-slug": tenantSlug },
  });
}

export function getTenantFile(
  tenantSlug: string,
  slug: string,
  path: string,
): Promise<{ path: string; content: string }> {
  return request(`/api/skills/tenant/${slug}/files/${path}`, {
    extraHeaders: { "x-tenant-slug": tenantSlug },
  });
}

export function saveTenantFile(
  tenantSlug: string,
  slug: string,
  path: string,
  content: string,
): Promise<{ success: boolean }> {
  return request(`/api/skills/tenant/${slug}/files/${path}`, {
    method: "PUT",
    extraHeaders: { "x-tenant-slug": tenantSlug },
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
  return request(`/api/skills/agent/${agentSlug}/install/${skillSlug}`, {
    method: "POST",
    extraHeaders: { "x-tenant-slug": tenantSlug },
  });
}

export function installSkillToTemplate(
  tenantSlug: string,
  templateSlug: string,
  skillSlug: string,
): Promise<{ success: boolean; slug: string }> {
  return request(`/api/skills/template/${templateSlug}/install/${skillSlug}`, {
    method: "POST",
    extraHeaders: { "x-tenant-slug": tenantSlug },
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
  return request(`/api/skills/agent/${agentId}/${skillId}/credentials`, {
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
  return request("/api/skills/tenant/create", {
    method: "POST",
    extraHeaders: { "x-tenant-slug": tenantSlug },
    body: JSON.stringify(opts),
  });
}

export function getUploadUrl(
  tenantSlug: string,
  slug: string,
): Promise<{ uploadUrl: string; key: string }> {
  return request(`/api/skills/tenant/${slug}/upload`, {
    method: "POST",
    extraHeaders: { "x-tenant-slug": tenantSlug },
  });
}

export function listTenantSkillFiles(
  tenantSlug: string,
  slug: string,
): Promise<string[]> {
  return request(`/api/skills/tenant/${slug}/files`, {
    extraHeaders: { "x-tenant-slug": tenantSlug },
  });
}

export function createTenantFile(
  tenantSlug: string,
  slug: string,
  path: string,
  content: string,
): Promise<{ success: boolean; path: string }> {
  return request(`/api/skills/tenant/${slug}/files/${path}`, {
    method: "POST",
    extraHeaders: { "x-tenant-slug": tenantSlug },
    body: JSON.stringify({ content }),
  });
}

export function deleteTenantFile(
  tenantSlug: string,
  slug: string,
  path: string,
): Promise<{ success: boolean; path: string }> {
  return request(`/api/skills/tenant/${slug}/files/${path}`, {
    method: "DELETE",
    extraHeaders: { "x-tenant-slug": tenantSlug },
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
  return request(`/api/skills/tenant/${slug}/upgradeable`, {
    extraHeaders: { "x-tenant-slug": tenantSlug },
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
  return request(`/api/skills/tenant/${slug}/upgrade${query}`, {
    method: "POST",
    extraHeaders: { "x-tenant-slug": tenantSlug },
  });
}
