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
 * Boundary schemas (Codex U2 P1): the grant envelope is only meaningful over
 * an explicit, per-source-family list of governed dimensions. Each dimension
 * has a comparison kind and a DEFAULT that mirrors the value the runtime
 * uses when the dimension is omitted — so an omitted grant key means "the
 * default allowance", never "unlimited", and an omitted config key still
 * requests the runtime default rather than slipping under the check.
 */
export type BoundaryDimension =
  /** Numeric ceiling: requested must be a finite number <= allowance. */
  | { kind: "cap"; default: number }
  /** Allowlist: requested must be an array whose elements all appear. */
  | { kind: "allowlist"; default: readonly unknown[] };

export type BoundarySchema = Record<string, BoundaryDimension>;

/**
 * Defaults track the runtime fallbacks in stages.ts / snapshots.ts
 * (DEFAULT_MAX_RECORDS, DEFAULT_PAGE_SIZE, DEFAULT_EVIDENCE_BATCH,
 * DEFAULT_SNAPSHOT_TTL_DAYS) and the single acquired partition 'companies'.
 * New source families register their schema here; a family without a
 * schema fails closed in assertBoundaryWithin.
 */
export const BOUNDARY_SCHEMAS: Record<string, BoundarySchema> = {
  twenty: {
    maxRecords: { kind: "cap", default: 200 },
    pageSize: { kind: "cap", default: 50 },
    projectBatch: { kind: "cap", default: 25 },
    retainBatch: { kind: "cap", default: 25 },
    snapshotTtlDays: { kind: "cap", default: 30 },
    objects: { kind: "allowlist", default: ["companies"] },
  },
};

/**
 * PURE: assert the processor's source-config boundary is WITHIN the grant
 * envelope, compared over the family's governed dimensions using EFFECTIVE
 * values: a side that omits a dimension gets the schema default (fail
 * closed) — an empty grant allows exactly the defaults, not everything.
 * Unknown or non-comparable keys in the REQUESTED boundary throw; grant
 * keys outside the schema grant nothing and are ignored. `sourceFamily`
 * is REQUIRED so a future family without a registered schema fails closed
 * instead of silently evaluating under another family's policy. Throws
 * MemoryAuthorizationError naming the violating key.
 */
export function assertBoundaryWithin(
  grantBoundary: Record<string, unknown>,
  configBoundary: Record<string, unknown>,
  options: { sourceFamily: string },
): void {
  const sourceFamily = options?.sourceFamily;
  const schema = sourceFamily ? BOUNDARY_SCHEMAS[sourceFamily] : undefined;
  if (!schema) {
    throw new MemoryAuthorizationError(
      `no boundary schema is registered for source family '${sourceFamily}' — refusing to compare boundaries`,
    );
  }

  for (const key of Object.keys(configBoundary)) {
    if (!(key in schema)) {
      throw new MemoryAuthorizationError(
        `source-config boundary key '${key}' is not a governed dimension for source family '${sourceFamily}'`,
      );
    }
  }

  for (const [key, dimension] of Object.entries(schema)) {
    const allowance =
      key in grantBoundary ? grantBoundary[key] : dimension.default;
    const requested =
      key in configBoundary ? configBoundary[key] : dimension.default;

    if (dimension.kind === "cap") {
      if (typeof allowance !== "number" || !Number.isFinite(allowance)) {
        throw new MemoryAuthorizationError(
          `grant boundary key '${key}' (${JSON.stringify(allowance)}) is not a finite number — re-issue the grant`,
        );
      }
      if (
        typeof requested !== "number" ||
        !Number.isFinite(requested) ||
        requested > allowance
      ) {
        throw new MemoryAuthorizationError(
          `source-config boundary key '${key}' (${JSON.stringify(requested)}) exceeds the grant envelope cap ${allowance}`,
        );
      }
      continue;
    }

    if (!Array.isArray(allowance)) {
      throw new MemoryAuthorizationError(
        `grant boundary key '${key}' (${JSON.stringify(allowance)}) is not an allowlist array — re-issue the grant`,
      );
    }
    if (!Array.isArray(requested)) {
      throw new MemoryAuthorizationError(
        `source-config boundary key '${key}' (${JSON.stringify(requested)}) must be an array subset of the grant allowlist`,
      );
    }
    const allowed = new Set(allowance.map((item) => JSON.stringify(item)));
    for (const item of requested) {
      if (!allowed.has(JSON.stringify(item))) {
        throw new MemoryAuthorizationError(
          `source-config boundary key '${key}' includes ${JSON.stringify(item)}, which is outside the grant allowlist`,
        );
      }
    }
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
 * Codex U2 #2: re-check the SAME grant immediately before a provider page
 * read. The grant must still exist, still be active/unexpired, and still be
 * the same grant_version the run started with — a revoke, expiry, or
 * boundary re-issue between pages stops the very next page read. Throws
 * MemoryAuthorizationError; callers must not advance the checkpoint for an
 * unread page.
 */
export async function revalidateGrant(
  db: DbHandle,
  args: { tenantId: string; grantId: string; expectedGrantVersion: number },
): Promise<void> {
  const table = dbSchema.memorySourceAuthorizations;
  const [row] = await db
    .select()
    .from(table)
    .where(and(eq(table.id, args.grantId), eq(table.tenant_id, args.tenantId)))
    .limit(1);
  if (!row) {
    throw new MemoryAuthorizationError(
      `authorization grant ${args.grantId} no longer exists — acquisition stopped before the next page`,
    );
  }
  const reason = grantInactiveReason(row, new Date());
  if (reason !== null) {
    throw new MemoryAuthorizationError(
      `authorization grant ${args.grantId} is ${reason} — acquisition stopped before the next page`,
    );
  }
  if (row.grant_version !== args.expectedGrantVersion) {
    throw new MemoryAuthorizationError(
      `authorization grant ${args.grantId} changed (version ${row.grant_version}, run started with ${args.expectedGrantVersion}) — acquisition stopped; the next run re-reads the new boundary`,
    );
  }
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
