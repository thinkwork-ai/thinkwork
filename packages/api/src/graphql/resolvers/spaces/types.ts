import { asc, sql } from "drizzle-orm";
import {
  and,
  db,
  eq,
  inArray,
  knowledgeBases,
  spaceChecklistItems,
  spaceChecklistTemplates,
  spaceIntegrations,
  spaceKnowledgeBases,
  spaceMembers,
  spaceMcpServers,
  tenantMcpServers,
  users,
  snakeToCamel,
} from "../../utils.js";
import { toGraphqlSpaceChild } from "./shared.js";
import { builtInToolsFromPolicy } from "./tools-policy.js";

export const spaceTypeResolvers = {
  builtInTools: async (parent: any) => {
    return builtInToolsFromPolicy(parent.toolPolicy ?? parent.tool_policy);
  },
  runtimeOverrides: (parent: any) => ({
    model: parent.modelOverride ?? parent.model_override ?? null,
    guardrailId:
      parent.guardrailIdOverride ?? parent.guardrail_id_override ?? null,
    budgetMonthlyCents:
      parent.budgetMonthlyCentsOverride ??
      parent.budget_monthly_cents_override ??
      null,
    budgetPaused:
      parent.budgetPausedOverride ?? parent.budget_paused_override ?? null,
    sandbox: parent.sandboxOverride ?? parent.sandbox_override ?? null,
  }),
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
      )
      .orderBy(
        sql`CASE ${spaceMembers.role}
              WHEN 'owner' THEN 0
              WHEN 'admin' THEN 1
              WHEN 'member' THEN 2
              WHEN 'viewer' THEN 3
              ELSE 4
            END`,
        asc(spaceMembers.created_at),
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
  mcpServers: async (parent: any) => {
    const spaceId = parent.id;
    const tenantId = parent.tenantId ?? parent.tenant_id;
    const rows = await db
      .select()
      .from(spaceMcpServers)
      .where(
        and(
          eq(spaceMcpServers.tenant_id, tenantId),
          eq(spaceMcpServers.space_id, spaceId),
        ),
      );
    return rows.map((row) => toGraphqlSpaceChild(row));
  },
  knowledgeBases: async (parent: any) => {
    const spaceId = parent.id;
    const tenantId = parent.tenantId ?? parent.tenant_id;
    const rows = await db
      .select()
      .from(spaceKnowledgeBases)
      .where(
        and(
          eq(spaceKnowledgeBases.tenant_id, tenantId),
          eq(spaceKnowledgeBases.space_id, spaceId),
        ),
      );
    const knowledgeBaseIds = rows.map((row) => row.knowledge_base_id);
    const kbRows =
      knowledgeBaseIds.length > 0
        ? await db
            .select()
            .from(knowledgeBases)
            .where(inArray(knowledgeBases.id, knowledgeBaseIds))
        : [];
    const kbById = new Map(
      kbRows.map((knowledgeBase) => [
        knowledgeBase.id,
        snakeToCamel(knowledgeBase),
      ]),
    );

    return rows.map((row) => ({
      ...toGraphqlSpaceChild(row),
      knowledgeBase: kbById.get(row.knowledge_base_id) ?? null,
    }));
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

export const spaceMcpServerTypeResolvers = {
  mcpServer: async (parent: any) => {
    const mcpServerId = parent.mcpServerId ?? parent.mcp_server_id;
    const tenantId = parent.tenantId ?? parent.tenant_id;
    if (!mcpServerId || !tenantId) return null;
    const [row] = await db
      .select()
      .from(tenantMcpServers)
      .where(
        and(
          eq(tenantMcpServers.tenant_id, tenantId),
          eq(tenantMcpServers.id, mcpServerId),
        ),
      );
    return row ? snakeToCamel(row) : null;
  },
};
