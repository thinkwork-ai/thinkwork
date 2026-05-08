import {
  createContext,
  useContext,
  useEffect,
  useState,
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
  /**
   * True when the signed-in user has no `custom:tenant_id` claim AND no tenant
   * was fetched. apps/computer (the end-user surface) deliberately does NOT
   * call admin's `bootstrapUser` mutation here — auto-provisioning a tenant
   * for an end user would silently promote them to operator of a fresh empty
   * tenant. Instead, the shell renders a "contact your operator" surface and
   * the user is gated out of the actual product.
   *
   * See ce-doc-review ADV-9 on PR #959 for the full reasoning.
   */
  noTenantAssigned: boolean;
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

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noTenantAssigned, setNoTenantAssigned] = useState(false);
  // Bumps to retry when apiFetch throws NotReadyError — the Cognito session
  // may be hydrated into AuthContext before the token cache is populated, and
  // AuthProvider wraps us so tenantId arrives before getIdToken() returns a
  // value. Rather than restructuring the provider tree, tolerate the race.
  const [authRetryTick, setAuthRetryTick] = useState(0);

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
    setNoTenantAssigned(false);

    try {
      const data = await apiFetch<{
        id: string;
        name: string;
        slug?: string;
        plan?: string;
        logo_url?: string;
      }>(`/api/tenants/${tenantId}`, {
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
      console.error("[apps/computer TenantContext] fetch error:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (isAuthenticated && tenantId) {
      fetchTenant();
    } else if (isAuthenticated && !tenantId) {
      // End-user surface: do NOT call bootstrapUser. Auto-promoting a user
      // to tenant operator of a fresh tenant on apps/computer is exactly
      // the privilege-escalation pattern flagged by ADV-9 (#959 review).
      // Surface "no tenant assigned" instead so the shell renders a
      // "contact your operator" page and the user is gated out of the app.
      setTenant(null);
      setNoTenantAssigned(true);
      setIsLoading(false);
    } else {
      setTenant(null);
      setNoTenantAssigned(false);
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
        noTenantAssigned,
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
