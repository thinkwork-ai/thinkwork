import { apiFetch, ApiError } from "@/lib/api-fetch";

// Client for the built-in tools REST surface. Spaces Settings is the primary
// operator surface for credentialed built-ins.

export type BuiltinTool = {
  id: string;
  toolSlug: string;
  provider: string | null;
  enabled: boolean;
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

export function upsertBuiltinTool(
  tenantSlug: string,
  slug: string,
  input: BuiltinToolInput,
): Promise<{
  id: string;
  toolSlug: string;
  created?: boolean;
  updated?: boolean;
}> {
  return request(`/api/skills/builtin-tools/${slug}`, {
    method: "PUT",
    tenantSlug,
    body: JSON.stringify(input),
  });
}

export function deleteBuiltinTool(
  tenantSlug: string,
  slug: string,
): Promise<{ ok: boolean }> {
  return request(`/api/skills/builtin-tools/${slug}`, {
    method: "DELETE",
    tenantSlug,
  });
}

export function testBuiltinTool(
  tenantSlug: string,
  slug: string,
  body: { provider?: string; apiKey?: string } = {},
): Promise<BuiltinToolTestResult> {
  return request(`/api/skills/builtin-tools/${slug}/test`, {
    method: "POST",
    tenantSlug,
    body: JSON.stringify(body),
  });
}
