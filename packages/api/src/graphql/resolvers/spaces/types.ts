import {
  agents,
  agentToCamel,
  and,
  db,
  eq,
  spaceAgentAssignments,
  spaceChecklistItems,
  spaceChecklistTemplates,
  spaceIntegrations,
  spaceMembers,
  users,
  snakeToCamel,
} from "../../utils.js";
import { toGraphqlSpaceChild } from "./shared.js";

export const spaceTypeResolvers = {
  members: async (parent: any) => {
    const spaceId = parent.id;
    const tenantId = parent.tenantId ?? parent.tenant_id;
    const rows = await db
      .select()
      .from(spaceMembers)
      .where(
        and(
          eq(spaceMembers.tenant_id, tenantId),
          eq(spaceMembers.space_id, spaceId),
        ),
      );
    return rows.map((row) => toGraphqlSpaceChild(row));
  },
  agentAssignments: async (parent: any) => {
    const spaceId = parent.id;
    const tenantId = parent.tenantId ?? parent.tenant_id;
    const rows = await db
      .select()
      .from(spaceAgentAssignments)
      .where(
        and(
          eq(spaceAgentAssignments.tenant_id, tenantId),
          eq(spaceAgentAssignments.space_id, spaceId),
        ),
      );
    return rows.map((row) => toGraphqlSpaceChild(row));
  },
  checklistTemplates: async (parent: any) => {
    const spaceId = parent.id;
    const tenantId = parent.tenantId ?? parent.tenant_id;
    const rows = await db
      .select()
      .from(spaceChecklistTemplates)
      .where(
        and(
          eq(spaceChecklistTemplates.tenant_id, tenantId),
          eq(spaceChecklistTemplates.space_id, spaceId),
        ),
      );
    return rows.map((row) => toGraphqlSpaceChild(row));
  },
  integrations: async (parent: any) => {
    const spaceId = parent.id;
    const tenantId = parent.tenantId ?? parent.tenant_id;
    const rows = await db
      .select()
      .from(spaceIntegrations)
      .where(
        and(
          eq(spaceIntegrations.tenant_id, tenantId),
          eq(spaceIntegrations.space_id, spaceId),
        ),
      );
    return rows.map((row) => toGraphqlSpaceChild(row));
  },
};

export const spaceMemberTypeResolvers = {
  user: async (parent: any) => {
    const userId = parent.userId ?? parent.user_id;
    if (!userId) return null;
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    return row ? snakeToCamel(row) : null;
  },
};

export const spaceAgentAssignmentTypeResolvers = {
  agent: async (parent: any) => {
    const agentId = parent.agentId ?? parent.agent_id;
    if (!agentId) return null;
    const [row] = await db.select().from(agents).where(eq(agents.id, agentId));
    return row ? agentToCamel(row) : null;
  },
};

export const spaceChecklistTemplateTypeResolvers = {
  items: async (parent: any) => {
    const templateId = parent.id;
    const tenantId = parent.tenantId ?? parent.tenant_id;
    const rows = await db
      .select()
      .from(spaceChecklistItems)
      .where(
        and(
          eq(spaceChecklistItems.tenant_id, tenantId),
          eq(spaceChecklistItems.template_id, templateId),
        ),
      );
    return rows.map((row) => toGraphqlSpaceChild(row));
  },
};
