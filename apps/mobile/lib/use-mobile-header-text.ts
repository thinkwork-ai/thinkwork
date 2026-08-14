import { useMemo } from "react";
import { useQuery } from "urql";
import { TenantMobileBrandingQuery } from "./graphql-queries";

/**
 * Tenant-branded title for the mobile app header, from
 * `tenant_settings.features.branding.mobileHeaderText` (set in the web app
 * under Settings → General → Mobile Header Text). Returns null when unset or
 * blank — callers fall back to their default (the agent name).
 */
export function useMobileHeaderText(tenantId: string | null): string | null {
  const [{ data }] = useQuery({
    query: TenantMobileBrandingQuery,
    variables: { id: tenantId ?? "" },
    pause: !tenantId,
  });

  return useMemo(() => {
    const raw: unknown = data?.tenant?.settings?.features;
    let features: unknown = raw;
    if (typeof raw === "string") {
      try {
        features = JSON.parse(raw);
      } catch {
        return null;
      }
    }
    if (typeof features !== "object" || features === null) return null;
    const branding = (features as Record<string, unknown>).branding;
    if (typeof branding !== "object" || branding === null) return null;
    const text = (branding as Record<string, unknown>).mobileHeaderText;
    if (typeof text !== "string") return null;
    const trimmed = text.trim();
    return trimmed || null;
  }, [data?.tenant?.settings?.features]);
}
