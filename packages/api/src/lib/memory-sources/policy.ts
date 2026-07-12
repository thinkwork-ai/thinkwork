/**
 * Consent policy for external memory sources (THINK-193 U2).
 *
 * memory_source_authorizations rows are operator-granted envelopes: a
 * processor may only ingest a (source_family, source_binding_key) while an
 * ACTIVE, unexpired grant exists, and its source-config boundary must stay
 * WITHIN the grant's boundary envelope (assertBoundaryWithin).
 *
 * NOTE on schema access: the memory_source_authorizations table lands in a
 * parallel change to @thinkwork/database-pg. The table is accessed via a
 * namespace import so the pure policy functions (grantInactiveReason,
 * assertBoundaryWithin) stay loadable and unit-testable while the schema
 * export is pending.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import * as dbSchema from "@thinkwork/database-pg/schema";

import type { DbHandle } from "./types.js";

/** A memory_source_authorizations row. */
export type GrantRow = typeof dbSchema.memorySourceAuthorizations.$inferSelect;

/** Thrown when ingestion is attempted without (or beyond) a valid grant. */
export class MemoryAuthorizationError extends Error {
  readonly name = "MemoryAuthorizationError";
}

// ---------------------------------------------------------------------------
// Pure decision logic
// ---------------------------------------------------------------------------

/**
 * PURE: why a grant row is NOT currently usable, or null when it is.
 * An `expires_at` in the past wins even when the stored status is a stale
 * 'active' (expiry is a wall-clock fact, not a row transition).
 */
export function grantInactiveReason(
  grant: { status: string; expires_at: Date | null },
  now: Date = new Date(),
): string | null {
  if (grant.status === "revoked") return "revoked";
  if (grant.status === "expired") return "expired";
  if (grant.expires_at !== null && grant.expires_at <= now) return "expired";
  return grant.status === "active" ? null : `status '${grant.status}'`;
}

/**
 * PURE: assert the processor's source-config boundary is a SUBSET of the
 * grant envelope. Compared generically over keys present in BOTH objects:
 * where the grant value is a number it is a cap (config must be a number
 * <= it); where the grant value is an array it is an allowlist (config
 * must be an array whose every element appears in it). Keys the grant does
 * not set are unconstrained. Throws MemoryAuthorizationError naming the
 * violating key.
 */
export function assertBoundaryWithin(
  grantBoundary: Record<string, unknown>,
  configBoundary: Record<string, unknown>,
): void {
  for (const [key, grantValue] of Object.entries(grantBoundary)) {
    if (!(key in configBoundary)) continue;
    const configValue = configBoundary[key];

    if (typeof grantValue === "number") {
      if (typeof configValue !== "number" || configValue > grantValue) {
        throw new MemoryAuthorizationError(
          `source-config boundary key '${key}' (${JSON.stringify(configValue)}) exceeds the grant envelope cap ${grantValue}`,
        );
      }
      continue;
    }

    if (Array.isArray(grantValue)) {
      if (!Array.isArray(configValue)) {
        throw new MemoryAuthorizationError(
          `source-config boundary key '${key}' (${JSON.stringify(configValue)}) must be an array subset of the grant allowlist`,
        );
      }
      const allowed = new Set(grantValue.map((item) => JSON.stringify(item)));
      for (const item of configValue) {
        if (!allowed.has(JSON.stringify(item))) {
          throw new MemoryAuthorizationError(
            `source-config boundary key '${key}' includes ${JSON.stringify(item)}, which is outside the grant allowlist`,
          );
        }
      }
      continue;
    }
    // Other grant value types are informational, not enforced constraints.
  }
}

// ---------------------------------------------------------------------------
// Grant lookups
// ---------------------------------------------------------------------------

async function listGrants(
  db: DbHandle,
  args: {
    tenantId: string;
    processorConfigId: string;
    sourceFamily: string;
    sourceBindingKey: string;
  },
): Promise<GrantRow[]> {
  const table = dbSchema.memorySourceAuthorizations;
  return await db
    .select()
    .from(table)
    .where(
      and(
        eq(table.tenant_id, args.tenantId),
        eq(table.processor_config_id, args.processorConfigId),
        eq(table.source_family, args.sourceFamily),
        eq(table.source_binding_key, args.sourceBindingKey),
      ),
    )
    .orderBy(desc(table.created_at));
}

/**
 * The newest usable grant for this (processor, source binding), or null
 * when none is active and unexpired.
 */
export async function getActiveGrant(
  db: DbHandle,
  args: {
    tenantId: string;
    processorConfigId: string;
    sourceFamily: string;
    sourceBindingKey: string;
  },
): Promise<GrantRow | null> {
  const grants = await listGrants(db, args);
  const now = new Date();
  return (
    grants.find((grant) => grantInactiveReason(grant, now) === null) ?? null
  );
}

/**
 * Like getActiveGrant, but a missing/revoked/expired grant throws
 * MemoryAuthorizationError with a message that says which it was.
 */
export async function requireActiveGrant(
  db: DbHandle,
  args: {
    tenantId: string;
    processorConfigId: string;
    sourceFamily: string;
    sourceBindingKey: string;
  },
): Promise<GrantRow> {
  const grants = await listGrants(db, args);
  const now = new Date();
  const active = grants.find(
    (grant) => grantInactiveReason(grant, now) === null,
  );
  if (active) return active;

  const binding = `${args.sourceFamily}:${args.sourceBindingKey}`;
  if (grants.length === 0) {
    throw new MemoryAuthorizationError(
      `no memory-source authorization grant exists for processor ${args.processorConfigId} and source '${binding}' — an operator must grant access before ingestion runs`,
    );
  }
  const reason = grantInactiveReason(grants[0]!, now) ?? "inactive";
  throw new MemoryAuthorizationError(
    `the memory-source authorization for processor ${args.processorConfigId} and source '${binding}' is ${reason} — re-grant access before ingestion runs`,
  );
}

/**
 * Revoke a grant: status 'revoked', revoked_at now, grant_version bumped.
 * Returns the updated row, or null when no such grant exists in the tenant.
 * `revokedByUserId` is accepted for call-site audit intent; the table has
 * no revoked_by column yet, so it is not persisted.
 */
export async function revokeGrant(
  db: DbHandle,
  args: { tenantId: string; grantId: string; revokedByUserId?: string },
): Promise<GrantRow | null> {
  const table = dbSchema.memorySourceAuthorizations;
  const [row] = await db
    .update(table)
    .set({
      status: "revoked",
      revoked_at: new Date(),
      grant_version: sql`${table.grant_version} + 1`,
      updated_at: new Date(),
    })
    .where(and(eq(table.id, args.grantId), eq(table.tenant_id, args.tenantId)))
    .returning();
  return row ?? null;
}
