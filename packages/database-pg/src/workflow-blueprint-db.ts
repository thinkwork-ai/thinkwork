/**
 * Lazy blueprint version ensure for managed Memory Workflows (THINK-193 U3).
 *
 * Blueprint-managed workflows (one per memory processor) carry
 * {blueprintKey, blueprintVersion, processorConfigId} in
 * workflow_versions.source_metadata. At the next run or configuration read,
 * this compares the workflow's ACTIVE version against the current code-owned
 * blueprint (agent-loops-core/memory-blueprint) and lazily supersedes/inserts
 * a new immutable version — never an atomic fan-out update across hundreds of
 * rows. In-flight runs stay pinned to the workflow_version_id they captured.
 *
 * Lives in database-pg (like workflow-interpreter-db) so BOTH packages/api
 * (triggerWorkflowRun, provisioning, configuration reads) and packages/lambda
 * (job-trigger's workflow_schedule branch) can call it without crossing the
 * lambda -> api boundary.
 */

import { and, eq, sql } from "drizzle-orm";

import {
  matchesMemoryBlueprint,
  memoryBlueprintFor,
  memoryBlueprintSourceMetadata,
  WORKFLOW_INTERPRETER_SOURCE_KIND,
} from "@thinkwork/agent-loops-core";
import { memoryProcessorConfigs, workflowVersions, workflows } from "./schema";

// Same untyped-db convention as workflow-interpreter-db: callable with either
// the resolver db or a Lambda getDb().
type WorkflowDb = any;

export interface EnsureMemoryBlueprintResult {
  /** True when this workflow is blueprint-managed (a processor points at it). */
  managed: boolean;
  /** True when a NEW version was published by this call. */
  published: boolean;
  /** The workflow's current (possibly just-published) version id, when managed. */
  versionId: string | null;
}

/**
 * Ensure a blueprint-managed workflow's current version matches the current
 * code-owned blueprint. No-op ({managed:false}) for workflows no memory
 * processor points at. Safe under concurrency: the
 * (workflow_id, version_number) unique index makes the double-insert race a
 * conflict; the loser re-reads and adopts the winner's version.
 */
export async function ensureMemoryBlueprintVersion(
  db: WorkflowDb,
  input: { tenantId: string; workflowId: string; now?: Date },
): Promise<EnsureMemoryBlueprintResult> {
  const now = input.now ?? new Date();

  const [processor] = await db
    .select({
      id: memoryProcessorConfigs.id,
      mode: memoryProcessorConfigs.mode,
      status: memoryProcessorConfigs.status,
      stage_overrides: memoryProcessorConfigs.stage_overrides,
    })
    .from(memoryProcessorConfigs)
    .where(
      and(
        eq(memoryProcessorConfigs.workflow_id, input.workflowId),
        eq(memoryProcessorConfigs.tenant_id, input.tenantId),
      ),
    )
    .limit(1);
  if (!processor || processor.status !== "active") {
    return { managed: false, published: false, versionId: null };
  }

  const blueprint = memoryBlueprintFor(
    processor.mode === "personal" ? "personal" : "shared",
  );
  // THINK-264: per-stage toggles are part of the version's identity, so a
  // flipped toggle supersedes the active version through the same lazy path a
  // blueprint bump takes.
  const overrides = processor.stage_overrides ?? null;

  const readCurrent = async (): Promise<{
    id: string;
    version_number: number;
    source_metadata: unknown;
  } | null> => {
    const [current] = await db
      .select({
        id: workflowVersions.id,
        version_number: workflowVersions.version_number,
        source_metadata: workflowVersions.source_metadata,
      })
      .from(workflowVersions)
      .where(
        and(
          eq(workflowVersions.workflow_id, input.workflowId),
          eq(workflowVersions.version_status, "active"),
        ),
      )
      .limit(1);
    return current ?? null;
  };

  const current = await readCurrent();
  if (
    current &&
    matchesMemoryBlueprint(
      current.source_metadata,
      blueprint,
      processor.id,
      overrides,
    )
  ) {
    return { managed: true, published: false, versionId: current.id };
  }

  const definition = blueprint.build(processor.id, overrides);
  const nextNumber = (current?.version_number ?? 0) + 1;
  try {
    if (current) {
      await db
        .update(workflowVersions)
        .set({ version_status: "superseded" })
        .where(eq(workflowVersions.id, current.id));
    }
    const [version] = await db
      .insert(workflowVersions)
      .values({
        tenant_id: input.tenantId,
        workflow_id: input.workflowId,
        version_number: nextNumber,
        version_status: "active",
        source_kind: WORKFLOW_INTERPRETER_SOURCE_KIND,
        source_metadata: memoryBlueprintSourceMetadata(
          blueprint,
          processor.id,
          overrides,
        ) as unknown as Record<string, unknown>,
        definition_snapshot: definition as unknown as Record<string, unknown>,
        published_at: now,
        created_at: now,
      })
      .returning({ id: workflowVersions.id });
    await db
      .update(workflows)
      .set({
        current_version_id: version.id,
        current_version_number: nextNumber,
        readiness_state: "ready",
        updated_at: now,
      })
      .where(eq(workflows.id, input.workflowId));
    return { managed: true, published: true, versionId: version.id };
  } catch (error) {
    // Concurrent-ensure race: (workflow_id, version_number) is unique — the
    // loser lands here. If the surviving active version now carries the
    // blueprint, adopt it; anything else is a real failure.
    if (isUniqueViolation(error)) {
      const survivor = await readCurrent();
      if (
        survivor &&
        matchesMemoryBlueprint(
          survivor.source_metadata,
          blueprint,
          processor.id,
          overrides,
        )
      ) {
        return { managed: true, published: false, versionId: survivor.id };
      }
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  if (code === "23505") return true;
  const message = (error as Error)?.message ?? "";
  return /duplicate key value|unique constraint/i.test(message);
}

/**
 * True when this workflow is blueprint-managed — i.e. an active memory
 * processor points at it. Used by write guards (saveWorkflow) that must not
 * let hand edits replace a platform-owned definition.
 */
export async function findMemoryProcessorForWorkflow(
  db: WorkflowDb,
  input: { tenantId: string; workflowId: string },
): Promise<{
  id: string;
  mode: string;
  target_scope: string;
  target_id: string;
  created_by_user_id: string | null;
} | null> {
  const [processor] = await db
    .select({
      id: memoryProcessorConfigs.id,
      mode: memoryProcessorConfigs.mode,
      target_scope: memoryProcessorConfigs.target_scope,
      target_id: memoryProcessorConfigs.target_id,
      created_by_user_id: memoryProcessorConfigs.created_by_user_id,
    })
    .from(memoryProcessorConfigs)
    .where(
      and(
        eq(memoryProcessorConfigs.workflow_id, input.workflowId),
        eq(memoryProcessorConfigs.tenant_id, input.tenantId),
        sql`${memoryProcessorConfigs.status} = 'active'`,
      ),
    )
    .limit(1);
  return processor ?? null;
}
