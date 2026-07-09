/**
 * Run-derived acting user + run context for scheduled document emission
 * (THINK-155 U1/U3).
 *
 * Scheduled turns have no triggering user message, so THINK-147's acting-user
 * derivation yields null and finalize-into-space is rejected. This resolver
 * gives emission a second SERVER-SIDE derivation source: the automation's
 * run-as identity (THINK-137 — `agent_loops.run_as_user_id`, default the
 * creator), resolved from the turn in the database, never from the callback
 * payload.
 *
 * Mapping: `agent_loop_iterations` by (tenant_id, thread_turn_id) — stamped at
 * dispatch by `linkAgentLoopIterationTurn` — → `agent_loop_runs` →
 * `agent_loops`. The acting user is populated only when the run-as user
 * passes an active tenant-membership cross-check (THINK-137 R5 discipline: a
 * narrow service path, never a widened `resolveCaller`); a stale or removed
 * run-as reference yields a context with `actingUserId: null` so the existing
 * finalize guard fires — while the run identity stays available for failure
 * observability (U3 inbox items).
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agentLoopIterations,
  agentLoopRuns,
  agentLoops,
  tenantMembers,
  threadTurns,
  workflowRuns,
  workflows,
} from "@thinkwork/database-pg/schema";

/** The automation run a turn belongs to, plus its membership-checked run-as user. */
export interface TurnRunContext {
  runId: string;
  agentLoopId: string;
  loopName: string | null;
  /** Membership-checked `agent_loops.run_as_user_id`; null when unset or stale. */
  actingUserId: string | null;
  /**
   * THINK-227 U2: which runner produced this turn. `agent_loop` = the legacy
   * iteration ledger; `workflow` = a converged interpreter run whose workflow
   * links back to the automation via `workflows.source_agent_loop_id` (U13).
   * On the workflow branch `runId` is the WORKFLOW run id.
   */
  runKind: "agent_loop" | "workflow";
}

interface TurnRunRow {
  runId: string;
  agentLoopId: string;
  loopName: string | null;
  runAsUserId: string | null;
}

/** Injectable query seam so the composition logic is testable without a DB. */
export interface RunActingUserQueries {
  /** The run linked to this turn, or null when the turn has no run linkage. */
  findRunForTurn(input: {
    tenantId: string;
    turnId: string;
  }): Promise<TurnRunRow | null>;
  /**
   * THINK-227 U2: the converged-runner equivalent — a turn dispatched by a
   * workflow agent step (context_snapshot.workflowRun.runId) whose workflow
   * converged from an automation. Null for plain workflows with no source
   * automation (they have no run-as identity or binding to derive).
   */
  findWorkflowRunForTurn(input: {
    tenantId: string;
    turnId: string;
  }): Promise<TurnRunRow | null>;
  /** True when the user holds an active `tenant_members` row on the tenant. */
  isActiveTenantMember(input: {
    tenantId: string;
    userId: string;
  }): Promise<boolean>;
}

export function drizzleRunActingUserQueries(): RunActingUserQueries {
  return {
    findRunForTurn: async ({ tenantId, turnId }) => {
      const rows = await getDb()
        .select({
          runId: agentLoopRuns.id,
          agentLoopId: agentLoops.id,
          loopName: agentLoops.name,
          runAsUserId: agentLoops.run_as_user_id,
        })
        .from(agentLoopIterations)
        .innerJoin(
          agentLoopRuns,
          eq(agentLoopIterations.agent_loop_run_id, agentLoopRuns.id),
        )
        .innerJoin(agentLoops, eq(agentLoopRuns.agent_loop_id, agentLoops.id))
        .where(
          and(
            eq(agentLoopIterations.tenant_id, tenantId),
            eq(agentLoopIterations.thread_turn_id, turnId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    findWorkflowRunForTurn: async ({ tenantId, turnId }) => {
      // The workflow-step wakeup payload spreads into the turn's
      // context_snapshot, so the run linkage is the snapshot's
      // workflowRun.runId (same source workflow-step-finalize consumes).
      const [turn] = await getDb()
        .select({ context_snapshot: threadTurns.context_snapshot })
        .from(threadTurns)
        .where(
          and(eq(threadTurns.id, turnId), eq(threadTurns.tenant_id, tenantId)),
        )
        .limit(1);
      const snapshot =
        turn?.context_snapshot && typeof turn.context_snapshot === "object"
          ? (turn.context_snapshot as Record<string, unknown>)
          : null;
      const workflowRun =
        snapshot?.workflowRun && typeof snapshot.workflowRun === "object"
          ? (snapshot.workflowRun as Record<string, unknown>)
          : null;
      const workflowRunId =
        typeof workflowRun?.runId === "string" ? workflowRun.runId : null;
      if (!workflowRunId) return null;

      const rows = await getDb()
        .select({
          runId: workflowRuns.id,
          agentLoopId: agentLoops.id,
          loopName: agentLoops.name,
          runAsUserId: agentLoops.run_as_user_id,
        })
        .from(workflowRuns)
        .innerJoin(workflows, eq(workflowRuns.workflow_id, workflows.id))
        .innerJoin(
          agentLoops,
          eq(workflows.source_agent_loop_id, agentLoops.id),
        )
        .where(
          and(
            eq(workflowRuns.id, workflowRunId),
            eq(workflowRuns.tenant_id, tenantId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    isActiveTenantMember: async ({ tenantId, userId }) => {
      const rows = await getDb()
        .select({ status: tenantMembers.status })
        .from(tenantMembers)
        .where(
          and(
            eq(tenantMembers.tenant_id, tenantId),
            eq(tenantMembers.principal_type, "user"),
            eq(tenantMembers.principal_id, userId),
          ),
        )
        .limit(1);
      return rows[0]?.status === "active";
    },
  };
}

/**
 * Resolve the automation-run context for a turn. Returns null when the turn
 * has no run linkage (plain human/chat turns). `actingUserId` is null when
 * the run's automation carries no run-as user or that user fails the
 * tenant-membership cross-check.
 */
export async function resolveTurnRunContext(
  input: { tenantId: string; turnId: string },
  queries: RunActingUserQueries = drizzleRunActingUserQueries(),
): Promise<TurnRunContext | null> {
  let runKind: TurnRunContext["runKind"] = "agent_loop";
  let run = await queries.findRunForTurn(input);
  if (!run) {
    // THINK-227 U2: converged automations run on the interpreter — the turn
    // links through the workflow run instead of an agent-loop iteration, but
    // the run-as identity, binding enforcement, keep-last-good ordering, and
    // refresh stamps must behave identically on both runners.
    run = await queries.findWorkflowRunForTurn(input);
    if (!run) return null;
    runKind = "workflow";
  }
  let actingUserId: string | null = null;
  if (run.runAsUserId) {
    const isMember = await queries.isActiveTenantMember({
      tenantId: input.tenantId,
      userId: run.runAsUserId,
    });
    if (isMember) actingUserId = run.runAsUserId;
  }
  return {
    runId: run.runId,
    agentLoopId: run.agentLoopId,
    loopName: run.loopName,
    actingUserId,
    runKind,
  };
}
