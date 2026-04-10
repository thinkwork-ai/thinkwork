import { useEffect } from "react";
import { useColorScheme } from "nativewind";
import { useAuth } from "@/lib/auth-context";
import { useTenant } from "@/lib/hooks/use-tenants";

/**
 * Subscribes to tenant settings via GraphQL and applies them reactively.
 * When the agent (or UI) updates preferences, this hook
 * automatically applies the changes — e.g., switching to dark mode.
 *
 * TODO: Team configuration / user preferences not yet modeled in GraphQL.
 * Currently stubs to dark mode default. Wire up when tenant settings
 * include theme/preferences fields.
 */
export function useTeamConfiguration() {
  const { user } = useAuth();
  const tenantId = (user as any)?.tenantId as string | undefined;
  const [{ data: tenantData }] = useTenant(tenantId);
  const { setColorScheme } = useColorScheme();

  useEffect(() => {
    // TODO: Read theme from tenant settings or user profile when available
    // For now, default to dark mode per project convention
    setColorScheme("dark");
  }, [setColorScheme]);

  // Return a stub matching the old shape so callers don't break
  return tenantData?.tenant
    ? { theme: "dark" as const }
    : undefined;
}
