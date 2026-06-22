/**
 * Unified Job Trigger Lambda
 *
 * Invoked by AWS EventBridge Scheduler when any scheduled job fires.
 *
 * For migrated agent jobs: queues a Computer thread turn. Jobs without a
 * Computer are intentionally not dispatched to legacy Agent wakeups.
 * For routine jobs: creates thread_turns record + invokes routine runner
 * For one-time jobs: auto-deletes EventBridge schedule after firing
 *
 * Event payload (set by job-schedule-manager when creating the rule):
 *   { triggerId, triggerType, tenantId, agentId?, spaceId?, routineId?, prompt?, scheduleName?, oneTime? }
 */

import { getApiAuthSecret } from "@thinkwork/runtime-config";
import {
  AGENT_LOOP_SCHEDULE_TRIGGER_TYPE,
  dispatchAgentLoop,
  workerAgentId,
  type AgentLoopDispatchLedger,
} from "@thinkwork/agent-loops-core";
import { createHash, randomBytes } from "node:crypto";
import { ensureThreadForWork, getDb } from "@thinkwork/database-pg";
import {
  agentWakeupRequests,
  agents,
  agentLoopIterations,
  agentLoopRuns,
  agentLoopVersions,
  agentLoops,
  agentSkills,
  budgetPolicies,
  costEvents,
  evalRuns,
  routineAslVersions,
  routineExecutions,
  routines,
  scheduledJobs,
  skillRuns,
  tenantSettings,
  threadIdleLearningRuns,
  threadIdleLearningState,
  threadTurns,
  spaces,
  users,
  workflowEngineBindings,
  workflowEvidence,
  workflowRuns,
  workflowTriggers,
  workflowVersions,
  workflows,
} from "@thinkwork/database-pg/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";

const DEFAULT_EVAL_MODEL_ID = "moonshotai.kimi-k2.5";
// Mirrors CURRENT_EVAL_SCORING_VERSION in @thinkwork/evals-core (this
// package follows the local-constant pattern, like DEFAULT_EVAL_MODEL_ID
// above). Stamped at eval-run creation; unstamped rows are legacy.
const CURRENT_EVAL_SCORING_VERSION = 2;

// Module-scope SFN client so warm Lambda invocations reuse the TCP pool.
const _SFN_CLIENT = new SFNClient({
  requestHandler: { requestTimeout: 15_000, connectionTimeout: 5_000 },
});

interface JobTriggerEvent {
  triggerId: string;
  // agent_heartbeat | agent_reminder | agent_scheduled | routine_schedule |
  // routine_one_time | eval_scheduled | skill_run (Unit 6) |
  // thread_idle_memory_learning | manual | webhook | event
  triggerType: string;
  tenantId: string;
  agentId?: string;
  spaceId?: string;
  routineId?: string;
  prompt?: string;
  scheduleName?: string;
  oneTime?: boolean;
  fireId?: string;
  scheduledTime?: string;
  time?: string;
}

const THREAD_IDLE_MEMORY_LEARNING_TRIGGER_TYPE = "thread_idle_memory_learning";

type ThreadIdleMemoryLearningConfig = {
  internal?: boolean;
  threadId?: string;
  computerId?: string;
  requesterUserId?: string;
  activitySequence?: number;
  scheduledFor?: string;
  lastActivityAt?: string;
};

type ThreadIdleMemoryLearningWorkerResult = {
  ok?: boolean;
  status?: string;
  changedFiles?: unknown[];
  candidateSummary?: unknown;
  reportS3Key?: string | null;
  error?: string;
  budget?: unknown;
  metadata?: unknown;
};

function startOfMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function resolveScheduledJobOwner(row: {
  created_by_type?: string | null;
  created_by_id?: string | null;
  config?: unknown;
}): string | null {
  const config =
    row.config && typeof row.config === "object"
      ? (row.config as Record<string, unknown>)
      : {};
  const invokerUserId = config.invokerUserId;
  if (typeof invokerUserId === "string" && invokerUserId.trim()) {
    return invokerUserId;
  }
  if (row.created_by_type === "user" && row.created_by_id) {
    return row.created_by_id;
  }
  return null;
}

async function pauseJobIfUserBudgetExceeded(args: {
  db: ReturnType<typeof getDb>;
  tenantId: string;
  triggerId: string;
  userId: string | null;
}): Promise<boolean> {
  if (!args.userId) return false;

  const [user] = await args.db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, args.userId), eq(users.tenant_id, args.tenantId)))
    .limit(1);
  if (!user) return false;

  const [policy] = await args.db
    .select()
    .from(budgetPolicies)
    .where(
      and(
        eq(budgetPolicies.tenant_id, args.tenantId),
        eq(budgetPolicies.scope, "user"),
        eq(budgetPolicies.user_id, args.userId),
        eq(budgetPolicies.enabled, true),
      ),
    )
    .limit(1);
  if (!policy) return false;

  const [spend] = await args.db
    .select({ total: sql<number>`COALESCE(SUM(amount_usd), 0)::float` })
    .from(costEvents)
    .where(
      and(
        eq(costEvents.tenant_id, args.tenantId),
        eq(costEvents.user_id, args.userId),
        gte(costEvents.created_at, startOfMonth()),
      ),
    );
  const spentUsd = Number(spend?.total ?? 0);
  const limitUsd = Number(policy.limit_usd);
  if (limitUsd <= 0 || spentUsd < limitUsd) return false;

  const now = new Date();
  const reason = `User budget exceeded: $${spentUsd.toFixed(2)} >= $${limitUsd.toFixed(2)}`;
  await args.db
    .update(scheduledJobs)
    .set({
      budget_paused: true,
      budget_paused_at: now,
      budget_paused_reason: reason,
      updated_at: now,
    })
    .where(eq(scheduledJobs.id, args.triggerId));
  console.log(
    `[job-trigger] user budget paused job ${args.triggerId}: ${reason}`,
  );
  return true;
}

// ---------------------------------------------------------------------------
// skill_run branch helpers (Unit 6)
// ---------------------------------------------------------------------------
//
// Intentionally inlined rather than imported from @thinkwork/api — packages/lambda
// doesn't depend on the API package and adding that dep for ~30 lines of
// pure-logic helpers isn't worth the coupling. The two implementations share a
// documented contract: canonicalization is key-sorted JSON (arrays preserve
// order), hash is SHA256. If either drifts, the dedup partial unique index
// on skill_runs collapses — test coverage asserts the contract on both sides.

function canonicalizeForHash(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalizeForHash(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalizeForHash(obj[k])}`,
  );
  return `{${entries.join(",")}}`;
}

function hashResolvedInputs(resolvedInputs: Record<string, unknown>): string {
  return createHash("sha256")
    .update(canonicalizeForHash(resolvedInputs))
    .digest("hex");
}

type InputBinding =
  | { from_tenant_config: string }
  | { today_plus_N: number }
  | { literal: unknown }
  | string
  | number
  | boolean
  | null;

/**
 * Resolve a map of input bindings into concrete values. Returns either the
 * resolved record or a structured error listing the bindings that couldn't
 * be resolved (e.g. a from_tenant_config key missing from the settings blob).
 */
export async function resolveInputBindings(
  bindings: Record<string, InputBinding> | undefined,
  context: {
    tenantId: string;
    tenantSettingsBlob: Record<string, unknown> | null;
    now: Date;
  },
): Promise<
  | { ok: true; resolved: Record<string, unknown> }
  | { ok: false; missing: string[] }
> {
  const resolved: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const [key, binding] of Object.entries(bindings ?? {})) {
    if (binding === null || typeof binding !== "object") {
      // Plain literal (string / number / boolean / null).
      resolved[key] = binding;
      continue;
    }
    if ("literal" in binding) {
      resolved[key] = binding.literal;
      continue;
    }
    if ("from_tenant_config" in binding) {
      const settingsKey = binding.from_tenant_config;
      const value =
        context.tenantSettingsBlob &&
        typeof context.tenantSettingsBlob === "object"
          ? context.tenantSettingsBlob[settingsKey]
          : undefined;
      if (value === undefined) {
        missing.push(`${key}: from_tenant_config=${settingsKey}`);
        continue;
      }
      resolved[key] = value;
      continue;
    }
    if ("today_plus_N" in binding) {
      const n = Number(binding.today_plus_N);
      if (!Number.isFinite(n)) {
        missing.push(`${key}: today_plus_N must be a number`);
        continue;
      }
      const ms = context.now.getTime() + n * 86_400_000;
      resolved[key] = new Date(ms).toISOString().split("T")[0];
      continue;
    }
    missing.push(`${key}: unknown binding shape`);
  }

  return missing.length > 0 ? { ok: false, missing } : { ok: true, resolved };
}

async function invokeAgentcoreRunSkill(payload: {
  runId: string;
  tenantId: string;
  agentId: string | null;
  invokerUserId: string;
  skillId: string;
  skillVersion: number;
  resolvedInputs: Record<string, unknown>;
  completionHmacSecret: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const fnName = process.env.AGENTCORE_FUNCTION_NAME;
  if (!fnName) {
    return { ok: false, error: "AGENTCORE_FUNCTION_NAME env var not set" };
  }
  try {
    const { LambdaClient, InvokeCommand } = await import(
      "@aws-sdk/client-lambda"
    );
    // Plan §U4: kind=run_skill uses InvocationType: Event so the agent
    // loop has the full 900s AgentCore Lambda budget. Execution result
    // comes back via the HMAC-signed /api/skills/complete callback.
    const lambda = new LambdaClient({});
    const envelope = {
      kind: "run_skill" as const,
      runId: payload.runId,
      tenantId: payload.tenantId,
      agentId: payload.agentId,
      invokerUserId: payload.invokerUserId,
      skillId: payload.skillId,
      skillVersion: payload.skillVersion,
      invocationSource: "scheduled" as const,
      resolvedInputs: payload.resolvedInputs,
      // snake_case — the container's dispatch reads tenant_id/user_id/
      // skill_id. See change 4 of the hardening plan.
      scope: {
        tenant_id: payload.tenantId,
        user_id: payload.invokerUserId,
        skill_id: payload.skillId,
      },
      completionHmacSecret: payload.completionHmacSecret,
    };
    const res = await lambda.send(
      new InvokeCommand({
        FunctionName: fnName,
        InvocationType: "Event",
        Payload: new TextEncoder().encode(
          JSON.stringify({
            requestContext: { http: { method: "POST", path: "/invocations" } },
            rawPath: "/invocations",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${getApiAuthSecret()}`,
            },
            body: JSON.stringify(envelope),
            isBase64Encoded: false,
          }),
        ),
      }),
    );
    if (typeof res.StatusCode === "number" && res.StatusCode >= 400) {
      return {
        ok: false,
        error: `agentcore-invoke Event enqueue returned ${res.StatusCode}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const SCHEDULE_GROUP = "thinkwork-jobs";

// Computer scheduling removed (refactor/kill-computer).

function parseThreadIdleMemoryLearningConfig(
  config: unknown,
): ThreadIdleMemoryLearningConfig {
  if (!config || typeof config !== "object") return {};
  return config as ThreadIdleMemoryLearningConfig;
}

function parseWorkerPayload(
  payload: Uint8Array | undefined,
): ThreadIdleMemoryLearningWorkerResult {
  if (!payload || payload.length === 0)
    return { ok: true, status: "no_change" };
  const text = new TextDecoder().decode(payload);
  if (!text.trim()) return { ok: true, status: "no_change" };
  try {
    const parsed = JSON.parse(text) as ThreadIdleMemoryLearningWorkerResult;
    return parsed;
  } catch (err) {
    return {
      ok: false,
      status: "failed",
      error: `worker returned malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function invokeThreadIdleMemoryLearningWorker(input: {
  runId: string;
  tenantId: string;
  threadId: string;
  computerId: string;
  requesterUserId: string;
  scheduledJobId: string;
  activitySequence: number;
  scheduledFor: string;
  lastActivityAt: string;
}): Promise<ThreadIdleMemoryLearningWorkerResult> {
  const { LambdaClient, InvokeCommand } = await import(
    "@aws-sdk/client-lambda"
  );
  const lambda = new LambdaClient({});
  const fnName = runtimeFunctionName(
    "THREAD_IDLE_MEMORY_LEARNING_FUNCTION_NAME",
    "thread-idle-memory-learning",
  );
  const response = await lambda.send(
    new InvokeCommand({
      FunctionName: fnName,
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(JSON.stringify(input)),
    }),
  );

  if (response.FunctionError) {
    return {
      ok: false,
      status: "failed",
      error: `worker function error: ${response.FunctionError}`,
    };
  }
  if (typeof response.StatusCode === "number" && response.StatusCode >= 400) {
    return {
      ok: false,
      status: "failed",
      error: `worker invoke returned ${response.StatusCode}`,
    };
  }

  return parseWorkerPayload(response.Payload);
}

type JobTriggerDb = ReturnType<typeof getDb>;

function createAgentLoopLedger(db: JobTriggerDb): AgentLoopDispatchLedger {
  return {
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
      return row ? { id: row.id, status: row.status as never } : null;
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
      return { id: row.id, status: row.status as never };
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
  };
}

function scheduledAgentLoopIdempotencyKey(event: JobTriggerEvent): string {
  const fireId =
    event.fireId ||
    event.scheduledTime ||
    event.time ||
    String(Math.floor(Date.now() / 60_000));
  return `${AGENT_LOOP_SCHEDULE_TRIGGER_TYPE}:${event.triggerId}:${fireId}`;
}

async function findAgentLoopRunByIdempotencyKey(
  db: JobTriggerDb,
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

async function loadAgentDefaultSpaceId(
  db: JobTriggerDb,
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
  const [space] = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(
      and(
        eq(spaces.id, defaultSpaceId),
        eq(spaces.tenant_id, tenantId),
        eq(spaces.status, "active"),
      ),
    )
    .limit(1);
  return space?.id ?? null;
}

function defaultSpaceIdFromRuntimeConfig(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const defaultSpaceId = (value as { defaultSpaceId?: unknown }).defaultSpaceId;
  return typeof defaultSpaceId === "string" && defaultSpaceId.trim()
    ? defaultSpaceId
    : null;
}

async function handleAgentLoopSchedule(input: {
  db: JobTriggerDb;
  event: JobTriggerEvent;
  job: {
    enabled: boolean;
    name: string;
    agent_id: string | null;
    agent_loop_id: string | null;
    prompt: string | null;
    config: unknown;
    budget_paused: boolean;
    budget_paused_reason?: string | null;
    created_by_type?: string | null;
    created_by_id?: string | null;
  } | null;
  tenantId: string;
  triggerId: string;
  actorId: string | null;
  budgetPausedByOwner: boolean;
}): Promise<void> {
  const { db, event, job, tenantId, triggerId } = input;
  const now = new Date();
  if (!job?.agent_loop_id) {
    console.warn(
      `[job-trigger] agent_loop_schedule ${triggerId} has no agent_loop_id; skipping`,
    );
    await recordAgentLoopScheduleDiagnostic(db, triggerId, job?.config, {
      status: "failed",
      reason: "scheduled job has no agent_loop_id",
      at: now,
    });
    return;
  }

  const [loop] = await db
    .select({
      id: agentLoops.id,
      tenant_id: agentLoops.tenant_id,
      name: agentLoops.name,
      enabled: agentLoops.enabled,
      lifecycle_status: agentLoops.lifecycle_status,
      current_version_id: agentLoops.current_version_id,
    })
    .from(agentLoops)
    .where(
      and(
        eq(agentLoops.id, job.agent_loop_id),
        eq(agentLoops.tenant_id, tenantId),
      ),
    )
    .limit(1);
  if (!loop) {
    console.warn(
      `[job-trigger] agent_loop_schedule ${triggerId} references missing loop ${job.agent_loop_id}; skipping`,
    );
    await recordAgentLoopScheduleDiagnostic(db, triggerId, job.config, {
      status: "failed",
      reason: `AgentLoop ${job.agent_loop_id} not found`,
      at: now,
    });
    return;
  }

  const version = loop.current_version_id
    ? (
        await db
          .select({
            id: agentLoopVersions.id,
            version_status: agentLoopVersions.version_status,
            goal_spec: agentLoopVersions.goal_spec,
            worker_spec: agentLoopVersions.worker_spec,
            judge_spec: agentLoopVersions.judge_spec,
            loop_policy: agentLoopVersions.loop_policy,
          })
          .from(agentLoopVersions)
          .where(eq(agentLoopVersions.id, loop.current_version_id))
          .limit(1)
      )[0]
    : null;
  const idempotencyKey = scheduledAgentLoopIdempotencyKey(event);
  const existingIdempotentRun = await findAgentLoopRunByIdempotencyKey(
    db,
    tenantId,
    idempotencyKey,
  );
  if (existingIdempotentRun) {
    await db
      .update(scheduledJobs)
      .set({
        last_run_at: now,
        updated_at: now,
      })
      .where(eq(scheduledJobs.id, triggerId));
    console.log(
      `[job-trigger] agent_loop_schedule ${triggerId} reused run ${existingIdempotentRun.id}`,
    );
    return;
  }

  const workerId = workerAgentId(version?.worker_spec ?? null);
  const defaultSpaceId = workerId
    ? await loadAgentDefaultSpaceId(db, tenantId, workerId)
    : null;
  const executionThread =
    workerId && loop.lifecycle_status === "active"
      ? await ensureThreadForWork({
          tenantId,
          agentId: workerId,
          userId: input.actorId ?? undefined,
          spaceId: defaultSpaceId ?? undefined,
          title: `Automation: ${loop.name}`,
          channel: "schedule",
        })
      : null;

  const result = await dispatchAgentLoop(
    {
      tenantId,
      loop: {
        id: loop.id,
        tenantId: loop.tenant_id,
        name: loop.name,
        enabled: loop.enabled,
        lifecycleStatus: loop.lifecycle_status,
      },
      version: version
        ? {
            id: version.id,
            versionStatus: version.version_status,
            goalSpec: version.goal_spec,
            workerSpec: version.worker_spec,
            judgeSpec: version.judge_spec,
            loopPolicy: version.loop_policy,
          }
        : null,
      trigger: {
        family: "schedule",
        source: AGENT_LOOP_SCHEDULE_TRIGGER_TYPE,
        actorType: input.actorId ? "user" : "system",
        actorId: input.actorId,
        threadId: executionThread?.threadId ?? null,
        spaceId: defaultSpaceId,
        scheduledJobId: triggerId,
        idempotencyKey,
        correlationId: `${AGENT_LOOP_SCHEDULE_TRIGGER_TYPE}:${triggerId}`,
        inputSummary: {
          scheduleName: event.scheduleName ?? null,
          prompt: job.prompt ?? null,
        },
      },
      scheduleGate: {
        enabled: job.enabled,
        budgetPaused: job.budget_paused || input.budgetPausedByOwner,
        reason:
          job.budget_paused_reason ??
          (input.budgetPausedByOwner ? "User budget exceeded." : null),
      },
      now,
    },
    createAgentLoopLedger(db),
  );

  await db
    .update(scheduledJobs)
    .set({
      last_run_at: now,
      updated_at: now,
    })
    .where(eq(scheduledJobs.id, triggerId));
  console.log(
    `[job-trigger] agent_loop_schedule ${triggerId} dispatch status=${result.status}`,
  );
}

async function recordAgentLoopScheduleDiagnostic(
  db: JobTriggerDb,
  triggerId: string,
  config: unknown,
  diagnostic: { status: string; reason: string; at: Date },
): Promise<void> {
  const configRecord =
    config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  await db
    .update(scheduledJobs)
    .set({
      config: {
        ...configRecord,
        lastAgentLoopDispatch: {
          status: diagnostic.status,
          reason: diagnostic.reason,
          at: diagnostic.at.toISOString(),
        },
      },
      last_run_at: diagnostic.at,
      updated_at: diagnostic.at,
    })
    .where(eq(scheduledJobs.id, triggerId));
}

export async function handler(event: JobTriggerEvent): Promise<void> {
  const {
    triggerId,
    triggerType,
    tenantId,
    agentId,
    routineId,
    prompt,
    scheduleName,
    oneTime,
  } = event;

  if (!triggerId || !tenantId || !triggerType) {
    console.error("[job-trigger] Missing required fields in event", event);
    return;
  }

  console.log(
    `[job-trigger] Firing triggerId=${triggerId} type=${triggerType} oneTime=${!!oneTime}`,
  );

  try {
    const db = getDb();
    const isAgentLoopSchedule =
      triggerType === AGENT_LOOP_SCHEDULE_TRIGGER_TYPE;

    // Guard: check if the job is still enabled before executing
    const [job] = await db
      .select({
        id: scheduledJobs.id,
        tenant_id: scheduledJobs.tenant_id,
        enabled: scheduledJobs.enabled,
        name: scheduledJobs.name,
        agent_id: scheduledJobs.agent_id,
        agent_loop_id: scheduledJobs.agent_loop_id,
        space_id: scheduledJobs.space_id,
        prompt: scheduledJobs.prompt,
        config: scheduledJobs.config,
        budget_paused: scheduledJobs.budget_paused,
        budget_paused_reason: scheduledJobs.budget_paused_reason,
        created_by_type: scheduledJobs.created_by_type,
        created_by_id: scheduledJobs.created_by_id,
      })
      .from(scheduledJobs)
      .where(eq(scheduledJobs.id, triggerId));
    if (job && !job.enabled && !isAgentLoopSchedule) {
      console.log(
        `[job-trigger] Job ${triggerId} is disabled, skipping execution`,
      );
      return;
    }
    if (job?.budget_paused && !isAgentLoopSchedule) {
      console.log(
        `[job-trigger] Job ${triggerId} is budget-paused, skipping execution`,
      );
      return;
    }
    const ownerUserId = job ? resolveScheduledJobOwner(job) : null;
    const budgetPausedByOwner = await pauseJobIfUserBudgetExceeded({
      db,
      tenantId,
      triggerId,
      userId: ownerUserId,
    });
    if (budgetPausedByOwner && !isAgentLoopSchedule) {
      return;
    }
    const jobAgentId = job?.agent_id ?? agentId ?? null;
    const jobSpaceId = job?.space_id ?? event.spaceId ?? null;

    if (isAgentLoopSchedule) {
      await handleAgentLoopSchedule({
        db,
        event,
        job: job ?? null,
        tenantId,
        triggerId,
        actorId: ownerUserId,
        budgetPausedByOwner,
      });
      return;
    }

    const isAgentJob = triggerType.startsWith("agent_");

    if (triggerType === THREAD_IDLE_MEMORY_LEARNING_TRIGGER_TYPE) {
      const cfg = parseThreadIdleMemoryLearningConfig(job?.config);
      const [state] = await db
        .select({
          id: threadIdleLearningState.id,
          tenantId: threadIdleLearningState.tenant_id,
          threadId: threadIdleLearningState.thread_id,
          computerId: threadIdleLearningState.computer_id,
          requesterUserId: threadIdleLearningState.requester_user_id,
          activitySequence: threadIdleLearningState.activity_sequence,
          lastActivityAt: threadIdleLearningState.last_activity_at,
          scheduledFor: threadIdleLearningState.scheduled_for,
        })
        .from(threadIdleLearningState)
        .where(
          and(
            eq(threadIdleLearningState.tenant_id, tenantId),
            eq(threadIdleLearningState.scheduled_job_id, triggerId),
          ),
        )
        .limit(1);

      if (
        !state ||
        !cfg.threadId ||
        !cfg.computerId ||
        !cfg.requesterUserId ||
        typeof cfg.activitySequence !== "number" ||
        !cfg.scheduledFor ||
        !cfg.lastActivityAt
      ) {
        console.warn(
          `[job-trigger] thread_idle_memory_learning ${triggerId} missing state/config; skipping`,
        );
      } else {
        const scheduledFor = new Date(cfg.scheduledFor);
        const configLastActivityAt = new Date(cfg.lastActivityAt);
        const isFreshSnapshot =
          state.threadId === cfg.threadId &&
          state.computerId === cfg.computerId &&
          state.requesterUserId === cfg.requesterUserId &&
          state.activitySequence === cfg.activitySequence &&
          state.lastActivityAt.getTime() === configLastActivityAt.getTime();

        if (!isFreshSnapshot) {
          await db.insert(threadIdleLearningRuns).values({
            tenant_id: tenantId,
            thread_id: cfg.threadId,
            computer_id: cfg.computerId,
            requester_user_id: cfg.requesterUserId,
            scheduled_job_id: triggerId,
            activity_sequence: cfg.activitySequence,
            scheduled_for: scheduledFor,
            finished_at: new Date(),
            status: "stale_noop",
            metadata: {
              reason: "activity_sequence_changed",
              currentActivitySequence: state.activitySequence,
              expectedActivitySequence: cfg.activitySequence,
            },
          });
          console.log(
            `[job-trigger] thread_idle_memory_learning ${triggerId} stale snapshot; no-op`,
          );
        } else {
          const [run] = await db
            .insert(threadIdleLearningRuns)
            .values({
              tenant_id: tenantId,
              thread_id: state.threadId,
              computer_id: state.computerId,
              requester_user_id: state.requesterUserId,
              scheduled_job_id: triggerId,
              activity_sequence: state.activitySequence,
              scheduled_for: scheduledFor,
              status: "running",
            })
            .returning({ id: threadIdleLearningRuns.id });

          if (!run) {
            console.warn(
              `[job-trigger] thread_idle_memory_learning ${triggerId} failed to create run`,
            );
          } else {
            await db
              .update(threadIdleLearningState)
              .set({
                status: "running",
                last_run_id: run.id,
                updated_at: new Date(),
              })
              .where(eq(threadIdleLearningState.id, state.id));

            let workerResult: ThreadIdleMemoryLearningWorkerResult;
            try {
              workerResult = await invokeThreadIdleMemoryLearningWorker({
                runId: run.id,
                tenantId,
                threadId: state.threadId,
                computerId: state.computerId!,
                requesterUserId: state.requesterUserId!,
                scheduledJobId: triggerId,
                activitySequence: state.activitySequence,
                scheduledFor: scheduledFor.toISOString(),
                lastActivityAt: state.lastActivityAt.toISOString(),
              });
            } catch (err) {
              workerResult = {
                ok: false,
                status: "failed",
                error: err instanceof Error ? err.message : String(err),
              };
            }
            const finalStatus =
              workerResult.ok === false
                ? "failed"
                : workerResult.status === "changed"
                  ? "changed"
                  : "no_change";
            const finishedAt = new Date();
            await db
              .update(threadIdleLearningRuns)
              .set({
                status: finalStatus,
                finished_at: finishedAt,
                changed_files: workerResult.changedFiles ?? [],
                candidate_summary: workerResult.candidateSummary ?? null,
                report_s3_key: workerResult.reportS3Key ?? null,
                error: workerResult.error ?? null,
                budget: workerResult.budget ?? null,
                metadata: workerResult.metadata ?? null,
                updated_at: finishedAt,
              })
              .where(eq(threadIdleLearningRuns.id, run.id));
            await db
              .update(threadIdleLearningState)
              .set({
                status: finalStatus,
                last_run_id: run.id,
                updated_at: finishedAt,
              })
              .where(eq(threadIdleLearningState.id, state.id));
            console.log(
              `[job-trigger] thread_idle_memory_learning ${triggerId} completed run ${run.id} status=${finalStatus}`,
            );
          }
        }
      }
    } else if (isAgentJob && agentId) {
      console.log(
        `[job-trigger] Agent scheduling routed through Computer is disabled; ignoring trigger ${triggerId} for agent ${agentId}`,
      );
    } else if (triggerType === "eval_scheduled") {
      // Eval-scheduled jobs: insert a pending eval_runs row + fire the
      // eval-runner Lambda async. Evals run against a platform-managed
      // AgentCore agent.
      const cfg = (job?.config ?? {}) as {
        agentId?: string;
        model?: string;
        categories?: string[];
      };
      let targetAgentId: string | null = null;
      try {
        if (cfg.model && cfg.model !== DEFAULT_EVAL_MODEL_ID) {
          throw new Error(
            `Scheduled eval model overrides are no longer supported; use ${DEFAULT_EVAL_MODEL_ID}`,
          );
        }
        if (cfg.agentId) {
          console.warn(
            "[job-trigger] eval cfg.agentId is deprecated and ignored; eval-runner will resolve the tenant platform agent",
            { tenantId, schedJobId: triggerId, ignoredAgentId: cfg.agentId },
          );
        }
        // targetAgentId stays null on purpose. eval-runner Lambda's lazy
        // resolveTenantPlatformAgent fallback sets it before SQS fan-out;
        // PlatformAgentNotFoundError there marks the run failed via the
        // dispatcher's outer try/catch.
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db.insert(evalRuns).values({
          tenant_id: tenantId,
          scheduled_job_id: triggerId,
          status: "failed",
          model: DEFAULT_EVAL_MODEL_ID,
          categories: cfg.categories ?? [],
          completed_at: new Date(),
          error_message: message,
        });
        console.warn(`[job-trigger] ${message} for trigger ${triggerId}`);
        return;
      }

      const [run] = await db
        .insert(evalRuns)
        .values({
          tenant_id: tenantId,
          agent_id: targetAgentId,
          scheduled_job_id: triggerId,
          status: "pending",
          model: DEFAULT_EVAL_MODEL_ID,
          categories: cfg.categories ?? [],
          // Scoring semantics are stamped at run creation (Trust Core
          // U2); unstamped rows are treated as legacy.
          scoring_version: CURRENT_EVAL_SCORING_VERSION,
        })
        .returning();
      console.log(
        `[job-trigger] Created eval_run ${run.id} for scheduled trigger ${triggerId}`,
      );

      try {
        const { LambdaClient, InvokeCommand } = await import(
          "@aws-sdk/client-lambda"
        );
        const lambda = new LambdaClient({});
        const stage = process.env.STAGE || "dev";
        const fnName =
          process.env.EVAL_RUNNER_FN_ARN ||
          `thinkwork-${stage}-api-eval-runner`;
        await lambda.send(
          new InvokeCommand({
            FunctionName: fnName,
            InvocationType: "Event",
            Payload: new TextEncoder().encode(
              JSON.stringify({ runId: run.id }),
            ),
          }),
        );
        console.log(`[job-trigger] Fired eval-runner for run ${run.id}`);
      } catch (invokeErr) {
        const message =
          invokeErr instanceof Error ? invokeErr.message : String(invokeErr);
        await db
          .update(evalRuns)
          .set({
            status: "failed",
            completed_at: new Date(),
            error_message: `Failed to invoke eval-runner: ${message}`,
          })
          .where(eq(evalRuns.id, run.id));
        console.error(
          `[job-trigger] Failed to invoke eval-runner for run ${run.id}:`,
          invokeErr,
        );
      }
    } else if (triggerType === "skill_run") {
      // Scheduled skill runs. The scheduled_jobs row's config carries the
      // target skill id + input bindings + the invoker user whose identity
      // this scheduled run takes on. Fire path:
      //
      //   deprovisioned? → pause job
      //   bindings invalid? → write invalid_binding audit row
      //   skill disabled for the agent? → write skipped_disabled audit row
      //   otherwise → insert running skill_runs row + invoke the dispatcher
      //
      // On dedup hit (partial unique index) we observe the prior active
      // run and skip the new invoke — a safe no-op under EventBridge
      // retries or overlapping schedule fires.

      const cfg = (job?.config ?? {}) as {
        skillId?: string;
        skillVersion?: number;
        invokerUserId?: string;
        agentId?: string;
        inputBindings?: Record<string, InputBinding>;
        deliveryChannels?: unknown[];
      };
      const skillId = cfg.skillId;
      const invokerUserId = cfg.invokerUserId;
      const targetAgentId = cfg.agentId ?? agentId;

      if (!skillId || !invokerUserId) {
        console.error(
          `[job-trigger] skill_run missing required config for ${triggerId}: skillId=${skillId}, invokerUserId=${invokerUserId}`,
        );
        return;
      }

      // Deprovisioning check — if the invoker user is gone, pause the
      // schedule so it stops firing. A paused schedule is still visible
      // to admins; Unit 7's UI surfaces it as an actionable state.
      const [invoker] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, invokerUserId));
      if (!invoker) {
        await db
          .update(scheduledJobs)
          .set({ enabled: false, updated_at: new Date() })
          .where(eq(scheduledJobs.id, triggerId));
        console.warn(
          `[job-trigger] skill_run invoker ${invokerUserId} deprovisioned — paused job ${triggerId}`,
        );
        return;
      }

      // Resolve input bindings. tenant_settings.features is the per-tenant
      // JSONB config blob bindings read from via `{ from_tenant_config: key }`.
      const [tenantSettingsRow] = await db
        .select({ features: tenantSettings.features })
        .from(tenantSettings)
        .where(eq(tenantSettings.tenant_id, tenantId));
      const tenantSettingsBlob =
        (tenantSettingsRow?.features as Record<string, unknown> | null) ?? null;

      const bindingResult = await resolveInputBindings(cfg.inputBindings, {
        tenantId,
        tenantSettingsBlob,
        now: new Date(),
      });

      if (!bindingResult.ok) {
        // Audit-only row so admins can see why the schedule didn't run.
        const invalidInputs = { inputBindings: cfg.inputBindings ?? {} };
        await db.insert(skillRuns).values({
          tenant_id: tenantId,
          agent_id: targetAgentId ?? null,
          invoker_user_id: invokerUserId,
          skill_id: skillId,
          skill_version: cfg.skillVersion ?? 1,
          invocation_source: "scheduled",
          inputs: invalidInputs,
          resolved_inputs: {},
          resolved_inputs_hash: hashResolvedInputs({
            __invalid: bindingResult.missing,
          }),
          status: "failed",
          failure_reason: `invalid_binding: ${bindingResult.missing.join("; ")}`,
          finished_at: new Date(),
        });
        console.warn(
          `[job-trigger] skill_run ${triggerId} invalid bindings: ${bindingResult.missing.join("; ")}`,
        );
        return;
      }

      const resolvedInputs = bindingResult.resolved;

      // Skill-enabled check. When the schedule targets an agent, we
      // confirm that agent still has the skill enabled. Skill runs
      // not gated to a specific agent (webhook-style, no agentId) skip
      // this check — the container validates at dispatch time.
      if (targetAgentId) {
        const [enablement] = await db
          .select({ enabled: agentSkills.enabled })
          .from(agentSkills)
          .where(
            and(
              eq(agentSkills.agent_id, targetAgentId),
              eq(agentSkills.skill_id, skillId),
            ),
          );
        if (!enablement || enablement.enabled === false) {
          await db.insert(skillRuns).values({
            tenant_id: tenantId,
            agent_id: targetAgentId,
            invoker_user_id: invokerUserId,
            skill_id: skillId,
            skill_version: cfg.skillVersion ?? 1,
            invocation_source: "scheduled",
            inputs: { inputBindings: cfg.inputBindings ?? {} },
            resolved_inputs: resolvedInputs,
            resolved_inputs_hash: hashResolvedInputs(resolvedInputs),
            status: "skipped_disabled",
            failure_reason: enablement
              ? "skill is disabled for this agent"
              : "skill is not enabled for this agent",
            finished_at: new Date(),
          });
          console.log(
            `[job-trigger] skill_run ${triggerId} skipped: skill ${skillId} disabled for agent ${targetAgentId}`,
          );
          return;
        }
      }

      // Insert the running row. The partial unique index on
      // (tenant, invoker, skill, hash) WHERE status='running' makes
      // overlapping fires dedup cleanly.
      const resolvedInputsHash = hashResolvedInputs(resolvedInputs);
      const completionHmacSecret = randomBytes(32).toString("hex");
      const inserted = await db
        .insert(skillRuns)
        .values({
          tenant_id: tenantId,
          agent_id: targetAgentId ?? null,
          invoker_user_id: invokerUserId,
          skill_id: skillId,
          skill_version: cfg.skillVersion ?? 1,
          invocation_source: "scheduled",
          inputs: { inputBindings: cfg.inputBindings ?? {} },
          resolved_inputs: resolvedInputs,
          resolved_inputs_hash: resolvedInputsHash,
          delivery_channels: (cfg.deliveryChannels as unknown[]) ?? [],
          status: "running",
          completion_hmac_secret: completionHmacSecret,
        })
        .onConflictDoNothing({
          target: [
            skillRuns.tenant_id,
            skillRuns.invoker_user_id,
            skillRuns.skill_id,
            skillRuns.resolved_inputs_hash,
          ],
          // Match the partial unique index `uq_skill_runs_dedup_active`
          // (WHERE status='running'). Without this predicate Postgres
          // cannot resolve the ON CONFLICT target against a partial
          // index and raises error 42P10.
          where: sql`status = 'running'`,
        })
        .returning();

      if (inserted.length === 0) {
        console.log(
          `[job-trigger] skill_run ${triggerId} dedup hit — existing run in progress`,
        );
        return;
      }
      const runRow = inserted[0];

      const invokeResult = await invokeAgentcoreRunSkill({
        runId: runRow.id,
        tenantId,
        agentId: targetAgentId ?? null,
        invokerUserId,
        skillId,
        skillVersion: runRow.skill_version,
        resolvedInputs,
        completionHmacSecret,
      });

      if (!invokeResult.ok) {
        // Free the dedup slot so a future retry can run.
        await db
          .update(skillRuns)
          .set({
            status: "failed",
            failure_reason: invokeResult.error.slice(0, 500),
            finished_at: new Date(),
            updated_at: new Date(),
          })
          .where(eq(skillRuns.id, runRow.id));
        console.error(
          `[job-trigger] skill_run ${triggerId} invoke failed: ${invokeResult.error}`,
        );
        return;
      }

      console.log(
        `[job-trigger] skill_run ${triggerId} started run ${runRow.id} for skill ${skillId}`,
      );
    } else if (routineId) {
      // Routine jobs (Phase B U7 cutover):
      //   - step_functions engine → SFN.StartExecution against the alias
      //     ARN; insert routine_executions row pre-emptively.
      //   - legacy_python engine → keep the thread_turns insert path
      //     until Phase E archives those rows. The legacy ROUTINE_RUNNER_URL
      //     POST has been removed because the URL was never provisioned.
      const [routine] = await db
        .select({
          id: routines.id,
          tenant_id: routines.tenant_id,
          name: routines.name,
          description: routines.description,
          engine: routines.engine,
          status: routines.status,
          visibility: routines.visibility,
          agent_id: routines.agent_id,
          owning_agent_id: routines.owning_agent_id,
          state_machine_arn: routines.state_machine_arn,
          state_machine_alias_arn: routines.state_machine_alias_arn,
          current_version: routines.current_version,
        })
        .from(routines)
        .where(eq(routines.id, routineId));

      if (!routine) {
        console.error(
          `[job-trigger] routine ${routineId} not found; skipping schedule fire`,
        );
      } else if (routine.engine === "step_functions") {
        if (!routine.state_machine_alias_arn || !routine.state_machine_arn) {
          console.error(
            `[job-trigger] routine ${routineId} engine=step_functions but missing alias ARN; skipping`,
          );
        } else if (!routine.current_version) {
          console.error(
            `[job-trigger] routine ${routineId} engine=step_functions but has no current ASL version; skipping`,
          );
        } else {
          try {
            const [aslVersion] = await db
              .select({
                id: routineAslVersions.id,
                tenant_id: routineAslVersions.tenant_id,
                routine_id: routineAslVersions.routine_id,
                version_number: routineAslVersions.version_number,
                state_machine_arn: routineAslVersions.state_machine_arn,
                version_arn: routineAslVersions.version_arn,
                asl_json: routineAslVersions.asl_json,
                markdown_summary: routineAslVersions.markdown_summary,
                step_manifest_json: routineAslVersions.step_manifest_json,
                published_by_actor_type:
                  routineAslVersions.published_by_actor_type,
                published_by_actor_id: routineAslVersions.published_by_actor_id,
                created_at: routineAslVersions.created_at,
              })
              .from(routineAslVersions)
              .where(
                and(
                  eq(routineAslVersions.routine_id, routine.id),
                  eq(
                    routineAslVersions.version_number,
                    routine.current_version,
                  ),
                ),
              );
            if (!aslVersion) {
              console.error(
                `[job-trigger] routine ${routineId} current ASL version ${routine.current_version} not found; skipping`,
              );
            } else {
              const workflowProjection = await ensureRoutineWorkflowForJob({
                routine,
                aslVersion,
                triggerFamily: "schedule",
              });
              const routineInput = buildRoutineExecutionInput(
                {
                  triggerId,
                  triggerSource: "schedule",
                  scheduleName: scheduleName ?? null,
                  agentId: jobAgentId,
                  spaceId: jobSpaceId,
                },
                {
                  tenantId,
                  routineId,
                },
              );
              const startResp = await _SFN_CLIENT.send(
                new StartExecutionCommand({
                  stateMachineArn: aslVersion.version_arn,
                  input: JSON.stringify(routineInput),
                }),
              );
              if (startResp.executionArn) {
                const [executionRow] = await db
                  .insert(routineExecutions)
                  .values({
                    tenant_id: tenantId,
                    routine_id: routineId,
                    state_machine_arn: routine.state_machine_arn,
                    alias_arn: routine.state_machine_alias_arn,
                    version_arn: aslVersion.version_arn,
                    routine_asl_version_id: aslVersion.id,
                    sfn_execution_arn: startResp.executionArn,
                    trigger_id: triggerId,
                    trigger_source: "schedule",
                    input_json: {
                      triggerId,
                      scheduleName: scheduleName ?? null,
                      agentId: jobAgentId,
                      spaceId: jobSpaceId,
                    },
                    status: "running",
                    started_at: startResp.startDate ?? new Date(),
                  })
                  .returning({ id: routineExecutions.id });
                await createRoutineWorkflowRunForJob({
                  routine,
                  aslVersion,
                  projection: workflowProjection,
                  executionArn: startResp.executionArn,
                  routineExecutionId: executionRow?.id ?? null,
                  triggerId,
                  scheduleName: scheduleName ?? null,
                  agentId: jobAgentId,
                  spaceId: jobSpaceId,
                  startedAt: startResp.startDate ?? new Date(),
                });
                console.log(
                  `[job-trigger] Started SFN execution ${startResp.executionArn} for routine ${routineId}`,
                );
              }
            }
          } catch (sfnErr) {
            console.error(
              `[job-trigger] SFN.StartExecution failed for routine ${routineId}:`,
              sfnErr,
            );
            throw sfnErr;
          }
        }
      } else {
        // legacy_python — keep the original thread_turns insert. The
        // legacy ROUTINE_RUNNER_URL POST is removed; the Phase E sweep
        // archives these routines.
        const [run] = await db
          .insert(threadTurns)
          .values({
            tenant_id: tenantId,
            trigger_id: triggerId,
            routine_id: routineId,
            invocation_source: "schedule",
            trigger_detail: scheduleName
              ? `schedule:${scheduleName}`
              : `job:${triggerId}`,
            status: "queued",
            context_snapshot: { spaceId: jobSpaceId },
          })
          .returning();
        console.log(
          `[job-trigger] Created thread_turn ${run.id} for legacy_python routine ${routineId}`,
        );
      }
    }

    // Update last_run_at on the scheduled job
    await db
      .update(scheduledJobs)
      .set({ last_run_at: new Date() })
      .where(eq(scheduledJobs.id, triggerId));

    // If this was a one-time schedule, delete the EventBridge schedule after firing
    if (oneTime && scheduleName) {
      try {
        const { SchedulerClient, DeleteScheduleCommand } = await import(
          "@aws-sdk/client-scheduler"
        );
        const scheduler = new SchedulerClient({});
        await scheduler.send(
          new DeleteScheduleCommand({
            Name: scheduleName,
            GroupName: SCHEDULE_GROUP,
          }),
        );
        console.log(`[job-trigger] Deleted one-time schedule: ${scheduleName}`);

        // Mark the job as disabled since it's been consumed
        await db
          .update(scheduledJobs)
          .set({ enabled: false, updated_at: new Date() })
          .where(eq(scheduledJobs.id, triggerId));
      } catch (deleteErr) {
        // Non-fatal — schedule may have ActionAfterCompletion: DELETE
        console.warn(
          `[job-trigger] Failed to delete one-time schedule:`,
          deleteErr,
        );
      }
    }
  } catch (err) {
    console.error("[job-trigger] Failed to process job trigger:", err);
  }
}

export function buildRoutineExecutionInput(
  userInput: Record<string, unknown>,
  routine: { tenantId: string; routineId: string },
): Record<string, unknown> {
  return {
    ...userInput,
    tenantId: routine.tenantId,
    routineId: routine.routineId,
    agentId: typeof userInput.agentId === "string" ? userInput.agentId : null,
    spaceId: typeof userInput.spaceId === "string" ? userInput.spaceId : null,
    inboxApprovalFunctionName: runtimeFunctionName(
      "ROUTINE_APPROVAL_CALLBACK_FUNCTION_NAME",
      "routine-approval-callback",
    ),
    emailSendFunctionName: runtimeFunctionName(
      "EMAIL_SEND_FUNCTION_NAME",
      "email-send",
    ),
    routineTaskPythonFunctionName: runtimeFunctionName(
      "ROUTINE_TASK_PYTHON_FUNCTION_NAME",
      "routine-task-python",
    ),
    adminOpsMcpFunctionName: runtimeFunctionName(
      "ADMIN_OPS_MCP_FUNCTION_NAME",
      "admin-ops-mcp",
    ),
    slackSendFunctionName: runtimeFunctionName(
      "SLACK_SEND_FUNCTION_NAME",
      "slack-send",
    ),
  };
}

type JobRoutineWorkflowRoutine = {
  id: string;
  tenant_id: string;
  name: string | null;
  description: string | null;
  engine: string | null;
  status: string | null;
  visibility: string | null;
  agent_id: string | null;
  owning_agent_id: string | null;
  state_machine_arn: string | null;
  state_machine_alias_arn: string | null;
  current_version: number | null;
};

type JobRoutineWorkflowAslVersion = {
  id: string;
  version_number: number;
  state_machine_arn: string | null;
  version_arn: string;
  asl_json: unknown;
  markdown_summary: string | null;
  step_manifest_json: unknown;
  published_by_actor_type: string | null;
  published_by_actor_id: string | null;
  created_at: Date | string | null;
};

type JobRoutineWorkflowProjection = {
  workflowId: string;
  workflowVersionId: string | null;
  engineBindingId: string;
};

const ROUTINE_WORKFLOW_CAPABILITIES = {
  start: true,
  monitor: true,
  cancel: true,
  retry: false,
  replay: false,
  evidence: true,
};

async function ensureRoutineWorkflowForJob(input: {
  routine: JobRoutineWorkflowRoutine;
  aslVersion: JobRoutineWorkflowAslVersion;
  triggerFamily: "schedule";
}): Promise<JobRoutineWorkflowProjection> {
  const db = getDb();
  const { routine, aslVersion } = input;
  const [existingBinding] = await db
    .select({
      id: workflowEngineBindings.id,
      workflow_id: workflowEngineBindings.workflow_id,
      workflow_version_id: workflowEngineBindings.workflow_version_id,
    })
    .from(workflowEngineBindings)
    .where(
      and(
        eq(workflowEngineBindings.tenant_id, routine.tenant_id),
        eq(workflowEngineBindings.routine_id, routine.id),
      ),
    )
    .limit(1);

  if (existingBinding) {
    const workflowVersion = await ensureRoutineWorkflowVersionForJob(
      existingBinding.workflow_id,
      routine,
      aslVersion,
    );
    await db
      .update(workflows)
      .set({
        name: routine.name ?? "Untitled routine",
        description: routine.description ?? null,
        lifecycle_status: "active",
        visibility:
          routine.visibility === "tenant_shared"
            ? "tenant_shared"
            : "agent_private",
        owner_agent_id: routine.owning_agent_id ?? routine.agent_id ?? null,
        current_version_id: workflowVersion.id,
        current_version_number: aslVersion.version_number,
        capability_flags: ROUTINE_WORKFLOW_CAPABILITIES,
        readiness_state: "ready",
        readiness_reasons: [],
        updated_at: new Date(),
      })
      .where(eq(workflows.id, existingBinding.workflow_id));
    await db
      .update(workflowEngineBindings)
      .set({
        workflow_version_id: workflowVersion.id,
        routine_asl_version_id: aslVersion.id,
        external_workflow_name: routine.name ?? null,
        external_version_id: String(aslVersion.version_number),
        connection_ref: {
          stateMachineArn: routine.state_machine_arn,
          aliasArn: routine.state_machine_alias_arn,
        },
        binding_status: "ready",
        capability_flags: ROUTINE_WORKFLOW_CAPABILITIES,
        readiness_state: "ready",
        readiness_reasons: [],
        updated_at: new Date(),
      })
      .where(eq(workflowEngineBindings.id, existingBinding.id));
    await ensureRoutineWorkflowTriggerForJob(
      routine,
      existingBinding.workflow_id,
      workflowVersion.id,
    );
    return {
      workflowId: existingBinding.workflow_id,
      workflowVersionId: workflowVersion.id,
      engineBindingId: existingBinding.id,
    };
  }

  const [workflow] = await db
    .insert(workflows)
    .values({
      tenant_id: routine.tenant_id,
      name: routine.name ?? "Untitled routine",
      slug: `routine-${routine.id}`,
      description: routine.description ?? null,
      lifecycle_status: "active",
      visibility:
        routine.visibility === "tenant_shared"
          ? "tenant_shared"
          : "agent_private",
      owner_agent_id: routine.owning_agent_id ?? routine.agent_id ?? null,
      primary_trigger_family: input.triggerFamily,
      capability_flags: ROUTINE_WORKFLOW_CAPABILITIES,
      readiness_state: "ready",
      readiness_reasons: [],
    })
    .returning({ id: workflows.id });
  const workflowVersion = await ensureRoutineWorkflowVersionForJob(
    workflow.id,
    routine,
    aslVersion,
  );
  await db
    .update(workflows)
    .set({
      current_version_id: workflowVersion.id,
      current_version_number: aslVersion.version_number,
      updated_at: new Date(),
    })
    .where(eq(workflows.id, workflow.id));
  const [binding] = await db
    .insert(workflowEngineBindings)
    .values({
      tenant_id: routine.tenant_id,
      workflow_id: workflow.id,
      workflow_version_id: workflowVersion.id,
      binding_type: "step_functions_routine",
      binding_status: "ready",
      routine_id: routine.id,
      routine_asl_version_id: aslVersion.id,
      external_workflow_id: routine.id,
      external_workflow_name: routine.name ?? null,
      external_version_id: String(aslVersion.version_number),
      connection_ref: {
        stateMachineArn: routine.state_machine_arn,
        aliasArn: routine.state_machine_alias_arn,
      },
      capability_flags: ROUTINE_WORKFLOW_CAPABILITIES,
      readiness_state: "ready",
      readiness_reasons: [],
    })
    .returning({ id: workflowEngineBindings.id });
  await ensureRoutineWorkflowTriggerForJob(
    routine,
    workflow.id,
    workflowVersion.id,
  );

  return {
    workflowId: workflow.id,
    workflowVersionId: workflowVersion.id,
    engineBindingId: binding.id,
  };
}

async function ensureRoutineWorkflowVersionForJob(
  workflowId: string,
  routine: JobRoutineWorkflowRoutine,
  aslVersion: JobRoutineWorkflowAslVersion,
): Promise<{ id: string }> {
  const db = getDb();
  const [existing] = await db
    .select({ id: workflowVersions.id })
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.workflow_id, workflowId),
        eq(workflowVersions.version_number, aslVersion.version_number),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [version] = await db
    .insert(workflowVersions)
    .values({
      tenant_id: routine.tenant_id,
      workflow_id: workflowId,
      version_number: aslVersion.version_number,
      version_status: "active",
      source_kind: "step_functions_routine",
      source_metadata: {
        routineId: routine.id,
        stateMachineArn:
          aslVersion.state_machine_arn ?? routine.state_machine_arn,
        versionArn: aslVersion.version_arn,
      },
      definition_snapshot: {
        routineId: routine.id,
        routineName: routine.name,
        asl: aslVersion.asl_json,
        markdownSummary: aslVersion.markdown_summary,
        stepManifest: aslVersion.step_manifest_json,
      },
      capability_snapshot: ROUTINE_WORKFLOW_CAPABILITIES,
      routine_asl_version_id: aslVersion.id,
      created_by_actor_type: aslVersion.published_by_actor_type,
      created_by_actor_id: aslVersion.published_by_actor_id,
      published_at: aslVersion.created_at
        ? new Date(aslVersion.created_at)
        : new Date(),
    })
    .returning({ id: workflowVersions.id });
  return version;
}

async function ensureRoutineWorkflowTriggerForJob(
  routine: JobRoutineWorkflowRoutine,
  workflowId: string,
  workflowVersionId: string,
): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({ id: workflowTriggers.id })
    .from(workflowTriggers)
    .where(
      and(
        eq(workflowTriggers.workflow_id, workflowId),
        eq(workflowTriggers.trigger_family, "schedule"),
      ),
    )
    .limit(1);
  if (existing) {
    await db
      .update(workflowTriggers)
      .set({
        workflow_version_id: workflowVersionId,
        enabled: true,
        trigger_config: { routineId: routine.id },
        actor_contract: {
          agentVisible: routine.visibility === "tenant_shared",
        },
        readiness_state: "ready",
        readiness_reasons: [],
        updated_at: new Date(),
      })
      .where(eq(workflowTriggers.id, existing.id));
    return;
  }

  await db.insert(workflowTriggers).values({
    tenant_id: routine.tenant_id,
    workflow_id: workflowId,
    workflow_version_id: workflowVersionId,
    trigger_family: "schedule",
    source_system: "routine",
    enabled: true,
    idempotency_required: true,
    trigger_config: { routineId: routine.id },
    actor_contract: { agentVisible: routine.visibility === "tenant_shared" },
    readiness_state: "ready",
    readiness_reasons: [],
  });
}

async function createRoutineWorkflowRunForJob(input: {
  routine: JobRoutineWorkflowRoutine;
  aslVersion: JobRoutineWorkflowAslVersion;
  projection: JobRoutineWorkflowProjection;
  executionArn: string;
  routineExecutionId: string | null;
  triggerId: string;
  scheduleName: string | null;
  agentId: string | null;
  spaceId: string | null;
  startedAt: Date;
}): Promise<void> {
  const db = getDb();
  const [run] = await db
    .insert(workflowRuns)
    .values({
      tenant_id: input.routine.tenant_id,
      workflow_id: input.projection.workflowId,
      workflow_version_id: input.projection.workflowVersionId,
      engine_binding_id: input.projection.engineBindingId,
      status: "running",
      trigger_family: "schedule",
      trigger_source: "schedule",
      idempotency_key: `routine-execution:${input.executionArn}`,
      correlation_id: input.executionArn,
      backend_execution_id: input.executionArn,
      backend_execution_ref: {
        routineId: input.routine.id,
        routineExecutionId: input.routineExecutionId,
        stateMachineArn: input.routine.state_machine_arn,
        aliasArn: input.routine.state_machine_alias_arn,
        versionArn: input.aslVersion.version_arn,
        routineAslVersionId: input.aslVersion.id,
      },
      capability_snapshot: ROUTINE_WORKFLOW_CAPABILITIES,
      readiness_snapshot: { state: "ready", reasons: [] },
      input_summary: {
        triggerId: input.triggerId,
        scheduleName: input.scheduleName,
        agentId: input.agentId,
        spaceId: input.spaceId,
      },
      started_at: input.startedAt,
      last_event_at: input.startedAt,
    })
    .returning({ id: workflowRuns.id });

  await db
    .update(workflows)
    .set({
      last_run_id: run.id,
      last_run_at: input.startedAt,
      updated_at: new Date(),
    })
    .where(eq(workflows.id, input.projection.workflowId));

  await db.insert(workflowEvidence).values({
    tenant_id: input.routine.tenant_id,
    workflow_id: input.projection.workflowId,
    workflow_run_id: run.id,
    evidence_type: "step_functions_execution",
    source_system: "aws_step_functions",
    source_id: input.executionArn,
    uri: input.executionArn,
    summary: {
      routineId: input.routine.id,
      routineExecutionId: input.routineExecutionId,
      stateMachineArn: input.routine.state_machine_arn,
      aliasArn: input.routine.state_machine_alias_arn,
      versionArn: input.aslVersion.version_arn,
      routineAslVersionId: input.aslVersion.id,
    },
    redaction_state: "summary_only",
  });
}

function runtimeFunctionName(envName: string, handlerName: string): string {
  const explicit = process.env[envName];
  if (explicit) return explicit;
  const stage = process.env.STAGE;
  if (stage) return `thinkwork-${stage}-api-${handlerName}`;
  throw new Error(
    `Routines runtime is misconfigured: ${envName} env var is not set`,
  );
}
