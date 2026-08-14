import { useMemo } from "react";
import { useQuery } from "urql";
import { useTenant } from "@/context/TenantContext";
import { SettingsTenantFeaturesQuery } from "@/lib/settings-queries";
import {
  brandingFromFeatures,
  normalizeFeatures,
  resolveBranding,
  type ResolvedBranding,
  type TenantBranding,
} from "@/lib/tenant-branding";

// Last-known branding, persisted so the header renders instantly on page
// load instead of waiting for /api/auth/me + the tenant features query
// (two sequential network round-trips). Reconciled every time the query
// settles; keyed by tenantId so a tenant switch never shows stale branding.
const BRANDING_CACHE_KEY = "thinkwork.branding.v1";

type BrandingCacheEntry = { tenantId: string; branding: TenantBranding };

function readBrandingCache(): BrandingCacheEntry | null {
  try {
    const raw = localStorage.getItem(BRANDING_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as BrandingCacheEntry).tenantId !== "string"
    ) {
      return null;
    }
    const entry = parsed as BrandingCacheEntry;
    // Re-validate through the same normalizer the live path uses, so a
    // corrupt or legacy cache entry can never render garbage.
    return {
      tenantId: entry.tenantId,
      branding: brandingFromFeatures({ branding: entry.branding }),
    };
  } catch {
    return null;
  }
}

function writeBrandingCache(entry: BrandingCacheEntry): void {
  try {
    localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Quota/private-mode failures just mean no fast paint next load.
  }
}

/**
 * Resolved white-label branding for the nav headers. Renders instantly from
 * the persisted last-known branding when available; `loaded` is false only
 * on a truly cold first visit (no cache) while the tenant features query is
 * in flight — callers hold the header slot empty in that one case rather
 * than flashing the default logo on white-labeled tenants.
 */
export function useTenantBranding(): ResolvedBranding & { loaded: boolean } {
  const { tenantId } = useTenant();
  const [{ data, fetching }] = useQuery({
    query: SettingsTenantFeaturesQuery,
    variables: { id: tenantId ?? "" },
    pause: !tenantId,
  });

  return useMemo(() => {
    const settled = !!tenantId && !fetching && data !== undefined;
    if (settled) {
      const branding = brandingFromFeatures(
        normalizeFeatures(data?.tenant?.settings?.features),
      );
      writeBrandingCache({ tenantId, branding });
      return { ...resolveBranding(branding), loaded: true };
    }
    // Query not settled yet (tenant unresolved or features in flight):
    // paint the cached branding if it's usable for this tenant.
    const cached = readBrandingCache();
    if (cached && (!tenantId || cached.tenantId === tenantId)) {
      return { ...resolveBranding(cached.branding), loaded: true };
    }
    // Without a tenant (query paused) there is nothing to wait for — render
    // the defaults rather than an empty header.
    return { ...resolveBranding({}), loaded: !tenantId ? !fetching : false };
  }, [data, fetching, tenantId]);
}
