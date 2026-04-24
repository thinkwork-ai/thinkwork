/**
 * Unified Job Trigger Lambda
 *
 * Invoked by AWS EventBridge Scheduler when any scheduled job fires.
 *
 * For agent jobs: creates a thread + inserts wakeup request (wakeup-processor handles dispatch)
 * For routine jobs: creates thread_turns record + invokes routine runner
 * For one-time jobs: auto-deletes EventBridge schedule after firing
 *
 * Event payload (set by job-schedule-manager when creating the rule):
 *   { triggerId, triggerType, tenantId, agentId?, routineId?, prompt?, scheduleName?, oneTime? }
 */

import { createHash, randomBytes } from "node:crypto";
import { getDb, ensureThreadForWork } from "@thinkwork/database-pg";
import {
  agentWakeupRequests,
  agents,
  agentSkills,
  evalRuns,
  scheduledJobs,
  skillRuns,
  tenantSettings,
  threadTurns,
  users,
} from "@thinkwork/database-pg/schema";
import { and, eq, sql } from "drizzle-orm";

interface JobTriggerEvent {
  triggerId: string;
  // agent_heartbeat | agent_reminder | agent_scheduled | routine_schedule |
  // routine_one_time | eval_scheduled | skill_run (Unit 6) | manual | webhook | event
  triggerType: string;
  tenantId: string;
  agentId?: string;
  routineId?: string;
  prompt?: string;
  scheduleName?: string;
  oneTime?: boolean;
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
    const { LambdaClient, InvokeCommand } =
      await import("@aws-sdk/client-lambda");
    // Plan §U4: kind=run_skill uses InvocationType: Event so the agent
    // loop has the full 900s AgentCore Lambda budget. Execution result
    // comes back via the HMAC-signed /api/skills/complete callback.
    const lambda = new LambdaClient({});
    const envelope = {
      kind: "run_skill" as const,
      runId: payload.runId,
      tenantId: payload.tenantId,
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
              authorization: `Bearer ${process.env.THINKWORK_API_SECRET || process.env.API_AUTH_SECRET || ""}`,
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

    // Guard: check if the job is still enabled before executing
    const [job] = await db
      .select({
        enabled: scheduledJobs.enabled,
        name: scheduledJobs.name,
        config: scheduledJobs.config,
        created_by_type: scheduledJobs.created_by_type,
        created_by_id: scheduledJobs.created_by_id,
      })
      .from(scheduledJobs)
      .where(eq(scheduledJobs.id, triggerId));
    if (job && !job.enabled) {
      console.log(
        `[job-trigger] Job ${triggerId} is disabled, skipping execution`,
      );
      return;
    }

    const isAgentJob = triggerType.startsWith("agent_");

    if (isAgentJob && agentId) {
      // Agent jobs: create a thread for tracking, then insert wakeup request
      const jobTitle = job?.name || `Scheduled job ${triggerId.slice(0, 8)}`;
      const result = await ensureThreadForWork({
        tenantId,
        agentId,
        title: jobTitle,
        channel: "schedule",
      });
      const threadId = result.threadId;
      console.log(
        `[job-trigger] Created thread ${result.identifier} for agent ${agentId}`,
      );

      const source =
        triggerType === "agent_heartbeat"
          ? "timer"
          : triggerType === "agent_reminder"
            ? "on_demand"
            : "trigger";

      const reason =
        triggerType === "agent_heartbeat"
          ? "heartbeat_timer"
          : prompt
            ? "Scheduled wakeup with prompt"
            : `trigger:${triggerType}`;

      // Propagate the scheduled job's creator to the wakeup row.
      // Only "user" actors carry an invoker id downstream — system /
      // agent creators stay as "system" per R15 so CURRENT_USER_ID
      // is never forged from an agent's own identity.
      const isUserScheduled =
        job?.created_by_type === "user" && !!job?.created_by_id;
      await db.insert(agentWakeupRequests).values({
        tenant_id: tenantId,
        agent_id: agentId,
        source,
        reason,
        trigger_detail: scheduleName
          ? `schedule:${scheduleName}`
          : `job:${triggerId}`,
        payload: prompt
          ? { message: prompt, triggerId, ...(threadId && { threadId }) }
          : { triggerId, ...(threadId && { threadId }) },
        requested_by_actor_type: isUserScheduled ? "user" : "system",
        requested_by_actor_id: isUserScheduled ? job!.created_by_id : null,
      });

      // Update agent last_heartbeat_at
      await db
        .update(agents)
        .set({ last_heartbeat_at: new Date() })
        .where(eq(agents.id, agentId));

      console.log(`[job-trigger] Wakeup request created for agent ${agentId}`);
    } else if (triggerType === "eval_scheduled") {
      // Eval-scheduled jobs: insert a pending eval_runs row + fire the
      // eval-runner Lambda async. Config carries the agent + categories
      // + model selection (set by the EvalScheduleDialog UI).
      const cfg = (job?.config ?? {}) as {
        agentId?: string;
        model?: string;
        categories?: string[];
      };
      const [run] = await db
        .insert(evalRuns)
        .values({
          tenant_id: tenantId,
          agent_id: cfg.agentId ?? agentId ?? null,
          status: "pending",
          model: cfg.model ?? null,
          categories: cfg.categories ?? [],
        })
        .returning();
      console.log(
        `[job-trigger] Created eval_run ${run.id} for scheduled trigger ${triggerId}`,
      );

      try {
        const { LambdaClient, InvokeCommand } =
          await import("@aws-sdk/client-lambda");
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
      // Routine jobs: create a thread_turns record + invoke routine runner
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
        })
        .returning();

      console.log(
        `[job-trigger] Created thread_turn ${run.id} for routine ${routineId}`,
      );

      // Invoke routine runner if configured
      const routineRunnerUrl = process.env.ROUTINE_RUNNER_URL;
      const routineAuthSecret = process.env.ROUTINE_AUTH_SECRET;
      if (routineRunnerUrl && routineAuthSecret) {
        try {
          const response = await fetch(`${routineRunnerUrl}/routine/trigger`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${routineAuthSecret}`,
            },
            body: JSON.stringify({
              routineId,
              runId: run.id,
              tenantId,
              triggerId,
            }),
          });
          if (!response.ok) {
            const errText = await response.text();
            console.error(
              `[job-trigger] Routine runner error: ${response.status} ${errText}`,
            );
          }
        } catch (runnerErr) {
          console.error(
            `[job-trigger] Failed to invoke routine runner:`,
            runnerErr,
          );
        }
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
        const { SchedulerClient, DeleteScheduleCommand } =
          await import("@aws-sdk/client-scheduler");
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
