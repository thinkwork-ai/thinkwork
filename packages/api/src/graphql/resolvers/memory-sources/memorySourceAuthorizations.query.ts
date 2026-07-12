/**
 * Operator inspection of source-access grants for one processor config
 * (THINK-193 U2). Tenant-admin gated. Returns all grant rows (active,
 * revoked, expired) so the grant history is auditable.
 */

import { memorySourceAuthorizations as memorySourceAuthorizationsTable } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { and, desc, eq } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

type AuthorizationRow = typeof memorySourceAuthorizationsTable.$inferSelect;

export async function memorySourceAuthorizations(
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
    .from(memorySourceAuthorizationsTable)
    .where(
      and(
        eq(memorySourceAuthorizationsTable.tenant_id, tenantId),
        eq(
          memorySourceAuthorizationsTable.processor_config_id,
          args.processorConfigId,
        ),
      ),
    )
    .orderBy(desc(memorySourceAuthorizationsTable.created_at));

  return rows.map(toGraphqlAuthorization);
}

export function toGraphqlAuthorization(row: AuthorizationRow) {
  return {
    id: row.id,
    processorConfigId: row.processor_config_id,
    sourceFamily: row.source_family,
    sourceBindingKey: row.source_binding_key,
    boundary: row.boundary,
    status: row.status,
    grantVersion: row.grant_version,
    grantedByUserId: row.granted_by_user_id,
    expiresAt: toIso(row.expires_at),
    revokedAt: toIso(row.revoked_at),
    createdAt: toIso(row.created_at),
  };
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}
