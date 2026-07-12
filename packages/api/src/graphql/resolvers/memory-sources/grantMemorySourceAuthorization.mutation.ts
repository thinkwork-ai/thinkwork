/**
 * grantMemorySourceAuthorization — insert an active source-access grant for
 * a binding under a processor config (THINK-193 U2). Any existing active
 * grant for the same (processorConfig, sourceFamily, sourceBindingKey) is
 * revoked first so exactly one active grant exists per binding (matching
 * the partial unique index memory_source_authorizations_active_uidx).
 */

import {
  MEMORY_SOURCE_FAMILIES,
  memoryProcessorConfigs as memoryProcessorConfigsTable,
  memorySourceAuthorizations as memorySourceAuthorizationsTable,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { and, eq, inArray } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";
import { toGraphqlAuthorization } from "./memorySourceAuthorizations.query.js";

type AuthorizationRow = typeof memorySourceAuthorizationsTable.$inferSelect;

export async function grantMemorySourceAuthorization(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    processorConfigId: string;
    sourceFamily: string;
    sourceBindingKey: string;
    boundary?: Record<string, unknown> | string | null;
    expiresAt?: string | null;
  },
  ctx: GraphQLContext,
) {
  const tenantId =
    args.tenantId ?? ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");
  await requireTenantAdmin(ctx, tenantId);

  if (
    !(MEMORY_SOURCE_FAMILIES as readonly string[]).includes(args.sourceFamily)
  ) {
    throw new Error(
      `Unknown source family "${args.sourceFamily}" — expected one of ${MEMORY_SOURCE_FAMILIES.join(", ")}`,
    );
  }

  const [processor] = await ctx.db
    .select()
    .from(memoryProcessorConfigsTable)
    .where(
      and(
        eq(memoryProcessorConfigsTable.id, args.processorConfigId),
        eq(memoryProcessorConfigsTable.tenant_id, tenantId),
      ),
    )
    .limit(1);
  if (!processor) throw new Error("Memory processor config not found");

  const now = new Date();
  const bindingFilters = and(
    eq(memorySourceAuthorizationsTable.tenant_id, tenantId),
    eq(
      memorySourceAuthorizationsTable.processor_config_id,
      args.processorConfigId,
    ),
    eq(memorySourceAuthorizationsTable.source_family, args.sourceFamily),
    eq(
      memorySourceAuthorizationsTable.source_binding_key,
      args.sourceBindingKey,
    ),
  );

  const existing: AuthorizationRow[] = await ctx.db
    .select()
    .from(memorySourceAuthorizationsTable)
    .where(bindingFilters);

  // One active grant per binding: supersede by revoking the current one(s).
  const activeIds = existing
    .filter((row) => row.status === "active")
    .map((row) => row.id);
  if (activeIds.length > 0) {
    await ctx.db
      .update(memorySourceAuthorizationsTable)
      .set({ status: "revoked", revoked_at: now, updated_at: now })
      .where(inArray(memorySourceAuthorizationsTable.id, activeIds));
  }

  const nextGrantVersion =
    existing.reduce((max, row) => Math.max(max, row.grant_version), 0) + 1;

  const [inserted] = await ctx.db
    .insert(memorySourceAuthorizationsTable)
    .values({
      tenant_id: tenantId,
      processor_config_id: args.processorConfigId,
      source_family: args.sourceFamily,
      source_binding_key: args.sourceBindingKey,
      boundary: parseBoundary(args.boundary),
      granted_by_user_id: await resolveCallerUserId(ctx),
      grant_version: nextGrantVersion,
      status: "active",
      expires_at: args.expiresAt ? new Date(args.expiresAt) : null,
    })
    .returning();

  return toGraphqlAuthorization(inserted);
}

function parseBoundary(
  raw: Record<string, unknown> | string | null | undefined,
): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw !== "string") return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    throw new Error("boundary must be a JSON object");
  }
}
