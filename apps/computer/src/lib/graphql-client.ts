import { Client, cacheExchange, fetchExchange } from "@urql/core";

// HTTP endpoint for queries/mutations (API Gateway). apps/computer Phase 1
// is HTTP-only — the AppSync subscription exchange that admin's client
// carries is intentionally absent here. Realtime lands in a future slice
// when the chat UI is real.
const GRAPHQL_HTTP_URL = import.meta.env.VITE_GRAPHQL_HTTP_URL || "";
const GRAPHQL_API_KEY = import.meta.env.VITE_GRAPHQL_API_KEY || "";

// Token provider — called on every request so Cognito can refresh expired tokens.
// AuthContext sets this to auth.getIdToken after sign-in.
let tokenProvider: (() => Promise<string | null>) | null = null;
let cachedToken: string | null = null;
let currentTenantId: string | null = null;

export function setAuthToken(token: string | null) {
  cachedToken = token;
}

export function setGraphqlTenantId(tenantId: string | null) {
  currentTenantId = tenantId;
}

export function setTokenProvider(provider: (() => Promise<string | null>) | null) {
  tokenProvider = provider;
}

// Eagerly refresh the cached token in the background so fetchOptions
// (which must be synchronous) always has a fresh value.
let refreshTimer: ReturnType<typeof setInterval> | null = null;

export function startTokenRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(async () => {
    if (!tokenProvider) return;
    try {
      const fresh = await tokenProvider();
      if (fresh) cachedToken = fresh;
    } catch { /* best-effort */ }
  }, 5 * 60 * 1000); // every 5 minutes
}

export function stopTokenRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (currentTenantId) {
    headers["x-tenant-id"] = currentTenantId;
  }
  if (GRAPHQL_API_KEY) {
    headers["x-api-key"] = GRAPHQL_API_KEY;
  }
  if (cachedToken && !isExpiredJwt(cachedToken)) {
    headers.Authorization = cachedToken;
    return headers;
  }
  return headers;
}

function isExpiredJwt(token: string): boolean {
  const [, payload] = token.split(".");
  if (!payload) return false;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(padded)) as { exp?: number };
    return typeof decoded.exp === "number" && decoded.exp * 1000 <= Date.now() + 30_000;
  } catch {
    return false;
  }
}

export const graphqlClient = new Client({
  url: GRAPHQL_HTTP_URL || "https://placeholder.api.us-east-1.amazonaws.com/graphql",
  exchanges: [cacheExchange, fetchExchange],
  fetchOptions: (): RequestInit => ({
    method: "POST",
    headers: authHeaders(),
  }),
  preferGetMethod: false,
});
