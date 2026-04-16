import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useMe } from "@/lib/hooks/use-users";
import type { Workflow } from "@/components/input/WorkflowPickerSheet";

const API_BASE = (process.env.EXPO_PUBLIC_GRAPHQL_URL ?? "").replace(/\/graphql$/, "");
const GRAPHQL_API_KEY = process.env.EXPO_PUBLIC_GRAPHQL_API_KEY || "";

/**
 * Fetches available LastMile workflows for the current user's task
 * connector. Hits `GET /api/connections/lastmile/workflows` which proxies
 * to the LastMile REST API using the user's OAuth token.
 *
 * Returns `{ workflows, loading, error, refetch }`. Fetch fires on first
 * mount; `refetch()` is called from the picker sheet on present so the
 * list stays fresh across opens.
 */
export function useLastmileWorkflows() {
  const { user: authUser } = useAuth();
  const [meResult] = useMe();
  const meUser = meResult.data?.me;
  const tenantId = meUser?.tenantId ?? authUser?.tenantId;
  const userId = meUser?.id;

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);

  const fetchWorkflows = useCallback(async () => {
    if (!tenantId || !userId) return;
    setLoading(true);
    setError(null);
    setNeedsReconnect(false);
    try {
      const res = await fetch(`${API_BASE}/api/connections/lastmile/workflows`, {
        headers: {
          "x-api-key": GRAPHQL_API_KEY,
          "x-tenant-id": tenantId,
          "x-principal-id": userId,
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // Backend signals an auth-level failure (missing token, LastMile
        // returned 401) with `error: "reconnect_needed"`. Distinguish from
        // transient / generic errors so the UI can prompt reconnect.
        if (res.status === 401 && body?.error === "reconnect_needed") {
          setNeedsReconnect(true);
          setError(
            body?.detail ||
              "LastMile connection needs to be refreshed — reconnect in Settings → MCP Servers.",
          );
          return;
        }
        throw new Error(body?.detail || body?.error || body?.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setWorkflows(Array.isArray(data) ? data : data?.data ?? []);
    } catch (err) {
      console.error("[useLastmileWorkflows] fetch failed:", err);
      setError((err as Error)?.message || "Failed to load workflows");
    } finally {
      setLoading(false);
    }
  }, [tenantId, userId]);

  useEffect(() => {
    void fetchWorkflows();
  }, [fetchWorkflows]);

  return { workflows, loading, error, needsReconnect, refetch: fetchWorkflows };
}
