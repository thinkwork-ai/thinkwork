import { useState } from "react";

/**
 * Computer feature retired 2026-05-24. This hook is preserved as a stub
 * returning permanent "no Computer assigned" state so existing consumers
 * (NewThreadDialog, SpacesWorkbench, use-customize-mutations, automations)
 * naturally fall into their no-Computer code paths without needing edits.
 *
 * Remove this hook + its consumers in a follow-up pass once the no-Computer
 * UI states have been verified in production for a release cycle.
 */

export interface AssignedComputer {
  id: string;
  name?: string | null;
  tenantId?: string | null;
  slug?: string | null;
  status?: string | null;
  runtimeStatus?: string | null;
  sourceAgent?: { id: string; name?: string | null } | null;
}

export function useAssignedComputerSelection(_options?: { pause?: boolean }) {
  const [selectedComputerId, setSelectedComputerId] = useState<string | null>(
    null,
  );

  return {
    computers: [] as AssignedComputer[],
    fetching: false,
    loaded: true,
    noAssignedComputers: true,
    selectedComputer: null as AssignedComputer | null,
    selectedComputerId,
    setSelectedComputerId,
  };
}
