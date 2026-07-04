/**
 * DB-backed AgentLoop dispatch ledger (THINK-137 U2).
 *
 * One Drizzle implementation of `AgentLoopDispatchLedger` adopted by BOTH
 * the scheduled path (job-trigger Lambda) and the manual path (graphql-http
 * `triggerAgentLoopRun` mutation), plus the caller helpers those two paths
 * used to each duplicate. The pure-DB ledger methods live here; the only
 * call-site-specific hook — `runRoutineAction`, which RequestResponse-invokes
 * the routine-exec-git Lambda — stays injectable (job-trigger wires it;
 * graphql-http defers the continuation to job-trigger, KTD-3).
 *
 * This module lives in @thinkwork/database-pg rather than
 * @thinkwork/agent-loops-core because it needs the Drizzle schema tables and
 * the `Database` handle; agent-loops-core is dependency-pure and is already a
 * dependency OF database-pg, so importing it back would be a cycle. It is
 * re-exported from the package root so both call sites import it alongside
 * their existing @thinkwork/database-pg imports.
 */

import { and, eq, sql } from "drizzle-orm";
import type {
  AgentLoopDispatchLedger,
  AgentLoopRunRepairState,
  AgentLoopRunStatus,
} from "@thinkwork/agent-loops-core";
import type { Database } from "./db";
import {
  agentLoopIterations,
  agentLoopRuns,
  agentLoops,
  agentWakeupRequests,
  agents,
  spaces,
} from "./schema/index";

/**
 * Call-site-specific hooks the shared ledger cannot own. `runRoutineAction`
 * invokes the routine-exec-git Lambda (an AWS SDK call, not a DB write), so
 * only the runtime that can reach that Lambda supplies it.
 */
export interface DbAgentLoopLedgerHooks {
  runRoutineAction?: AgentLoopDispatchLedger["runRoutineAction"];
}

/**
 * Build the DB-backed ledger. `db` is the shared Drizzle client — both the
 * Lambda's `getDb()` result and the api's exported `db` are the same
 * `Database` type, so a single implementation serves both.
 */
export function createDbAgentLoopLedger(
  db: Database,
  hooks?: DbAgentLoopLedgerHooks,
): AgentLoopDispatchLedger {
  const ledger: AgentLoopDispatchLedger = {
    async findRunByIdempotencyKey(input) {
      const [row] = await db
        .select({ id: agentLoopRuns.id, status: agentLoopRuns.status })
        .from(agentLoopRuns)
        .where(
          and(
            eq(agentLoopRuns.tenant_id, input.tenantId),
            eq(agentLoopRuns.idempotency_key, input.idempotencyKey),
          ),
        )
        .limit(1);
      return row
        ? { id: row.id, status: row.status as AgentLoopRunStatus }
        : null;
    },

    async loadRunRepairState(input) {
      return loadAgentLoopRunRepairState(db, input.tenantId, input.runId);
    },

    async createRun(input) {
      const [row] = await db
        .insert(agentLoopRuns)
        .values({
          tenant_id: input.tenantId,
          agent_loop_id: input.agentLoopId,
          agent_loop_version_id: input.agentLoopVersionId ?? null,
          status: input.status,
          trigger_family: input.triggerFamily,
          trigger_source: input.triggerSource,
          scheduled_job_id: input.scheduledJobId ?? null,
          actor_type: input.actorType ?? null,
          actor_id: input.actorId ?? null,
          idempotency_key: input.idempotencyKey ?? null,
          correlation_id: input.correlationId,
          current_iteration: input.currentIteration,
          policy_snapshot: input.policySnapshot,
          input_summary: input.inputSummary,
          error_code: input.errorCode ?? null,
          error_message: input.errorMessage ?? null,
          last_event_at: input.now,
          created_at: input.now,
          updated_at: input.now,
        })
        .returning({ id: agentLoopRuns.id, status: agentLoopRuns.status });
      return { id: row.id, status: row.status as AgentLoopRunStatus };
    },

    async createIteration(input) {
      const [row] = await db
        .insert(agentLoopIterations)
        .values({
          tenant_id: input.tenantId,
          agent_loop_run_id: input.runId,
          iteration_number: input.iterationNumber,
          status: input.status,
          goal_mode_action: input.goalModeAction,
          input_summary: input.inputSummary,
          error_code: input.errorCode ?? null,
          error_message: input.errorMessage ?? null,
          created_at: input.now,
          updated_at: input.now,
        })
        .returning({ id: agentLoopIterations.id });
      return { id: row.id };
    },

    async enqueueWakeup(input) {
      // Lookup-or-insert on (tenant_id, idempotency_key). The per-run key is
      // `agent-loop:${runId}:iteration:1`, so a repair after a crash between
      // the wakeup insert and markIterationWakeup finds the already-inserted
      // wakeup row and records it on the iteration instead of enqueueing a
      // second dispatch. On the happy path no such row exists, so this
      // inserts exactly as before (byte-identical row shape).
      const [existing] = await db
        .select({ id: agentWakeupRequests.id })
        .from(agentWakeupRequests)
        .where(
          and(
            eq(agentWakeupRequests.tenant_id, input.tenantId),
            eq(agentWakeupRequests.idempotency_key, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) return { id: existing.id };

      const [row] = await db
        .insert(agentWakeupRequests)
        .values({
          tenant_id: input.tenantId,
          agent_id: input.agentId,
          source: input.source,
          trigger_detail: input.triggerDetail,
          reason: input.reason,
          payload: input.payload,
          status: "queued",
          idempotency_key: input.idempotencyKey,
          requested_by_actor_type: input.requestedByActorType ?? null,
          requested_by_actor_id: input.requestedByActorId ?? null,
          requested_at: input.now,
          created_at: input.now,
        })
        .returning({ id: agentWakeupRequests.id });
      return { id: row.id };
    },

    async markIterationWakeup(input) {
      await db
        .update(agentLoopIterations)
        .set({
          agent_wakeup_request_id: input.wakeupId,
          updated_at: input.now,
        })
        .where(eq(agentLoopIterations.id, input.iterationId));
    },

    async markDispatchFailed(input) {
      await db
        .update(agentLoopRuns)
        .set({
          status: "failed",
          error_code: input.errorCode,
          error_message: input.errorMessage,
          finished_at: input.now,
          last_event_at: input.now,
          updated_at: input.now,
        })
        .where(eq(agentLoopRuns.id, input.runId));
      await db
        .update(agentLoopIterations)
        .set({
          status: "failed",
          error_code: input.errorCode,
          error_message: input.errorMessage,
          finished_at: input.now,
          updated_at: input.now,
        })
        .where(eq(agentLoopIterations.id, input.iterationId));
    },

    async updateLoopAfterDispatch(input) {
      await db
        .update(agentLoops)
        .set({
          last_run_id: input.runId,
          last_run_status: input.status,
          last_run_at: input.now,
          last_run_summary: {
            triggerFamily: input.triggerFamily,
            currentIteration: input.currentIteration,
            ...input.summary,
          },
          updated_at: input.now,
        })
        .where(eq(agentLoops.id, input.loopId));
    },

    async recordRoutineActionResults(input) {
      // Merge into the iteration record so the resume-turn payload path
      // re-injects the same results (payload parity).
      await db
        .update(agentLoopIterations)
        .set({
          input_summary: sql`coalesce(${agentLoopIterations.input_summary}, '{}'::jsonb) || ${JSON.stringify(
            { routineActionResults: input.results },
          )}::jsonb`,
          updated_at: input.now,
        })
        .where(eq(agentLoopIterations.id, input.iterationId));
    },

    async completeRoutineOnlyRun(input) {
      const outcome = {
        source: "routine_actions",
        routineActions: {
          total: input.results.length,
          failed: input.results.filter((r) => r.status !== "succeeded").length,
        },
      };
      await db
        .update(agentLoopIterations)
        .set({
          status: input.status === "completed" ? "completed" : "failed",
          output_summary: outcome,
          finished_at: input.now,
          updated_at: input.now,
        })
        .where(eq(agentLoopIterations.id, input.iterationId));
      await db
        .update(agentLoopRuns)
        .set({
          status: input.status,
          output_summary: outcome,
          finished_at: input.now,
          last_event_at: input.now,
          updated_at: input.now,
        })
        .where(eq(agentLoopRuns.id, input.runId));
    },
  };

  // Call-site-specific hook — only the runtime that can invoke the
  // routine-exec-git Lambda supplies it (job-trigger). graphql-http omits it
  // and defers the continuation to job-trigger.
  if (hooks?.runRoutineAction) {
    ledger.runRoutineAction = hooks.runRoutineAction;
  }

  return ledger;
}

// ---------------------------------------------------------------------------
// Shared caller helpers (formerly duplicated in job-trigger and the mutation)
// ---------------------------------------------------------------------------

export async function findAgentLoopRunByIdempotencyKey(
  db: Database,
  tenantId: string,
  idempotencyKey: string,
): Promise<{ id: string; status: string } | null> {
  const [row] = await db
    .select({ id: agentLoopRuns.id, status: agentLoopRuns.status })
    .from(agentLoopRuns)
    .where(
      and(
        eq(agentLoopRuns.tenant_id, tenantId),
        eq(agentLoopRuns.idempotency_key, idempotencyKey),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Loads the side-effect completeness of a run: its status plus whether its
 * first iteration recorded a wakeup id. Used by both the ledger's
 * `loadRunRepairState` (dispatch's reuse-vs-repair decision) and the call
 * sites' pre-dispatch checks.
 */
export async function loadAgentLoopRunRepairState(
  db: Database,
  tenantId: string,
  runId: string,
): Promise<AgentLoopRunRepairState | null> {
  const [run] = await db
    .select({ id: agentLoopRuns.id, status: agentLoopRuns.status })
    .from(agentLoopRuns)
    .where(
      and(eq(agentLoopRuns.tenant_id, tenantId), eq(agentLoopRuns.id, runId)),
    )
    .limit(1);
  if (!run) return null;
  const [iteration] = await db
    .select({
      id: agentLoopIterations.id,
      wakeupId: agentLoopIterations.agent_wakeup_request_id,
    })
    .from(agentLoopIterations)
    .where(
      and(
        eq(agentLoopIterations.agent_loop_run_id, runId),
        eq(agentLoopIterations.iteration_number, 1),
      ),
    )
    .limit(1);
  return {
    status: run.status as AgentLoopRunStatus,
    iterationId: iteration?.id ?? null,
    hasWakeup: Boolean(iteration?.wakeupId),
  };
}

export async function loadActiveSpaceId(
  db: Database,
  tenantId: string,
  spaceId: string,
): Promise<string | null> {
  const [space] = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(
      and(
        eq(spaces.id, spaceId),
        eq(spaces.tenant_id, tenantId),
        eq(spaces.status, "active"),
      ),
    )
    .limit(1);
  return space?.id ?? null;
}

export async function loadAgentDefaultSpaceId(
  db: Database,
  tenantId: string,
  agentId: string,
): Promise<string | null> {
  const [agent] = await db
    .select({ runtimeConfig: agents.runtime_config })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.tenant_id, tenantId)))
    .limit(1);
  const defaultSpaceId = defaultSpaceIdFromRuntimeConfig(agent?.runtimeConfig);
  if (!defaultSpaceId) return null;
  return loadActiveSpaceId(db, tenantId, defaultSpaceId);
}

function defaultSpaceIdFromRuntimeConfig(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const defaultSpaceId = (value as { defaultSpaceId?: unknown }).defaultSpaceId;
  return typeof defaultSpaceId === "string" && defaultSpaceId.trim()
    ? defaultSpaceId
    : null;
}
