import { apiFetch, ApiError } from "@/lib/api-fetch";

// Minimal Brain API keys client (packages/api brain-api-keys handler).
// `tkt_` bearer keys for the platform Company Brain MCP server; the raw
// token is returned exactly once, on create.

export type BrainApiKey = {
  id: string;
  name: string;
  /** Last 8 chars of the raw key; null on older rows minted before suffix storage. */
  key_suffix: string | null;
  created_at: string;
  expires_at: string | null;
  created_by_user_id: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
};

export type CreatedBrainApiKey = {
  id: string;
  name: string;
  /** The raw `tkt_…` bearer — shown ONLY in this response, never again. */
  token: string;
  key_suffix: string;
  created_at: string;
  expires_at: string | null;
  keyManifest?: unknown;
};

async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: string;
    tenantSlug: string;
  },
): Promise<T> {
  const { tenantSlug, ...rest } = options;
  try {
    return await apiFetch<T>(path, {
      ...rest,
      extraHeaders: tenantSlug ? { "x-tenant-slug": tenantSlug } : {},
    });
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      throw new Error(body?.error || `HTTP ${err.status}`);
    }
    throw err;
  }
}

export function listBrainApiKeys(
  tenantSlug: string,
): Promise<{ keys: BrainApiKey[] }> {
  return request(`/api/tenants/${tenantSlug}/brain-api-keys`, { tenantSlug });
}

export function createBrainApiKey(
  tenantSlug: string,
  payload: { name: string; expiresInDays?: number },
): Promise<CreatedBrainApiKey> {
  return request(`/api/tenants/${tenantSlug}/brain-api-keys`, {
    method: "POST",
    tenantSlug,
    body: JSON.stringify(payload),
  });
}

export function revokeBrainApiKey(
  tenantSlug: string,
  keyId: string,
): Promise<{ keyManifest?: unknown }> {
  return request(`/api/tenants/${tenantSlug}/brain-api-keys/${keyId}`, {
    method: "DELETE",
    tenantSlug,
  });
}
