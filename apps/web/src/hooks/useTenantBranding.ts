import { useMemo } from "react";
import { useQuery } from "urql";
import { useTenant } from "@/context/TenantContext";
import { SettingsTenantFeaturesQuery } from "@/lib/settings-queries";
import {
  brandingFromFeatures,
  normalizeFeatures,
  resolveBranding,
  type ResolvedBranding,
} from "@/lib/tenant-branding";

/**
 * Resolved white-label branding for the nav headers. `loaded` is false until
 * the tenant features query settles — callers hold the header slot empty
 * rather than flashing the default logo on white-labeled tenants.
 */
export function useTenantBranding(): ResolvedBranding & { loaded: boolean } {
  const { tenantId } = useTenant();
  const [{ data, fetching }] = useQuery({
    query: SettingsTenantFeaturesQuery,
    variables: { id: tenantId ?? "" },
    pause: !tenantId,
  });

  return useMemo(() => {
    const resolved = resolveBranding(
      brandingFromFeatures(normalizeFeatures(data?.tenant?.settings?.features)),
    );
    // Without a tenant (query paused) there is nothing to wait for — render
    // the defaults rather than an empty header.
    return { ...resolved, loaded: !tenantId || !fetching };
  }, [data?.tenant?.settings?.features, fetching, tenantId]);
}
