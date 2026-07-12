/**
 * Operator inspection of source bindings under one processor config
 * (THINK-193 U2). Tenant-admin gated.
 */

import { memorySourceConfigs as memorySourceConfigsTable } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { and, desc, eq } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

type SourceConfigRow = typeof memorySourceConfigsTable.$inferSelect;

export async function memorySourceConfigs(
  _parent: unknown,
  args: { tenantId?: string | null; processorConfigId: string },
  ctx: GraphQLContext,
) {
  const tenantId =
    args.tenantId ?? ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");
  await requireTenantAdmin(ctx, tenantId);

  const rows = await ctx.db
    .select()
    .from(memorySourceConfigsTable)
    .where(
      and(
        eq(memorySourceConfigsTable.tenant_id, tenantId),
        eq(
          memorySourceConfigsTable.processor_config_id,
          args.processorConfigId,
        ),
      ),
    )
    .orderBy(desc(memorySourceConfigsTable.created_at));

  return rows.map(toGraphqlSourceConfig);
}

function toGraphqlSourceConfig(row: SourceConfigRow) {
  return {
    id: row.id,
    processorConfigId: row.processor_config_id,
    sourceFamily: row.source_family,
    sourceBindingKey: row.source_binding_key,
    enabled: row.enabled,
    boundary: row.boundary,
    createdAt: toIso(row.created_at),
  };
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}
