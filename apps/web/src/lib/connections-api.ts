import { apiFetch, ApiError } from "@/lib/api-fetch";
import { readRuntimeEnv } from "@/lib/runtime-config";

/**
 * Per-user OAuth connections client — the same REST surface mobile's
 * Credential Locker uses (`GET /api/connections`, `DELETE /api/connections/:id`,
 * `GET /api/oauth/authorize`). Web authenticates with the Cognito id-token
 * bearer via `apiFetch` instead of mobile's bundled x-api-key.
 */

export type ConnectionRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  provider_id: string;
  /** active | expired | pending | inactive */
  status: string;
  external_id: string | null;
  metadata: Record<string, unknown> | null;
  connected_at: string | null;
  provider_name: string;
  provider_display_name: string;
  /** Provider catalog `provider_type` (email, calendar, …). */
  provider_type: string;
};

async function request<T>(
  path: string,
  options: {
    method?: string;
    tenantId: string;
    userId?: string;
  },
): Promise<T> {
  const { tenantId, userId, ...rest } = options;
  try {
    return await apiFetch<T>(path, {
      ...rest,
      extraHeaders: {
        "x-tenant-id": tenantId,
        ...(userId ? { "x-principal-id": userId } : {}),
      },
    });
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      throw new Error(body?.error || `HTTP ${err.status}`);
    }
    throw err;
  }
}

/** The caller's connection rows (server joins in the provider catalog). */
export function listConnections(
  tenantId: string,
  userId: string,
): Promise<ConnectionRow[]> {
  return request("/api/connections", { tenantId, userId });
}

/** Soft-delete a connection (status → inactive, secrets + credentials purged). */
export function disconnectConnection(
  tenantId: string,
  connectionId: string,
): Promise<{ ok: boolean; id: string }> {
  return request(`/api/connections/${connectionId}`, {
    method: "DELETE",
    tenantId,
  });
}

/**
 * Build the `/api/oauth/authorize` URL that starts the provider consent flow.
 * The handler 302s to the provider; after consent, `oauth-callback` redirects
 * to `returnUrl` with `?status=connected&provider=…` (or `status=error`
 * `&reason=…`) appended — the same deep-link contract mobile relies on.
 */
export function buildConnectAuthorizeUrl({
  provider,
  userId,
  tenantId,
  returnUrl,
}: {
  provider: string;
  userId: string;
  tenantId: string;
  returnUrl: string;
}): string {
  const baseUrl =
    readRuntimeEnv("VITE_API_URL") ||
    (typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost");
  const url = new URL("/api/oauth/authorize", baseUrl);
  url.searchParams.set("provider", provider);
  url.searchParams.set("userId", userId);
  url.searchParams.set("tenantId", tenantId);
  url.searchParams.set("returnUrl", returnUrl);
  return url.toString();
}
