import { asc, sql } from "drizzle-orm";
import {
  and,
  db,
  eq,
  inArray,
  spaceChecklistItems,
  spaceChecklistTemplates,
  spaceIntegrations,
  spaceMembers,
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
