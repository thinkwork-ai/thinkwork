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
  userId: string | null;
  isLoading: boolean;
  error: string | null;
  /**
   * True when the signed-in user has no `custom:tenant_id` claim AND the
   * tenant-discovery fallback found no membership either. apps/spaces
   * (the end-user surface) deliberately does NOT call
   * admin's `bootstrapUser` mutation here — auto-provisioning a tenant for
   * an end user would silently promote them to operator of a fresh empty
   * tenant. Instead, the shell renders a "contact your operator" surface
   * and the user is gated out of the actual product.
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

/**
 * Tenant-discovery fallback for Google-federated users. Cognito JWTs from
 * Google OAuth do not carry `custom:tenant_id` until the pre-token Lambda
 * trigger lands; admin papers over this with `bootstrapUser` (which would
 * auto-promote the user to operator of a new tenant). apps/spaces
 * suppresses that path, so existing-tenant Google users would otherwise be
 * locked out. Solution: ask `/api/auth/me` for the caller's DB-backed tenant
 * membership. No tenant provisioning happens in this path; we only read.
 */
async function discoverCallerViaAuthMe(): Promise<{
  tenantId: string | null;
  userId: string | null;
}> {
  const empty = { tenantId: null, userId: null };
  if (!API_URL) return empty;
  try {
    const data = await apiFetch<{
      tenantId?: string | null;
      userId?: string | null;
    }>("/api/auth/me");
    return {
      tenantId: data.tenantId ?? null,
      userId: data.userId ?? null,
    };
  } catch (err) {
    if (err instanceof NotReadyError) throw err;
    return empty;
  }
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, getToken } = useAuth();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noTenantAssigned, setNoTenantAssigned] = useState(false);
  const [discoveredTenantId, setDiscoveredTenantId] = useState<string | null>(
    null,
  );
  const [discoveredUserId, setDiscoveredUserId] = useState<string | null>(null);
  // Bumps to retry when apiFetch throws NotReadyError — the Cognito session
  // may be hydrated into AuthContext before the token cache is populated, and
  // AuthProvider wraps us so tenantId arrives before getIdToken() returns a
  // value. Rather than restructuring the provider tree, tolerate the race.
  const [authRetryTick, setAuthRetryTick] = useState(0);

  const jwtTenantId = user?.tenantId ?? null;
  const effectiveTenantId = jwtTenantId ?? discoveredTenantId;

  useEffect(() => {
    setGraphqlTenantId(effectiveTenantId || tenant?.id || null);
    return () => setGraphqlTenantId(null);
  }, [effectiveTenantId, tenant?.id]);

  async function fetchTenant(targetTenantId: string) {
    if (!targetTenantId || !API_URL) {
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
      }>(`/api/tenants/${targetTenantId}`, {
        extraHeaders: { "x-tenant-id": targetTenantId },
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
      console.error("[apps/spaces TenantContext] fetch error:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
      setIsLoading(false);
    }
  }

  async function discoverTenantThenFetch() {
    setIsLoading(true);
    setError(null);
    const token = await getToken();
    if (!token) {
      setTimeout(() => setAuthRetryTick((n) => n + 1), 100);
      return;
    }
    const found = await discoverCallerViaAuthMe();
    setDiscoveredUserId(found.userId);
    if (found.tenantId) {
      setDiscoveredTenantId(found.tenantId);
      setNoTenantAssigned(false);
      await fetchTenant(found.tenantId);
    } else {
      // The user is signed in but has no discoverable tenant membership.
      // Render the NoTenantAssigned page rather than auto-bootstrapping a
      // new tenant.
      setTenant(null);
      setNoTenantAssigned(true);
      setIsLoading(false);
    }
  }

  async function discoverCallerThenFetchTenant(targetTenantId: string) {
    setIsLoading(true);
    setError(null);
    setNoTenantAssigned(false);
    const token = await getToken();
    if (!token) {
      setTimeout(() => setAuthRetryTick((n) => n + 1), 100);
      return;
    }
    const found = await discoverCallerViaAuthMe();
    setDiscoveredUserId(found.userId);
    await fetchTenant(targetTenantId);
  }

  useEffect(() => {
    if (isAuthenticated && jwtTenantId) {
      discoverCallerThenFetchTenant(jwtTenantId);
    } else if (isAuthenticated && !jwtTenantId) {
      // No tenant claim on the JWT (Google-federated user, pre-token trigger
      // hasn't landed). Try tenant-discovery before falling back to
      // NoTenantAssigned.
      discoverTenantThenFetch();
    } else {
      setTenant(null);
      setDiscoveredUserId(null);
      setNoTenantAssigned(false);
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, jwtTenantId, authRetryTick]);

  return (
    <TenantContext.Provider
      value={{
        tenant,
        tenantId: effectiveTenantId || tenant?.id || null,
        userId: discoveredUserId ?? user?.sub ?? null,
        isLoading,
        error,
        noTenantAssigned,
        refetch: () => {
          if (jwtTenantId) {
            fetchTenant(jwtTenantId);
          } else {
            discoverTenantThenFetch();
          }
        },
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
  if (!ctx) throw new Error("useTenant must be used within a TenantProvider");
  return ctx;
}
