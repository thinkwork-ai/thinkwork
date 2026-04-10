const API_BASE = (
  process.env.EXPO_PUBLIC_GRAPHQL_URL ?? ""
).replace(/\/graphql$/, "");

const AUTH_TOKEN = process.env.EXPO_PUBLIC_MCP_AUTH_TOKEN ?? "";

async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
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
};

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export function listCatalog(): Promise<CatalogSkill[]> {
  return apiFetch("/api/skills/catalog");
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
// OAuth URL builder
// ---------------------------------------------------------------------------

export function buildOAuthUrl(params: {
  provider: string;
  scopes: string[];
  userId: string;
  tenantId: string;
  agentId: string;
  skillId: string;
  returnUrl?: string;
}): string {
  const qs = new URLSearchParams({
    provider: params.provider,
    scopes: params.scopes.join(","),
    userId: params.userId,
    tenantId: params.tenantId,
    agentId: params.agentId,
    skillId: params.skillId,
    ...(params.returnUrl ? { returnUrl: params.returnUrl } : {}),
  });
  return `${API_BASE}/api/oauth/authorize?${qs.toString()}`;
}
