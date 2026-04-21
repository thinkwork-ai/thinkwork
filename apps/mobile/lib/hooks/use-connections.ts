import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/lib/auth-context";
import { useMe } from "@/lib/hooks/use-users";

/**
 * Shared hook for the tenant's connection rows, served by the REST
 * `/api/connections` endpoint.
 *
 * A module-level cache fans out updates to every mounted hook instance via
 * a small listener set, so refetching in one screen is immediately visible
 * in any other screen reading the same data.
 */

const API_BASE = (process.env.EXPO_PUBLIC_GRAPHQL_URL ?? "").replace(/\/graphql$/, "");
const GRAPHQL_API_KEY = process.env.EXPO_PUBLIC_GRAPHQL_API_KEY || "";

export type ConnectionRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  provider_id: string;
  status: string;
  external_id: string | null;
  metadata: Record<string, unknown> | null;
  connected_at: string | null;
  provider_name: string;
  provider_display_name: string;
  /**
   * The provider catalog's `provider_type` — the "kind" of provider, e.g.
   * `"email"` for Gmail, `"calendar"` for Google Calendar, etc. Surfaced
   * by the server join in `/api/connections`.
   */
  provider_type: string;
};

// ── Module-level cache ────────────────────────────────────────────────────
type CacheState = {
  connections: ConnectionRow[] | null;
  loading: boolean;
  error: string | null;
  scopeKey: string | null; // `${tenantId}:${userId}` — invalidate on user switch
};

const cache: CacheState = {
  connections: null,
  loading: false,
  error: null,
  scopeKey: null,
};
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

async function fetchNow(tenantId: string, userId: string): Promise<void> {
  const scopeKey = `${tenantId}:${userId}`;
  // Dedupe simultaneous callers: return the in-flight promise instead of
  // spawning a second request. Callers that want to *force* a refetch
  // should be on different screens (useFocusEffect fires per-screen) and
  // will typically not overlap.
  if (inflight) return inflight;
  cache.loading = true;
  cache.error = null;
  emit();
  const p = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/connections`, {
        headers: {
          "x-api-key": GRAPHQL_API_KEY,
          "x-tenant-id": tenantId,
          "x-principal-id": userId,
        },
      });
      if (!res.ok) {
        throw new Error(`GET /api/connections failed: ${res.status}`);
      }
      const data = (await res.json()) as ConnectionRow[];
      console.log(`[useConnections] fetched ${data.length} rows for user=${userId.slice(0,8)} tenant=${tenantId.slice(0,8)}; statuses=${data.map(d=>d.status).join(",")}`);
      cache.connections = data;
      cache.scopeKey = scopeKey;
      cache.error = null;
    } catch (err) {
      console.error("[useConnections] fetch failed:", err);
      cache.error = err instanceof Error ? err.message : String(err);
    } finally {
      cache.loading = false;
      if (inflight === p) inflight = null;
      emit();
    }
  })();
  inflight = p;
  return p;
}

/**
 * Reset the cache. Useful after sign-out or an explicit "forget everything"
 * event. Currently unused but exported so auth-context can call it later
 * without reaching into module state.
 */
export function resetConnectionsCache() {
  cache.connections = null;
  cache.loading = false;
  cache.error = null;
  cache.scopeKey = null;
  inflight = null;
  emit();
}

export function useConnections() {
  const { user: authUser } = useAuth();
  const [meResult] = useMe();
  const meUser = meResult.data?.me;

  // tenant id + user id — same derivation the two existing screens use. We
  // prefer meUser.id over authUser.sub because other screens (integrations,
  // inbox handlers) already pass `me.id` as the principal; mixing the two
  // would split the cache.
  const tenantId = meUser?.tenantId ?? authUser?.tenantId;
  const userId = meUser?.id;

  const [, forceRender] = useState(0);
  useEffect(() => {
    const listener = () => forceRender((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  // Kick the initial fetch (and refetch when the scope changes, e.g. after
  // sign-in). Skip while we don't have both ids yet.
  useEffect(() => {
    if (!tenantId || !userId) return;
    const scopeKey = `${tenantId}:${userId}`;
    if (cache.scopeKey !== scopeKey) {
      // Scope changed — invalidate stale data so we don't flash the wrong
      // tenant's connectors to the user.
      cache.connections = null;
      cache.scopeKey = null;
    }
    if (cache.connections === null && !inflight) {
      void fetchNow(tenantId, userId);
    }
  }, [tenantId, userId]);

  // Explicit refetch — used after local mutations (PUT metadata, DELETE
  // connection). We don't clear the cache here: the old data stays visible
  // during the request, and gets replaced when the new data lands. The
  // caller awaits the promise so it can sequence follow-up UI work.
  const refetch = useCallback(async () => {
    if (!tenantId || !userId) return;
    // If a fetch is already running, wait for that one instead of piling
    // up a duplicate request. Most post-mutation refetches benefit from
    // the dedupe and those that really need a fresh GET (e.g., right after
    // a PUT) are rare enough that the extra wait is acceptable.
    if (inflight) {
      await inflight;
      return;
    }
    await fetchNow(tenantId, userId);
  }, [tenantId, userId]);

  // Refetch every time a screen using this hook gains focus. This is the
  // escape hatch for OAuth round-trips: the user kicks off provider auth,
  // comes back to Integrations, and we revalidate against the server
  // instead of showing the pre-OAuth cache. We intentionally do *not*
  // clear the cache — the stale view stays visible for the couple of
  // hundred ms the GET takes, then gets replaced, avoiding a loading
  // flash on every tab switch.
  useFocusEffect(
    useCallback(() => {
      if (!tenantId || !userId) return;
      void fetchNow(tenantId, userId);
    }, [tenantId, userId]),
  );

  const connections = cache.connections;
  const loading = cache.loading || (connections === null && !!tenantId && !!userId);
  const error = cache.error;

  return {
    connections,
    loading,
    error,
    refetch,
  };
}
