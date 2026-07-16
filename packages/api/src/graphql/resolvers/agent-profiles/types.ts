import { getTenantModelCatalogEntry } from "../../../lib/model-catalog/tenant-catalog.js";

/**
 * AgentProfile type resolvers (subagent-folders U11). Space assignment
 * fields are always empty: the space-local `agent_profiles` path is
 * deleted — space-scoped sub-agents are a future folder-based arc.
 */
export const agentProfileTypeResolvers = {
  model: async (parent: any) => {
    const modelId = parent.modelId ?? parent.model_id;
    const tenantId = parent.tenantId ?? parent.tenant_id;
    if (!tenantId || !modelId) return null;
    return getTenantModelCatalogEntry({ tenantId, modelId });
  },
  spaceAssignments: async () => [],
  spaces: async () => [],
};

export const agentProfileSpaceAssignmentTypeResolvers = {
  space: async () => null,
};
