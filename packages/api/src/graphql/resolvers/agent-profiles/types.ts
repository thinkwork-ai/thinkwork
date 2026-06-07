import {
  agentProfileSpaceAssignments,
  and,
  db,
  eq,
  inArray,
  modelCatalog,
  spaces,
  snakeToCamel,
} from "../../utils.js";
import { toGraphqlSpace } from "../spaces/shared.js";
import { toProfileAssignmentGraphql } from "./shared.js";

export const agentProfileTypeResolvers = {
  model: async (parent: any) => {
    const modelId = parent.modelId ?? parent.model_id;
    if (!modelId) return null;
    const [row] = await db
      .select()
      .from(modelCatalog)
      .where(eq(modelCatalog.model_id, modelId));
    return row ? snakeToCamel(row) : null;
  },
  spaceAssignments: async (parent: any) => {
    const profileId = parent.id;
    if (!profileId) return [];
    const rows = await db
      .select()
      .from(agentProfileSpaceAssignments)
      .where(eq(agentProfileSpaceAssignments.profile_id, profileId));
    return rows.map(toProfileAssignmentGraphql);
  },
  spaces: async (parent: any) => {
    const profileId = parent.id;
    const tenantId = parent.tenantId ?? parent.tenant_id;
    if (!profileId || !tenantId) return [];
    const assignments = await db
      .select({ spaceId: agentProfileSpaceAssignments.space_id })
      .from(agentProfileSpaceAssignments)
      .where(eq(agentProfileSpaceAssignments.profile_id, profileId));
    const spaceIds = assignments.map((row) => row.spaceId);
    if (spaceIds.length === 0) return [];
    const rows = await db
      .select()
      .from(spaces)
      .where(and(eq(spaces.tenant_id, tenantId), inArray(spaces.id, spaceIds)));
    return rows.map(toGraphqlSpace);
  },
};

export const agentProfileSpaceAssignmentTypeResolvers = {
  space: async (parent: any) => {
    const tenantId = parent.tenantId ?? parent.tenant_id;
    const spaceId = parent.spaceId ?? parent.space_id;
    if (!tenantId || !spaceId) return null;
    const [row] = await db
      .select()
      .from(spaces)
      .where(and(eq(spaces.tenant_id, tenantId), eq(spaces.id, spaceId)));
    return row ? toGraphqlSpace(row) : null;
  },
};
