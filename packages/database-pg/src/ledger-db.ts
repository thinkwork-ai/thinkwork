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

import { and, eq, gte, inArray, sql } from "drizzle-orm";
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
  inboxItems,
  spaces,
  users,
} from "./schema/index";

/** Non-terminal run statuses that count against the R11 concurrency cap
 * (THINK-137 U4). Terminal statuses (completed/failed/budget_stopped/
 * escalated/canceled/skipped) do not. */
const ACTIVE_RUN_STATUSES = [
  "queued",
  "running",
  "waiting_for_human",
] as const;

/** Inbox-item type + open status for headless-run failures (R10). One OPEN
 * (pending) item per automation; resolving it (any non-pending status) lets a
 * later failure raise a fresh item. Mirrors routine-exec-git's
 * `routine_infra_failure` dedup pattern. */
const HEADLESS_FAILURE_INBOX_TYPE = "automation_headless_failure";
const INBOX_OPEN_STATUS = "pending";

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

    async loadUserTenantId(input) {
      // R5 run-as cross-check (THINK-137 U5). Same shape as
      // startSkillRunService's invoker lookup (KTD3): return the user's tenant
      // so the dispatcher can reject a cross-tenant run-as identity. Null when
      // the user does not exist.
      const [row] = await db
        .select({ tenantId: users.tenant_id })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      return row?.tenantId ?? null;
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

    async countActiveRuns(input) {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(agentLoopRuns)
        .where(
          and(
            eq(agentLoopRuns.tenant_id, input.tenantId),
            eq(agentLoopRuns.agent_loop_id, input.agentLoopId),
            inArray(agentLoopRuns.status, [...ACTIVE_RUN_STATUSES]),
          ),
        );
      return Number(row?.count ?? 0);
    },

    async sumMonthlyCostCents(input) {
      // WIRED-BUT-INERT: total_cost_usd_cents is never written yet, so this
      // COALESCEs to 0 today. The query is correct for when cost accounting
      // lands (THINK-137 U4).
      const [row] = await db
        .select({
          total: sql<number>`coalesce(sum(${agentLoopRuns.total_cost_usd_cents}), 0)::bigint`,
        })
        .from(agentLoopRuns)
        .where(
          and(
            eq(agentLoopRuns.tenant_id, input.tenantId),
            eq(agentLoopRuns.agent_loop_id, input.agentLoopId),
            gte(agentLoopRuns.created_at, input.monthStart),
          ),
        );
      return Number(row?.total ?? 0);
    },

    async raiseHeadlessFailureItem(input) {
      // One OPEN item per automation. A repeat failure UPDATES the existing
      // pending item (failureCount++, lastFailureAt) rather than spamming the
      // inbox; a new item is raised only after the prior one is resolved
      // (status left pending here, moved off by the inbox decide/cancel flow).
      const [pending] = await db
        .select({ id: inboxItems.id, config: inboxItems.config })
        .from(inboxItems)
        .where(
          and(
            eq(inboxItems.tenant_id, input.tenantId),
            eq(inboxItems.type, HEADLESS_FAILURE_INBOX_TYPE),
            eq(inboxItems.entity_id, input.agentLoopId),
            eq(inboxItems.status, INBOX_OPEN_STATUS),
          ),
        )
        .limit(1);
      const description = `${input.errorCode}: ${input.errorMessage}`.slice(
        0,
        2000,
      );
      if (pending) {
        const prevConfig =
          pending.config && typeof pending.config === "object"
            ? (pending.config as Record<string, unknown>)
            : {};
        const prevCount = Number(prevConfig.failureCount ?? 1);
        await db
          .update(inboxItems)
          .set({
            description,
            config: {
              ...prevConfig,
              runId: input.runId,
              errorCode: input.errorCode,
              errorMessage: input.errorMessage,
              failureCount: prevCount + 1,
              lastFailureAt: input.now.toISOString(),
            },
            updated_at: input.now,
          })
          .where(eq(inboxItems.id, pending.id));
        return;
      }
      await db.insert(inboxItems).values({
        tenant_id: input.tenantId,
        type: HEADLESS_FAILURE_INBOX_TYPE,
        status: INBOX_OPEN_STATUS,
        title: `Automation failed: ${input.loopName ?? input.agentLoopId}`,
        description,
        entity_type: "agent_loop",
        entity_id: input.agentLoopId,
        config: {
          runId: input.runId,
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          failureCount: 1,
          lastFailureAt: input.now.toISOString(),
        },
      });
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
