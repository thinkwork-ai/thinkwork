/**
 * Operator inspection of external-memory processor configs (THINK-193 U2).
 * Tenant-admin gated, shaped like brainDreamRuns.
 */

import { memoryProcessorConfigs as memoryProcessorConfigsTable } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { desc, eq } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

type ProcessorConfigRow = typeof memoryProcessorConfigsTable.$inferSelect;

export async function memoryProcessorConfigs(
  _parent: unknown,
  args: { tenantId?: string | null },
  ctx: GraphQLContext,
) {
  const tenantId =
    args.tenantId ?? ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");
  await requireTenantAdmin(ctx, tenantId);

  const rows = await ctx.db
    .select()
    .from(memoryProcessorConfigsTable)
    .where(eq(memoryProcessorConfigsTable.tenant_id, tenantId))
    .orderBy(desc(memoryProcessorConfigsTable.created_at));

  return rows.map(toGraphqlProcessorConfig);
}

function toGraphqlProcessorConfig(row: ProcessorConfigRow) {
  return {
    id: row.id,
    mode: row.mode,
    targetScope: row.target_scope,
    targetId: row.target_id,
    enabled: row.enabled,
    status: row.status,
    budget: row.budget,
    createdByUserId: row.created_by_user_id,
    createdAt: toIso(row.created_at),
  };
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}
