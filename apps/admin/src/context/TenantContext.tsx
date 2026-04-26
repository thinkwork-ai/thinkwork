import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { useAuth } from "@/context/AuthContext";
import { apiFetch, NotReadyError } from "@/lib/api-fetch";
import { setGraphqlTenantId } from "@/lib/graphql-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan?: string;
  logoUrl?: string;
}

interface TenantContextValue {
  tenant: Tenant | null;
  tenantId: string | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const TenantContext = createContext<TenantContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const API_URL = import.meta.env.VITE_API_URL || "";
const GRAPHQL_URL = import.meta.env.VITE_GRAPHQL_HTTP_URL || `${API_URL}/graphql`;

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, getToken } = useAuth();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumps to retry when apiFetch throws NotReadyError — the Cognito session
  // may be hydrated into AuthContext before the token cache is populated, and
  // AuthProvider wraps us so tenantId arrives before getIdToken() returns a
  // value. Rather than restructuring the provider tree, tolerate the race.
  const [authRetryTick, setAuthRetryTick] = useState(0);
  const bootstrapAttempted = useRef(false);

  const tenantId = user?.tenantId ?? null;

  useEffect(() => {
    setGraphqlTenantId(tenantId || tenant?.id || null);
    return () => setGraphqlTenantId(null);
  }, [tenantId, tenant?.id]);

  async function fetchTenant() {
    if (!tenantId || !API_URL) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await apiFetch<any>(`/api/tenants/${tenantId}`, {
        extraHeaders: { "x-tenant-id": tenantId },
      });
      setTenant({
        id: data.id,
        name: data.name,
        slug: data.slug ?? data.name?.toLowerCase().replace(/\s+/g, "-"),
        plan: data.plan,
        logoUrl: data.logo_url,
      });
      setIsLoading(false);
    } catch (err) {
      if (err instanceof NotReadyError) {
        // Auth hasn't hydrated yet — don't surface this as a fatal error;
        // keep tenant null, stay in loading, and retry shortly. The effect
        // re-runs when authRetryTick bumps.
        setTimeout(() => setAuthRetryTick((n) => n + 1), 100);
        return;
      }
      console.error("TenantContext fetch error:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
      setIsLoading(false);
    }
  }

  /**
   * Auto-bootstrap: when authenticated but no tenantId in token,
   * call the bootstrapUser mutation to auto-provision tenant + user,
   * then refresh the Cognito session to pick up the new custom:tenant_id.
   */
  async function autoBootstrap() {
    if (bootstrapAttempted.current) return;
    bootstrapAttempted.current = true;

    try {
      setIsLoading(true);
      const token = await getToken();
      if (!token) return;

      console.log("[TenantContext] No tenantId — calling bootstrapUser...");

      const res = await fetch(GRAPHQL_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: `mutation { bootstrapUser { user { id email name } tenant { id name slug plan } isNew } }`,
        }),
      });

      const result = await res.json();
      const bootstrap = result?.data?.bootstrapUser;

      if (bootstrap?.tenant) {
        console.log("[TenantContext] Bootstrap complete:", bootstrap.tenant.name);
        setTenant({
          id: bootstrap.tenant.id,
          name: bootstrap.tenant.name,
          slug: bootstrap.tenant.slug,
          plan: bootstrap.tenant.plan,
        });

        // Note: the Cognito session will pick up custom:tenant_id on next sign-in.
        // For now, we use the tenant from the bootstrap response directly.
      } else {
        console.error("[TenantContext] Bootstrap failed:", result?.errors);
        setError("Failed to create workspace");
      }
    } catch (err) {
      console.error("[TenantContext] Bootstrap error:", err);
      setError(err instanceof Error ? err.message : "Bootstrap failed");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (isAuthenticated && tenantId) {
      fetchTenant();
    } else if (isAuthenticated && !tenantId) {
      // New user — no tenant yet. Auto-bootstrap.
      autoBootstrap();
    } else {
      setTenant(null);
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, tenantId, authRetryTick]);

  return (
    <TenantContext.Provider
      value={{
        tenant,
        tenantId: tenantId || tenant?.id || null,
        isLoading,
        error,
        refetch: fetchTenant,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx)
    throw new Error("useTenant must be used within a TenantProvider");
  return ctx;
}
