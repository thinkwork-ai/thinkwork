/**
 * Repository for external-memory-source configs and checkpoints
 * (THINK-193 U1).
 *
 * Checkpoint advancement is compare-and-swap on an integer `version` column:
 * two concurrent workers on the same partition cannot both advance — the
 * loser's UPDATE matches zero rows and it must re-read before retrying.
 */

import { and, eq, sql } from "drizzle-orm";
import {
  memoryProcessorConfigs,
  memorySourceCheckpoints,
  memorySourceConfigs,
  spaces,
} from "@thinkwork/database-pg/schema";

import type {
  DbHandle,
  MemoryProcessorConfig,
  MemorySourceConfig,
  SharedTargetScope,
  SourceCheckpoint,
} from "./types.js";

/** Thrown when a processor is not eligible to write shared memory (R11/AE7). */
export class MemoryScopeError extends Error {
  readonly name = "MemoryScopeError";
}

/** Thrown when a checkpoint CAS advance loses to a concurrent writer. */
export class CheckpointConflictError extends Error {
  readonly name = "CheckpointConflictError";
}

export async function getProcessorConfig(
  db: DbHandle,
  args: { tenantId: string; processorConfigId: string },
): Promise<MemoryProcessorConfig | null> {
  const [row] = await db
    .select()
    .from(memoryProcessorConfigs)
    .where(
      and(
        eq(memoryProcessorConfigs.id, args.processorConfigId),
        eq(memoryProcessorConfigs.tenant_id, args.tenantId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getSourceConfig(
  db: DbHandle,
  args: { tenantId: string; sourceConfigId: string },
): Promise<{
  source: MemorySourceConfig;
  processor: MemoryProcessorConfig;
} | null> {
  const [row] = await db
    .select({
      source: memorySourceConfigs,
      processor: memoryProcessorConfigs,
    })
    .from(memorySourceConfigs)
    .innerJoin(
      memoryProcessorConfigs,
      eq(memorySourceConfigs.processor_config_id, memoryProcessorConfigs.id),
    )
    .where(
      and(
        eq(memorySourceConfigs.id, args.sourceConfigId),
        eq(memorySourceConfigs.tenant_id, args.tenantId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * R11/AE7 guard: external ingestion may only write shared (space/tenant)
 * memory. Personal-mode processors and user-scope targets are rejected
 * before any acquisition work happens.
 */
export function assertSharedScope(
  processor: Pick<MemoryProcessorConfig, "id" | "mode" | "target_scope">,
): asserts processor is Pick<
  MemoryProcessorConfig,
  "id" | "mode" | "target_scope"
> & { mode: "shared"; target_scope: SharedTargetScope } {
  if (processor.mode !== "shared") {
    throw new MemoryScopeError(
      `processor ${processor.id} has mode '${processor.mode}' — external memory sources require mode 'shared'`,
    );
  }
  if (
    processor.target_scope !== "space" &&
    processor.target_scope !== "tenant"
  ) {
    throw new MemoryScopeError(
      `processor ${processor.id} targets scope '${processor.target_scope}' — shared ingestion may only target 'space' or 'tenant' banks`,
    );
  }
}

/**
 * Verify the processor's target actually belongs to its tenant before any
 * bank write (R11): a `tenant` target must be the processor's own tenant id,
 * and a `space` target must be a space row owned by that tenant. Without
 * this, a mis-seeded target_id would concatenate into ANOTHER tenant's
 * `tenant_<uuid>`/`space_<uuid>` bank.
 */
export async function assertTargetInTenant(
  db: DbHandle,
  processor: Pick<
    MemoryProcessorConfig,
    "id" | "tenant_id" | "target_scope" | "target_id"
  >,
): Promise<void> {
  if (processor.target_scope === "tenant") {
    if (processor.target_id !== processor.tenant_id) {
      throw new MemoryScopeError(
        `processor ${processor.id} targets tenant ${processor.target_id} but belongs to tenant ${processor.tenant_id}`,
      );
    }
    return;
  }
  if (processor.target_scope === "space") {
    const [space] = await db
      .select({ id: spaces.id })
      .from(spaces)
      .where(
        and(
          eq(spaces.id, processor.target_id),
          eq(spaces.tenant_id, processor.tenant_id),
        ),
      )
      .limit(1);
    if (!space) {
      throw new MemoryScopeError(
        `processor ${processor.id} targets space ${processor.target_id}, which does not belong to tenant ${processor.tenant_id}`,
      );
    }
    return;
  }
  throw new MemoryScopeError(
    `processor ${processor.id} targets scope '${processor.target_scope}' — shared ingestion may only target 'space' or 'tenant' banks`,
  );
}

/** Hindsight bank id for the processor's target, e.g. `tenant_<uuid>`. */
export function resolveTargetBankId(
  processor: Pick<MemoryProcessorConfig, "target_scope" | "target_id">,
): string {
  return `${processor.target_scope}_${processor.target_id}`;
}

export async function getCheckpoint(
  db: DbHandle,
  args: { sourceConfigId: string; partitionKey: string },
): Promise<SourceCheckpoint | null> {
  const [row] = await db
    .select()
    .from(memorySourceCheckpoints)
    .where(
      and(
        eq(memorySourceCheckpoints.source_config_id, args.sourceConfigId),
        eq(memorySourceCheckpoints.partition_key, args.partitionKey),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Insert the checkpoint row if missing (version 0, empty cursor); returns
 * the current row either way. Concurrent creators race harmlessly via
 * ON CONFLICT DO NOTHING on the (source_config_id, partition_key) unique.
 */
export async function ensureCheckpoint(
  db: DbHandle,
  args: { tenantId: string; sourceConfigId: string; partitionKey: string },
): Promise<SourceCheckpoint> {
  const [inserted] = await db
    .insert(memorySourceCheckpoints)
    .values({
      tenant_id: args.tenantId,
      source_config_id: args.sourceConfigId,
      partition_key: args.partitionKey,
      cursor: {},
      version: 0,
    })
    .onConflictDoNothing({
      target: [
        memorySourceCheckpoints.source_config_id,
        memorySourceCheckpoints.partition_key,
      ],
    })
    .returning();
  if (inserted) return inserted;
  const existing = await getCheckpoint(db, args);
  if (!existing) {
    throw new Error(
      `checkpoint for source ${args.sourceConfigId} partition '${args.partitionKey}' vanished between insert and read`,
    );
  }
  return existing;
}

/**
 * Compare-and-swap cursor advance. Matches only when `version` still equals
 * `expectedVersion`; on success bumps version and returns the updated row.
 * Returns null when the CAS loses (no row matched) — callers inside a
 * transaction should treat that as a conflict and roll back.
 */
export async function advanceCheckpoint(
  tx: DbHandle,
  args: {
    sourceConfigId: string;
    partitionKey: string;
    expectedVersion: number;
    cursor: Record<string, unknown>;
  },
): Promise<SourceCheckpoint | null> {
  const [row] = await tx
    .update(memorySourceCheckpoints)
    .set({
      cursor: args.cursor,
      version: sql`${memorySourceCheckpoints.version} + 1`,
      last_advanced_at: sql`now()`,
      updated_at: sql`now()`,
    })
    .where(
      and(
        eq(memorySourceCheckpoints.source_config_id, args.sourceConfigId),
        eq(memorySourceCheckpoints.partition_key, args.partitionKey),
        eq(memorySourceCheckpoints.version, args.expectedVersion),
      ),
    )
    .returning();
  return row ?? null;
}
