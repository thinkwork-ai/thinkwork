import { apiFetch, ApiError } from "@/lib/api-fetch";

// Minimal client for the built-in tools REST surface (same endpoints admin
// uses). Spaces Settings exposes list + enable/disable; key-config and test
// flows remain admin-only for now.

export type BuiltinTool = {
  id: string;
  toolSlug: string;
  provider: string | null;
  enabled: boolean;
  hasSecret: boolean;
  updatedAt?: string;
};

async function request<T>(
  path: string,
  options: { method?: string; body?: string; tenantSlug: string },
): Promise<T> {
  const { tenantSlug, ...rest } = options;
  try {
    return await apiFetch<T>(path, {
      ...rest,
      extraHeaders: { "x-tenant-slug": tenantSlug },
    });
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      throw new Error(body?.error || `HTTP ${err.status}`);
    }
    throw err;
  }
}

export function listBuiltinTools(
  tenantSlug: string,
): Promise<{ tools: BuiltinTool[] }> {
  return request("/api/skills/builtin-tools", { tenantSlug });
}

export function setBuiltinToolEnabled(
  tenantSlug: string,
  slug: string,
  enabled: boolean,
): Promise<unknown> {
  return request(`/api/skills/builtin-tools/${slug}`, {
    method: "PUT",
    tenantSlug,
    body: JSON.stringify({ enabled }),
  });
}
