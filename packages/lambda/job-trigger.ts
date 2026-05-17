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
 *   { triggerId, triggerType, tenantId, agentId?, routineId?, prompt?, scheduleName?, oneTime? }
 */

import { createHash, randomBytes } from "node:crypto";
import { getDb, ensureThreadForWork } from "@thinkwork/database-pg";
import {
  agents,
  agentSkills,
  agentTemplates,
  computers,
  computerEvents,
  computerTasks,
  evalRuns,
  messages,
  routineExecutions,
  routines,
  scheduledJobs,
  skillRuns,
  tenantSettings,
  threadTurns,
  users,
} from "@thinkwork/database-pg/schema";
import { and, eq, sql } from "drizzle-orm";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";

const DEFAULT_EVAL_MODEL_ID = "moonshotai.kimi-k2.5";

// Module-scope SFN client so warm Lambda invocations reuse the TCP pool.
const _SFN_CLIENT = new SFNClient({
  requestHandler: { requestTimeout: 15_000, connectionTimeout: 5_000 },
});

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

type ScheduledComputerTarget = {
  id: string;
  ownerUserId: string | null;
  migratedAgentId: string | null;
};

async function resolveDefaultEvalTemplateId(
  tenantId: string,
  requestedTemplateId?: string | null,
): Promise<string> {
  if (requestedTemplateId) {
    const [template] = await getDb()
      .select({
        id: agentTemplates.id,
        templateKind: agentTemplates.template_kind,
      })
      .from(agentTemplates)
      .where(
        and(
          eq(agentTemplates.id, requestedTemplateId),
          eq(agentTemplates.tenant_id, tenantId),
        ),
      )
      .limit(1);
    if (!template) throw new Error("Scheduled eval Agent template not found");
    if (template.templateKind !== "agent") {
      throw new Error(
        "Scheduled evals currently require an Agent template target",
      );
    }
    return template.id;
  }

  const [defaultTemplate] = await getDb()
    .select({ id: agentTemplates.id })
    .from(agentTemplates)
    .where(
      and(
        eq(agentTemplates.tenant_id, tenantId),
        eq(agentTemplates.slug, "default"),
        eq(agentTemplates.template_kind, "agent"),
      ),
    )
    .limit(1);
  if (defaultTemplate) return defaultTemplate.id;

  const [firstTemplate] = await getDb()
    .select({ id: agentTemplates.id })
    .from(agentTemplates)
    .where(
      and(
        eq(agentTemplates.tenant_id, tenantId),
        eq(agentTemplates.template_kind, "agent"),
      ),
    )
    .limit(1);
  if (!firstTemplate)
    throw new Error("No Agent template found for scheduled eval");
  return firstTemplate.id;
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

async function resolveComputerForAgentSchedule(input: {
  tenantId: string;
  agentId: string;
}): Promise<ScheduledComputerTarget | null> {
  const db = getDb();
  const [computer] = await db
    .select({
      id: computers.id,
      ownerUserId: computers.owner_user_id,
      migratedAgentId: computers.migrated_from_agent_id,
    })
    .from(computers)
    .where(
      and(
        eq(computers.tenant_id, input.tenantId),
        eq(computers.migrated_from_agent_id, input.agentId),
        sql`${computers.status} <> 'archived'`,
      ),
    )
    .limit(1);

  return computer ?? null;
}

async function enqueueScheduledComputerThreadTurn(input: {
  tenantId: string;
  computerId: string;
  threadId: string;
  messageId: string;
  triggerId: string;
  triggerType: string;
  scheduleName?: string;
  actorType: "user" | "system";
  actorId?: string | null;
}) {
  const db = getDb();
  const idempotencyKey = [
    "scheduled-thread-turn",
    input.triggerId,
    input.messageId,
  ].join(":");
  const taskInput = {
    threadId: input.threadId,
    messageId: input.messageId,
    source: "schedule",
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    requesterUserId:
      input.actorType === "user" ? (input.actorId ?? null) : null,
    contextClass:
      input.actorType === "user" && input.actorId ? "user" : "system",
    triggerId: input.triggerId,
    triggerType: input.triggerType,
    scheduleName: input.scheduleName ?? null,
  };

  const [task] = await db
    .insert(computerTasks)
    .values({
      tenant_id: input.tenantId,
      computer_id: input.computerId,
      task_type: "thread_turn",
      status: "pending",
      input: taskInput,
      idempotency_key: idempotencyKey,
      created_by_user_id: input.actorType === "user" ? input.actorId : null,
    })
    .onConflictDoNothing({
      target: [
        computerTasks.tenant_id,
        computerTasks.computer_id,
        computerTasks.idempotency_key,
      ],
      where: sql`${computerTasks.idempotency_key} IS NOT NULL`,
    })
    .returning({ id: computerTasks.id });

  if (task) {
    await db.insert(computerEvents).values({
      tenant_id: input.tenantId,
      computer_id: input.computerId,
      task_id: task.id,
      event_type: "scheduled_thread_turn_enqueued",
      level: "info",
      payload: {
        threadId: input.threadId,
        messageId: input.messageId,
        triggerId: input.triggerId,
        triggerType: input.triggerType,
        scheduleName: input.scheduleName ?? null,
        requesterUserId:
          input.actorType === "user" ? (input.actorId ?? null) : null,
      },
    });
  }

  return task ?? null;
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
      const jobTitle = job?.name || `Scheduled job ${triggerId.slice(0, 8)}`;
      const isUserScheduled =
        job?.created_by_type === "user" && !!job?.created_by_id;
      const computer = await resolveComputerForAgentSchedule({
        tenantId,
        agentId,
      });

      if (computer) {
        const requesterUserId = isUserScheduled ? job!.created_by_id : null;
        if (!requesterUserId) {
          console.warn(
            `[job-trigger] Computer ${computer.id} scheduled job ${triggerId} has no requester user; skipping requester-scoped scheduled turn`,
          );
          await db.insert(computerEvents).values({
            tenant_id: tenantId,
            computer_id: computer.id,
            event_type: "scheduled_thread_turn_skipped",
            level: "warn",
            payload: {
              triggerId,
              triggerType,
              scheduleName: scheduleName ?? null,
              reason: "requester_user_required",
            },
          });
          return;
        }

        const result = await ensureThreadForWork({
          tenantId,
          computerId: computer.id,
          userId: requesterUserId,
          title: jobTitle,
          channel: "schedule",
        });
        const threadId = result.threadId;
        const messageContent =
          prompt?.trim() ||
          `Scheduled job fired: ${jobTitle}. Handle the scheduled work for this Computer.`;
        const [message] = await db
          .insert(messages)
          .values({
            thread_id: threadId,
            tenant_id: tenantId,
            role: "user",
            content: messageContent,
            sender_type: "user",
            sender_id: requesterUserId,
            metadata: {
              source: "scheduled_job",
              triggerId,
              triggerType,
              scheduleName: scheduleName ?? null,
              requesterUserId,
            },
          })
          .returning({ id: messages.id });
        await enqueueScheduledComputerThreadTurn({
          tenantId,
          computerId: computer.id,
          threadId,
          messageId: message.id,
          triggerId,
          triggerType,
          scheduleName,
          actorType: "user",
          actorId: requesterUserId,
        });

        // Keep the migrated Agent heartbeat fresh because it remains the
        // managed execution substrate behind this Computer.
        await db
          .update(agents)
          .set({ last_heartbeat_at: new Date() })
          .where(eq(agents.id, agentId));

        console.log(
          `[job-trigger] Computer thread_turn queued for computer ${computer.id} from scheduled agent ${agentId}`,
        );
      } else {
        console.log(
          `[job-trigger] No Computer found for scheduled agent ${agentId}; legacy Agent wakeup disabled`,
        );
      }
    } else if (triggerType === "eval_scheduled") {
      // Eval-scheduled jobs: insert a pending eval_runs row + fire the
      // eval-runner Lambda async. Evals now run directly against a
      // platform-managed AgentCore agent for the selected/default Agent
      // template; Computer evals are intentionally out of this slice.
      const cfg = (job?.config ?? {}) as {
        agentId?: string;
        agentTemplateId?: string;
        computerId?: string;
        model?: string;
        categories?: string[];
      };
      let targetAgentId: string | null = null;
      let targetTemplateId: string;
      try {
        if (cfg.computerId) {
          throw new Error(
            "Scheduled eval Computer targets are no longer supported",
          );
        }
        if (cfg.model && cfg.model !== DEFAULT_EVAL_MODEL_ID) {
          throw new Error(
            `Scheduled eval model overrides are no longer supported; use ${DEFAULT_EVAL_MODEL_ID}`,
          );
        }
        if (cfg.agentId) {
          const [agent] = await db
            .select({ id: agents.id, templateId: agents.template_id })
            .from(agents)
            .where(
              and(eq(agents.id, cfg.agentId), eq(agents.tenant_id, tenantId)),
            )
            .limit(1);
          if (!agent) throw new Error("Scheduled eval Agent not found");
          targetAgentId = agent.id;
          targetTemplateId = agent.templateId;
        } else {
          targetTemplateId = await resolveDefaultEvalTemplateId(
            tenantId,
            cfg.agentTemplateId,
          );
        }
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
          computer_id: null,
          agent_template_id: targetTemplateId,
          scheduled_job_id: triggerId,
          status: "pending",
          model: DEFAULT_EVAL_MODEL_ID,
          categories: cfg.categories ?? [],
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
          engine: routines.engine,
          state_machine_arn: routines.state_machine_arn,
          state_machine_alias_arn: routines.state_machine_alias_arn,
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
        } else {
          try {
            const routineInput = buildRoutineExecutionInput(
              {
                triggerId,
                triggerSource: "schedule",
                scheduleName: scheduleName ?? null,
              },
              {
                tenantId,
                routineId,
              },
            );
            const startResp = await _SFN_CLIENT.send(
              new StartExecutionCommand({
                stateMachineArn: routine.state_machine_alias_arn,
                input: JSON.stringify(routineInput),
              }),
            );
            if (startResp.executionArn) {
              await db.insert(routineExecutions).values({
                tenant_id: tenantId,
                routine_id: routineId,
                state_machine_arn: routine.state_machine_arn,
                alias_arn: routine.state_machine_alias_arn,
                sfn_execution_arn: startResp.executionArn,
                trigger_id: triggerId,
                trigger_source: "schedule",
                input_json: { triggerId, scheduleName: scheduleName ?? null },
                status: "running",
                started_at: startResp.startDate ?? new Date(),
              });
              console.log(
                `[job-trigger] Started SFN execution ${startResp.executionArn} for routine ${routineId}`,
              );
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

function runtimeFunctionName(envName: string, handlerName: string): string {
  const explicit = process.env[envName];
  if (explicit) return explicit;
  const stage = process.env.STAGE;
  if (stage) return `thinkwork-${stage}-api-${handlerName}`;
  throw new Error(
    `Routines runtime is misconfigured: ${envName} env var is not set`,
  );
}
