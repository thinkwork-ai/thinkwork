/**
 * setMemorySourceConfig — create, update, or disable a source config
 * (THINK-193 U5/U6). SHARED processors are tenant-admin gated; PERSONAL
 * processors are OWNER self-service restricted to family 'email' with a
 * caller-owned connection as the binding (personal-email-self-service.ts).
 *
 * The boundary is validated against the family's governed-dimension schema
 * (assertSourceConfigBoundaryValid — typo'd keys and malformed values are
 * immediate errors), and — when an ACTIVE grant exists for the binding —
 * proven WITHIN the grant envelope (assertBoundaryWithin) so operators
 * learn about an out-of-envelope config at save time rather than at the
 * first acquire. Without a grant the config saves; acquisition stays
 * blocked until one is granted (fail closed at run time).
 */

import {
  MEMORY_SOURCE_FAMILIES,
  memoryProcessorConfigs as memoryProcessorConfigsTable,
  memorySourceConfigs as memorySourceConfigsTable,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { and, eq } from "../../utils.js";
import {
  assertBoundaryWithin,
  assertSourceConfigBoundaryValid,
  getActiveGrant,
} from "../../../lib/memory-sources/policy.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";
import { assertPersonalEmailSelfService } from "./personal-email-self-service.js";

type SourceConfigRow = typeof memorySourceConfigsTable.$inferSelect;

export async function setMemorySourceConfig(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    processorConfigId: string;
    /** Update an existing config; omit to create one. */
    sourceConfigId?: string | null;
    /** Required on create. */
    sourceFamily?: string | null;
    /** Required on create (e.g. "web-extract" for firecrawl). */
    sourceBindingKey?: string | null;
    boundary?: Record<string, unknown> | string | null;
    enabled?: boolean | null;
  },
  ctx: GraphQLContext,
) {
  const tenantId =
    args.tenantId ?? ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");

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

  let existing: SourceConfigRow | null = null;
  if (args.sourceConfigId) {
    const [row] = await ctx.db
      .select()
      .from(memorySourceConfigsTable)
      .where(
        and(
          eq(memorySourceConfigsTable.id, args.sourceConfigId),
          eq(memorySourceConfigsTable.tenant_id, tenantId),
          eq(
            memorySourceConfigsTable.processor_config_id,
            args.processorConfigId,
          ),
        ),
      )
      .limit(1);
    if (!row) throw new Error("Memory source config not found");
    existing = row;
  }

  const sourceFamily = existing?.source_family ?? args.sourceFamily ?? null;
  const sourceBindingKey =
    existing?.source_binding_key ?? args.sourceBindingKey ?? null;
  if (!sourceFamily || !sourceBindingKey) {
    throw new Error(
      "sourceFamily and sourceBindingKey are required when creating a source config",
    );
  }
  if (
    existing &&
    ((args.sourceFamily && args.sourceFamily !== existing.source_family) ||
      (args.sourceBindingKey &&
        args.sourceBindingKey !== existing.source_binding_key))
  ) {
    throw new Error(
      "sourceFamily/sourceBindingKey are immutable — create a new source config instead",
    );
  }
  if (!(MEMORY_SOURCE_FAMILIES as readonly string[]).includes(sourceFamily)) {
    throw new Error(
      `Unknown source family "${sourceFamily}" — expected one of ${MEMORY_SOURCE_FAMILIES.join(", ")}`,
    );
  }

  // Authz (U6): shared processors are operator surfaces (tenant admin);
  // personal processors are owner self-service, restricted to the caller's
  // own email connection.
  if (processor.mode === "personal") {
    await assertPersonalEmailSelfService(ctx, {
      tenantId,
      processor,
      sourceFamily,
      sourceBindingKey,
    });
  } else {
    await requireTenantAdmin(ctx, tenantId);
  }

  const boundary =
    args.boundary === undefined || args.boundary === null
      ? ((existing?.boundary ?? {}) as Record<string, unknown>)
      : parseBoundary(args.boundary);
  // Fail closed at save time: governed keys/values only…
  assertSourceConfigBoundaryValid(boundary, { sourceFamily });
  // …and inside the active grant envelope when one exists.
  const grant = await getActiveGrant(ctx.db, {
    tenantId,
    processorConfigId: args.processorConfigId,
    sourceFamily,
    sourceBindingKey,
  });
  if (grant) {
    assertBoundaryWithin(
      (grant.boundary ?? {}) as Record<string, unknown>,
      boundary,
      { sourceFamily },
    );
  }

  const enabled = args.enabled ?? existing?.enabled ?? true;
  let row: SourceConfigRow;
  if (existing) {
    const [updated] = await ctx.db
      .update(memorySourceConfigsTable)
      .set({ boundary, enabled, updated_at: new Date() })
      .where(eq(memorySourceConfigsTable.id, existing.id))
      .returning();
    row = updated!;
  } else {
    const [inserted] = await ctx.db
      .insert(memorySourceConfigsTable)
      .values({
        tenant_id: tenantId,
        processor_config_id: args.processorConfigId,
        source_family: sourceFamily,
        source_binding_key: sourceBindingKey,
        boundary,
        enabled,
      })
      .onConflictDoUpdate({
        target: [
          memorySourceConfigsTable.processor_config_id,
          memorySourceConfigsTable.source_family,
          memorySourceConfigsTable.source_binding_key,
        ],
        set: { boundary, enabled, updated_at: new Date() },
      })
      .returning();
    row = inserted!;
  }

  return {
    id: row.id,
    processorConfigId: row.processor_config_id,
    sourceFamily: row.source_family,
    sourceBindingKey: row.source_binding_key,
    enabled: row.enabled,
    boundary: row.boundary,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : (row.created_at ?? null),
  };
}

function parseBoundary(
  raw: Record<string, unknown> | string,
): Record<string, unknown> {
  if (typeof raw !== "string") return raw;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  throw new Error("boundary must be a JSON object");
}
