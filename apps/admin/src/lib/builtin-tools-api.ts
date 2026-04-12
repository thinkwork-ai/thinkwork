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

export type BuiltinTool = {
  id: string;
  toolSlug: string;
  provider: string | null;
  enabled: boolean;
  config: Record<string, unknown> | null;
  hasSecret: boolean;
  lastTestedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type BuiltinToolInput = {
  provider?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  apiKey?: string;
};

export type BuiltinToolTestResult = {
  ok: boolean;
  provider?: string;
  resultCount?: number;
  error?: string;
};

export function listBuiltinTools(
  tenantSlug: string,
): Promise<{ tools: BuiltinTool[] }> {
  return apiFetch("/api/skills/builtin-tools", {
    headers: { "x-tenant-slug": tenantSlug },
  });
}

export function upsertBuiltinTool(
  tenantSlug: string,
  slug: string,
  input: BuiltinToolInput,
): Promise<{ id: string; toolSlug: string; created?: boolean; updated?: boolean }> {
  return apiFetch(`/api/skills/builtin-tools/${slug}`, {
    method: "PUT",
    headers: { "x-tenant-slug": tenantSlug },
    body: JSON.stringify(input),
  });
}

export function deleteBuiltinTool(
  tenantSlug: string,
  slug: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/skills/builtin-tools/${slug}`, {
    method: "DELETE",
    headers: { "x-tenant-slug": tenantSlug },
  });
}

export function testBuiltinTool(
  tenantSlug: string,
  slug: string,
  body: { provider?: string; apiKey?: string } = {},
): Promise<BuiltinToolTestResult> {
  return apiFetch(`/api/skills/builtin-tools/${slug}/test`, {
    method: "POST",
    headers: { "x-tenant-slug": tenantSlug },
    body: JSON.stringify(body),
  });
}
