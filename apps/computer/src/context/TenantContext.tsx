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
   * True when the signed-in user has no `custom:tenant_id` claim AND the
   * tenant-discovery fallback (myComputer GraphQL query) found no membership
   * either. apps/computer (the end-user surface) deliberately does NOT call
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
const GRAPHQL_HTTP_URL =
  import.meta.env.VITE_GRAPHQL_HTTP_URL || `${API_URL}/graphql`;
const GRAPHQL_API_KEY = import.meta.env.VITE_GRAPHQL_API_KEY || "";

/**
 * Tenant-discovery fallback for Google-federated users. Cognito JWTs from
 * Google OAuth do not carry `custom:tenant_id` until the pre-token Lambda
 * trigger lands; admin papers over this with `bootstrapUser` (which would
 * auto-promote the user to operator of a new tenant). apps/computer
 * suppresses that path, so existing-tenant Google users would otherwise be
 * locked out. Solution: query `myComputer` — its server resolver does an
 * email-fallback DB lookup on the caller's identity and returns the
 * Computer (which carries tenantId) when one exists. No tenant
 * provisioning happens in this path; we only read.
 */
async function discoverTenantViaMyComputer(
  token: string,
): Promise<string | null> {
  if (!GRAPHQL_HTTP_URL) return null;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: token,
    };
    if (GRAPHQL_API_KEY) headers["x-api-key"] = GRAPHQL_API_KEY;
    const res = await fetch(GRAPHQL_HTTP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: `query { myComputer { id tenantId } }`,
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: { myComputer?: { id?: string; tenantId?: string } | null };
    };
    return body.data?.myComputer?.tenantId ?? null;
  } catch {
    return null;
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
      console.error("[apps/computer TenantContext] fetch error:", err);
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
    const found = await discoverTenantViaMyComputer(token);
    if (found) {
      setDiscoveredTenantId(found);
      setNoTenantAssigned(false);
      await fetchTenant(found);
    } else {
      // The user is signed in but has no Computer (and therefore no tenant
      // membership we can discover from this surface). Render the
      // NoTenantAssigned page rather than auto-bootstrapping a new tenant.
      setTenant(null);
      setNoTenantAssigned(true);
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (isAuthenticated && jwtTenantId) {
      fetchTenant(jwtTenantId);
    } else if (isAuthenticated && !jwtTenantId) {
      // No tenant claim on the JWT (Google-federated user, pre-token trigger
      // hasn't landed). Try tenant-discovery via myComputer before falling
      // back to NoTenantAssigned.
      discoverTenantThenFetch();
    } else {
      setTenant(null);
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
  if (!ctx)
    throw new Error("useTenant must be used within a TenantProvider");
  return ctx;
}
