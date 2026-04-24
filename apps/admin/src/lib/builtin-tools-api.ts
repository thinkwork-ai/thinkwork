import { apiFetch, ApiError } from "@/lib/api-fetch";

// Preserve the legacy external error shape (`new Error(body.error || "HTTP N")`)
// so consumers that string-match on the message keep working.
async function request<T>(
  path: string,
  options: { method?: string; body?: string; extraHeaders?: Record<string, string> } = {},
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
  return request("/api/skills/builtin-tools", {
    extraHeaders: { "x-tenant-slug": tenantSlug },
  });
}

export function upsertBuiltinTool(
  tenantSlug: string,
  slug: string,
  input: BuiltinToolInput,
): Promise<{ id: string; toolSlug: string; created?: boolean; updated?: boolean }> {
  return request(`/api/skills/builtin-tools/${slug}`, {
    method: "PUT",
    extraHeaders: { "x-tenant-slug": tenantSlug },
    body: JSON.stringify(input),
  });
}

export function deleteBuiltinTool(
  tenantSlug: string,
  slug: string,
): Promise<{ ok: boolean }> {
  return request(`/api/skills/builtin-tools/${slug}`, {
    method: "DELETE",
    extraHeaders: { "x-tenant-slug": tenantSlug },
  });
}

export function testBuiltinTool(
  tenantSlug: string,
  slug: string,
  body: { provider?: string; apiKey?: string } = {},
): Promise<BuiltinToolTestResult> {
  return request(`/api/skills/builtin-tools/${slug}/test`, {
    method: "POST",
    extraHeaders: { "x-tenant-slug": tenantSlug },
    body: JSON.stringify(body),
  });
}
