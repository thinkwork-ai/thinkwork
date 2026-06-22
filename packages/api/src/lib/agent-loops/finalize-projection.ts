import {
  AGENT_LOOP_WAKEUP_SOURCE,
  buildAgentLoopWakeupPayload,
  workerAgentId,
  type DispatchableAgentLoop,
  type DispatchableAgentLoopVersion,
} from "@thinkwork/agent-loops-core";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agentLoopEvidence,
  agentLoopIterations,
  agentLoopJudgments,
  agentLoopRuns,
  agentLoops,
  agentLoopVersions,
  agentWakeupRequests,
} from "@thinkwork/database-pg/schema";
import type { FinalizeGoalRunProjection } from "../chat-finalize/types.js";
import {
  judgeAgentLoopIteration,
  type AgentLoopJudgmentDecision,
} from "./judgment.js";

export interface AgentLoopFinalizeContext {
  runId: string;
  iterationId: string;
}

export interface ProjectAgentLoopFinalizeInput {
  tenantId: string;
  threadTurnId: string;
  contextSnapshot: unknown;
  goalRun: FinalizeGoalRunProjection | null;
  responseText: string;
  turnStatus: "completed" | "failed";
  errorMessage?: string | null;
  now?: Date;
}

export interface AgentLoopFinalizeLoadedContext {
  loop: DispatchableAgentLoop;
  version: DispatchableAgentLoopVersion;
  run: {
    id: string;
    status: string;
    currentIteration: number;
    startedAt?: Date | string | null;
  };
  iteration: {
    id: string;
    iterationNumber: number;
  };
  existingJudgmentId?: number | null;
}

export interface AgentLoopFinalizeLedger {
  loadContext(input: {
    tenantId: string;
    runId: string;
    iterationId: string;
    threadTurnId: string;
  }): Promise<AgentLoopFinalizeLoadedContext | null>;
  recordJudgment(input: {
    tenantId: string;
    runId: string;
    iterationId: string;
    judgeMode: string;
    decision: AgentLoopJudgmentDecision;
    now: Date;
  }): Promise<{ id: number }>;
  recordEvidence(input: {
    tenantId: string;
    loopId: string;
    runId: string;
    iterationId: string;
    judgmentId: number;
    threadTurnId: string;
    summary: Record<string, unknown>;
    now: Date;
  }): Promise<void>;
  updateIteration(input: {
    tenantId: string;
    iterationId: string;
    decision: AgentLoopJudgmentDecision;
    now: Date;
  }): Promise<void>;
  updateRun(input: {
    tenantId: string;
    loopId: string;
    runId: string;
    decision: AgentLoopJudgmentDecision;
    currentIteration: number;
    outputSummary: Record<string, unknown>;
    now: Date;
  }): Promise<void>;
  createNextIteration(input: {
    tenantId: string;
    runId: string;
    iterationNumber: number;
    previousIterationId: string;
    decision: AgentLoopJudgmentDecision;
    now: Date;
  }): Promise<{ id: string }>;
  enqueueNextWakeup(input: {
    tenantId: string;
    loop: DispatchableAgentLoop;
    version: DispatchableAgentLoopVersion;
    runId: string;
    iterationId: string;
    iterationNumber: number;
    now: Date;
  }): Promise<{ id: string }>;
  markIterationWakeup(input: {
    tenantId: string;
    iterationId: string;
    wakeupId: string;
    now: Date;
  }): Promise<void>;
  recordProjectionFailure(input: {
    tenantId: string;
    loopId: string;
    runId: string;
    iterationId: string;
    message: string;
    now: Date;
  }): Promise<void>;
}

export type ProjectAgentLoopFinalizeResult =
  | { status: "skipped"; reason: string }
  | { status: "already_projected"; runId: string; iterationId: string }
  | {
      status: "projected";
      runId: string;
      iterationId: string;
      outcome: string;
      runStatus: string;
      nextIterationId?: string;
      nextWakeupId?: string;
    }
  | {
      status: "projection_failed";
      runId: string;
      iterationId: string;
      errorCode: "agent_loop_projection_failed";
    };

export async function projectAgentLoopFinalize(
  input: ProjectAgentLoopFinalizeInput,
  ledger?: AgentLoopFinalizeLedger,
): Promise<ProjectAgentLoopFinalizeResult> {
  const context = agentLoopContextFromSnapshot(input.contextSnapshot);
  if (!context) {
    return { status: "skipped", reason: "not_agent_loop_turn" };
  }

  const projectionLedger = ledger ?? createDrizzleAgentLoopFinalizeLedger();
  const loaded = await projectionLedger.loadContext({
    tenantId: input.tenantId,
    runId: context.runId,
    iterationId: context.iterationId,
    threadTurnId: input.threadTurnId,
  });
  if (!loaded) {
    return { status: "skipped", reason: "agent_loop_context_not_found" };
  }
  if (loaded.existingJudgmentId) {
    return {
      status: "already_projected",
      runId: context.runId,
      iterationId: context.iterationId,
    };
  }

  const now = input.now ?? new Date();
  const decision = judgeAgentLoopIteration({
    judgeSpec: loaded.version.judgeSpec,
    loopPolicy: loaded.version.loopPolicy,
    iterationNumber: loaded.iteration.iterationNumber,
    goalRun: input.goalRun,
    responseText: input.responseText,
    turnStatus: input.turnStatus,
    errorMessage: input.errorMessage,
  });

  let nextIterationId: string | undefined;
  let nextWakeupId: string | undefined;
  try {
    const judgment = await projectionLedger.recordJudgment({
      tenantId: input.tenantId,
      runId: loaded.run.id,
      iterationId: loaded.iteration.id,
      judgeMode: loaded.version.judgeSpec.mode,
      decision,
      now,
    });
    await projectionLedger.recordEvidence({
      tenantId: input.tenantId,
      loopId: loaded.loop.id,
      runId: loaded.run.id,
      iterationId: loaded.iteration.id,
      judgmentId: judgment.id,
      threadTurnId: input.threadTurnId,
      summary: decision.evidenceSummary,
      now,
    });
    await projectionLedger.updateIteration({
      tenantId: input.tenantId,
      iterationId: loaded.iteration.id,
      decision,
      now,
    });

    const nextIterationNumber = loaded.iteration.iterationNumber + 1;
    if (decision.enqueueNextIteration) {
      const nextIteration = await projectionLedger.createNextIteration({
        tenantId: input.tenantId,
        runId: loaded.run.id,
        iterationNumber: nextIterationNumber,
        previousIterationId: loaded.iteration.id,
        decision,
        now,
      });
      nextIterationId = nextIteration.id;
      const nextWakeup = await projectionLedger.enqueueNextWakeup({
        tenantId: input.tenantId,
        loop: loaded.loop,
        version: loaded.version,
        runId: loaded.run.id,
        iterationId: nextIteration.id,
        iterationNumber: nextIterationNumber,
        now,
      });
      nextWakeupId = nextWakeup.id;
      await projectionLedger.markIterationWakeup({
        tenantId: input.tenantId,
        iterationId: nextIteration.id,
        wakeupId: nextWakeup.id,
        now,
      });
    }

    await projectionLedger.updateRun({
      tenantId: input.tenantId,
      loopId: loaded.loop.id,
      runId: loaded.run.id,
      decision,
      currentIteration: nextIterationId
        ? nextIterationNumber
        : loaded.iteration.iterationNumber,
      outputSummary: decision.evidenceSummary,
      now,
    });
  } catch (err) {
    const message = projectionFailureMessage(err);
    await projectionLedger.recordProjectionFailure({
      tenantId: input.tenantId,
      loopId: loaded.loop.id,
      runId: loaded.run.id,
      iterationId: loaded.iteration.id,
      message,
      now,
    });
    return {
      status: "projection_failed",
      runId: loaded.run.id,
      iterationId: loaded.iteration.id,
      errorCode: "agent_loop_projection_failed",
    };
  }

  return {
    status: "projected",
    runId: loaded.run.id,
    iterationId: loaded.iteration.id,
    outcome: decision.judgment.outcome,
    runStatus: decision.runStatus,
    nextIterationId,
    nextWakeupId,
  };
}

export function agentLoopContextFromSnapshot(
  snapshot: unknown,
): AgentLoopFinalizeContext | null {
  const record = asRecord(snapshot);
  const agentLoop = asRecord(record.agentLoop);
  const runId = stringValue(agentLoop.runId);
  const iterationId = stringValue(agentLoop.iterationId);
  if (!runId || !iterationId) return null;
  return { runId, iterationId };
}

export function createDrizzleAgentLoopFinalizeLedger(): AgentLoopFinalizeLedger {
  const db = getDb();
  return {
    async loadContext(input) {
      const [iteration] = await db
        .select({
          id: agentLoopIterations.id,
          iteration_number: agentLoopIterations.iteration_number,
        })
        .from(agentLoopIterations)
        .where(
          and(
            eq(agentLoopIterations.id, input.iterationId),
            eq(agentLoopIterations.tenant_id, input.tenantId),
            eq(agentLoopIterations.agent_loop_run_id, input.runId),
            eq(agentLoopIterations.thread_turn_id, input.threadTurnId),
          ),
        )
        .limit(1);
      if (!iteration) return null;

      const [run] = await db
        .select({
          id: agentLoopRuns.id,
          agent_loop_id: agentLoopRuns.agent_loop_id,
          agent_loop_version_id: agentLoopRuns.agent_loop_version_id,
          status: agentLoopRuns.status,
          current_iteration: agentLoopRuns.current_iteration,
          started_at: agentLoopRuns.started_at,
        })
        .from(agentLoopRuns)
        .where(
          and(
            eq(agentLoopRuns.id, input.runId),
            eq(agentLoopRuns.tenant_id, input.tenantId),
          ),
        )
        .limit(1);
      if (!run?.agent_loop_version_id) return null;

      const [loop] = await db
        .select({
          id: agentLoops.id,
          tenant_id: agentLoops.tenant_id,
          name: agentLoops.name,
          enabled: agentLoops.enabled,
          lifecycle_status: agentLoops.lifecycle_status,
        })
        .from(agentLoops)
        .where(
          and(
            eq(agentLoops.id, run.agent_loop_id),
            eq(agentLoops.tenant_id, input.tenantId),
          ),
        )
        .limit(1);
      if (!loop) return null;

      const [version] = await db
        .select({
          id: agentLoopVersions.id,
          version_status: agentLoopVersions.version_status,
          goal_spec: agentLoopVersions.goal_spec,
          worker_spec: agentLoopVersions.worker_spec,
          judge_spec: agentLoopVersions.judge_spec,
          loop_policy: agentLoopVersions.loop_policy,
        })
        .from(agentLoopVersions)
        .where(
          and(
            eq(agentLoopVersions.id, run.agent_loop_version_id),
            eq(agentLoopVersions.tenant_id, input.tenantId),
          ),
        )
        .limit(1);
      if (!version) return null;

      const [existingJudgment] = await db
        .select({ id: agentLoopJudgments.id })
        .from(agentLoopJudgments)
        .where(
          and(
            eq(agentLoopJudgments.tenant_id, input.tenantId),
            eq(agentLoopJudgments.agent_loop_run_id, input.runId),
            eq(agentLoopJudgments.agent_loop_iteration_id, input.iterationId),
          ),
        )
        .limit(1);

      return {
        loop: {
          id: loop.id,
          tenantId: loop.tenant_id,
          name: loop.name,
          enabled: loop.enabled,
          lifecycleStatus: loop.lifecycle_status,
        },
        version: {
          id: version.id,
          versionStatus: version.version_status,
          goalSpec: version.goal_spec,
          workerSpec: version.worker_spec,
          judgeSpec: version.judge_spec,
          loopPolicy: version.loop_policy,
        },
        run: {
          id: run.id,
          status: run.status,
          currentIteration: run.current_iteration,
          startedAt: run.started_at,
        },
        iteration: {
          id: iteration.id,
          iterationNumber: iteration.iteration_number,
        },
        existingJudgmentId: existingJudgment?.id ?? null,
      };
    },

    async recordJudgment(input) {
      const [row] = await db
        .insert(agentLoopJudgments)
        .values({
          tenant_id: input.tenantId,
          agent_loop_run_id: input.runId,
          agent_loop_iteration_id: input.iterationId,
          judge_mode: input.judgeMode,
          outcome: input.decision.judgment.outcome,
          confidence:
            input.decision.judgment.confidence === undefined
              ? null
              : Math.round(input.decision.judgment.confidence * 100),
          rationale: input.decision.judgment.reason ?? null,
          terminal_reason: input.decision.judgment.terminalReason ?? null,
          structured_output: input.decision.judgment.structuredOutput,
          created_at: input.now,
        })
        .returning({ id: agentLoopJudgments.id });
      return { id: row.id };
    },

    async recordEvidence(input) {
      await db.insert(agentLoopEvidence).values({
        tenant_id: input.tenantId,
        agent_loop_id: input.loopId,
        agent_loop_run_id: input.runId,
        agent_loop_iteration_id: input.iterationId,
        agent_loop_judgment_id: input.judgmentId,
        evidence_type: "goal_run_summary",
        source_system: "chat_finalize",
        source_id: input.threadTurnId,
        summary: input.summary,
        redaction_state: "summary_only",
        created_at: input.now,
      });
    },

    async updateIteration(input) {
      await db
        .update(agentLoopIterations)
        .set({
          status: input.decision.iterationStatus,
          output_summary: input.decision.evidenceSummary,
          finished_at: input.now,
          error_code: input.decision.errorCode ?? null,
          error_message: input.decision.errorMessage ?? null,
          updated_at: input.now,
        })
        .where(
          and(
            eq(agentLoopIterations.id, input.iterationId),
            eq(agentLoopIterations.tenant_id, input.tenantId),
          ),
        );
    },

    async updateRun(input) {
      const terminal = input.decision.terminal;
      await db
        .update(agentLoopRuns)
        .set({
          status: input.decision.runStatus,
          current_iteration: input.currentIteration,
          terminal_reason: input.decision.judgment.terminalReason ?? undefined,
          output_summary: input.outputSummary,
          finished_at: terminal ? input.now : null,
          last_event_at: input.now,
          error_code: input.decision.errorCode ?? null,
          error_message: input.decision.errorMessage ?? null,
          updated_at: input.now,
        })
        .where(
          and(
            eq(agentLoopRuns.id, input.runId),
            eq(agentLoopRuns.tenant_id, input.tenantId),
          ),
        );

      await db
        .update(agentLoops)
        .set({
          last_run_id: input.runId,
          last_run_status: input.decision.runStatus,
          last_run_at: input.now,
          last_run_summary: input.outputSummary,
          accepted_run_count:
            input.decision.runStatus === "completed"
              ? sql`${agentLoops.accepted_run_count} + 1`
              : undefined,
          rejected_run_count:
            input.decision.runStatus === "failed" ||
            input.decision.runStatus === "budget_stopped"
              ? sql`${agentLoops.rejected_run_count} + 1`
              : undefined,
          escalated_run_count:
            input.decision.runStatus === "escalated" ||
            input.decision.runStatus === "waiting_for_human"
              ? sql`${agentLoops.escalated_run_count} + 1`
              : undefined,
          updated_at: input.now,
        })
        .where(
          and(
            eq(agentLoops.id, input.loopId),
            eq(agentLoops.tenant_id, input.tenantId),
          ),
        );
    },

    async createNextIteration(input) {
      const [row] = await db
        .insert(agentLoopIterations)
        .values({
          tenant_id: input.tenantId,
          agent_loop_run_id: input.runId,
          iteration_number: input.iterationNumber,
          status: "queued",
          goal_mode_action: "resume",
          input_summary: {
            previousIterationId: input.previousIterationId,
            previousOutcome: input.decision.judgment.outcome,
          },
          created_at: input.now,
          updated_at: input.now,
        })
        .returning({ id: agentLoopIterations.id });
      return { id: row.id };
    },

    async enqueueNextWakeup(input) {
      const agentId = workerAgentId(input.version.workerSpec);
      if (!agentId) {
        throw new Error("AgentLoop continuation requires a worker agent.");
      }
      const payload = buildAgentLoopWakeupPayload({
        loop: input.loop,
        version: input.version,
        trigger: {
          family: "manual",
          source: "agent_loop_continue",
        },
        runId: input.runId,
        iterationId: input.iterationId,
        goalModeAction: "resume",
      });
      const [row] = await db
        .insert(agentWakeupRequests)
        .values({
          tenant_id: input.tenantId,
          agent_id: agentId,
          source: AGENT_LOOP_WAKEUP_SOURCE,
          trigger_detail: `agent_loop:${input.loop.id}:continue`,
          reason: input.version.goalSpec.objective,
          payload,
          status: "queued",
          idempotency_key: `agent-loop:${input.runId}:iteration:${input.iterationNumber}`,
          requested_by_actor_type: "system",
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
        .where(
          and(
            eq(agentLoopIterations.id, input.iterationId),
            eq(agentLoopIterations.tenant_id, input.tenantId),
          ),
        );
    },

    async recordProjectionFailure(input) {
      const outputSummary = {
        source: "chat_finalize",
        terminalReason: "agent_loop_projection_failed",
        errorCode: "agent_loop_projection_failed",
        errorMessage: input.message,
      };
      await db
        .update(agentLoopIterations)
        .set({
          status: "failed",
          output_summary: outputSummary,
          finished_at: input.now,
          error_code: "agent_loop_projection_failed",
          error_message: input.message,
          updated_at: input.now,
        })
        .where(
          and(
            eq(agentLoopIterations.id, input.iterationId),
            eq(agentLoopIterations.tenant_id, input.tenantId),
          ),
        );
      await db
        .update(agentLoopRuns)
        .set({
          status: "failed",
          terminal_reason: "agent_loop_projection_failed",
          output_summary: outputSummary,
          finished_at: input.now,
          last_event_at: input.now,
          error_code: "agent_loop_projection_failed",
          error_message: input.message,
          updated_at: input.now,
        })
        .where(
          and(
            eq(agentLoopRuns.id, input.runId),
            eq(agentLoopRuns.tenant_id, input.tenantId),
          ),
        );
      await db
        .update(agentLoops)
        .set({
          last_run_id: input.runId,
          last_run_status: "failed",
          last_run_at: input.now,
          last_run_summary: outputSummary,
          rejected_run_count: sql`${agentLoops.rejected_run_count} + 1`,
          updated_at: input.now,
        })
        .where(
          and(
            eq(agentLoops.id, input.loopId),
            eq(agentLoops.tenant_id, input.tenantId),
          ),
        );
    },
  };
}

function projectionFailureMessage(err: unknown): string {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "AgentLoop finalize projection failed.";
  return (
    message.trim().slice(0, 1000) || "AgentLoop finalize projection failed."
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
