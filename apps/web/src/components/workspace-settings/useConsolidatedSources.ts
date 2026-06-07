import { useMemo } from "react";
import { useQuery } from "urql";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsSpacesListQuery,
  SettingsTenantAgentQuery,
} from "@/lib/settings-queries";
import type { ConsolidatedTarget } from "@/lib/consolidated-workspace-client";

export interface ConsolidatedSourcesState {
  /** Sub-targets for the consolidated client; null while still resolving. */
  subTargets: ConsolidatedTarget | null;
  /** Whether the caller may edit (owner/admin); read-only otherwise. */
  isAdmin: boolean;
  loading: boolean;
  error: Error | null;
}

/**
 * Resolves the three workspace sources the consolidated Settings → Workspace
 * tree spans — the tenant Agent, every Space, and the current User — plus the
 * caller's edit permission. Reuses the same queries the per-target settings
 * screens use (`SettingsTenantAgentQuery`, `SettingsSpacesListQuery`) and
 * `useTenant()` for identity + role.
 */
export function useConsolidatedSources(): ConsolidatedSourcesState {
  const { tenantId, userId, isOperator, roleResolved, isLoading } = useTenant();

  const [agentResult] = useQuery({
    query: SettingsTenantAgentQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [spacesResult] = useQuery({
    query: SettingsSpacesListQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });

  const agentId = agentResult.data?.agent?.id ?? null;
  const spaces = spacesResult.data?.spaces;

  const subTargets = useMemo<ConsolidatedTarget | null>(() => {
    if (!tenantId) return null;
    if (agentResult.fetching || spacesResult.fetching) return null;
    return {
      agentId,
      spaces: (spaces ?? []).map((space) => ({
        id: space.id,
        name: space.name,
      })),
      userId,
    };
  }, [
    tenantId,
    agentId,
    spaces,
    userId,
    agentResult.fetching,
    spacesResult.fetching,
  ]);

  return {
    subTargets,
    // Gate on roleResolved too so members never flash an editable state before
    // /api/auth/me resolves the role.
    isAdmin: isOperator && roleResolved,
    // Include the tenant-resolution phase so a not-yet-resolved tenantId reads
    // as loading rather than leaving the view on an indefinite spinner. Once
    // the tenant resolves with no id, loading clears and subTargets stays null,
    // letting the view render a terminal "no workspace" state.
    loading:
      isLoading ||
      (Boolean(tenantId) && (agentResult.fetching || spacesResult.fetching)),
    error: agentResult.error ?? spacesResult.error ?? null,
  };
}
