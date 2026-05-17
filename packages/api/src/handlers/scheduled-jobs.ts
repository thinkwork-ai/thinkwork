/**
 * Scheduled Jobs REST Handler
 *
 * Unified handler for scheduled jobs, trigger runs, events, and on-demand wakeups.
 *
 * Routes:
 *   GET    /api/scheduled-jobs                    — List scheduled jobs
 *   POST   /api/scheduled-jobs                    — Create scheduled job
 *   GET    /api/scheduled-jobs/:id                — Get scheduled job detail
 *   PUT    /api/scheduled-jobs/:id                — Update scheduled job
 *   DELETE /api/scheduled-jobs/:id                — Delete (disable) scheduled job
 *   POST   /api/scheduled-jobs/:id/fire           — Manual fire now
 *
 *   GET    /api/thread-turns                — List runs
 *   GET    /api/thread-turns/:id            — Get run detail
 *   POST   /api/thread-turns/:id/cancel     — Cancel run
 *   GET    /api/thread-turns/:id/events     — Event stream
 *
 *   POST   /api/thread-turns/wakeup/:agentId — On-demand agent wakeup
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and, desc, gt, sql } from "drizzle-orm";
import {
  scheduledJobs,
  threadTurns,
  threadTurnEvents,
  agentWakeupRequests,
  agents,
  computers,
  computerTasks,
  computerEvents,
  evalRuns,
  messages,
} from "@thinkwork/database-pg/schema";
import { db } from "../lib/db.js";
import {
  requireTenantMembership,
  type TenantMemberRole,
} from "../lib/tenant-membership.js";
import { json, error, notFound } from "../lib/response.js";
import { ensureThreadForWork } from "../lib/thread-helpers.js";
import {
  ensureEvalAgentForTemplate,
  resolveEvalTemplateId,
} from "../lib/evals/eval-agent-provisioning.js";

const DEFAULT_EVAL_MODEL_ID = "moonshotai.kimi-k2.5";

// ---------------------------------------------------------------------------
// Job Schedule Manager — invoke to create/update/delete EventBridge schedules
// ---------------------------------------------------------------------------

let _jobScheduleManagerFnArn: string | null | undefined;
async function getJobScheduleManagerFnArn(): Promise<string | null> {
  if (_jobScheduleManagerFnArn !== undefined) return _jobScheduleManagerFnArn;
  try {
    let stage = process.env.STAGE || process.env.STAGE || "";
    if (!stage && process.env.SST_RESOURCE_App) {
      try {
        stage = JSON.parse(process.env.SST_RESOURCE_App).stage;
      } catch {}
    }
    if (!stage) stage = "dev";
    const { SSMClient, GetParameterCommand } =
      await import("@aws-sdk/client-ssm");
    const ssm = new SSMClient({});
    const res = await ssm.send(
      new GetParameterCommand({
        Name: `/thinkwork/${stage}/job-schedule-manager-fn-arn`,
      }),
    );
    _jobScheduleManagerFnArn = res.Parameter?.Value || null;
  } catch {
    _jobScheduleManagerFnArn = null;
  }
  return _jobScheduleManagerFnArn;
}

type ScheduleManagerResult = { ok: true } | { ok: false; error: string };

async function invokeJobScheduleManager(
  method: string,
  body: Record<string, unknown>,
): Promise<ScheduleManagerResult> {
  try {
    const fnArn = await getJobScheduleManagerFnArn();
    if (!fnArn) {
      const msg =
        "Job schedule manager Lambda ARN not configured (SSM parameter missing)";
      console.error("[scheduled-jobs]", msg);
      return { ok: false, error: msg };
    }
    const { LambdaClient, InvokeCommand } =
      await import("@aws-sdk/client-lambda");
    const lambda = new LambdaClient({});
    const res = await lambda.send(
      new InvokeCommand({
        FunctionName: fnArn,
        InvocationType: "RequestResponse",
        Payload: new TextEncoder().encode(
          JSON.stringify({
            body: JSON.stringify(body),
            requestContext: { http: { method } },
            rawPath: "/api/job-schedules",
            headers: {
              authorization: `Bearer ${process.env.API_AUTH_SECRET || ""}`,
            },
          }),
        ),
      }),
    );
    const rawPayload = res.Payload ? new TextDecoder().decode(res.Payload) : "";
    if (res.FunctionError) {
      console.error(
        "[scheduled-jobs] Job schedule manager Lambda error:",
        res.FunctionError,
        rawPayload,
      );
      return {
        ok: false,
        error: `Job schedule manager threw: ${rawPayload || res.FunctionError}`,
      };
    }
    if (rawPayload) {
      try {
        const parsed = JSON.parse(rawPayload) as {
          statusCode?: number;
          body?: string;
        };
        if (typeof parsed.statusCode === "number" && parsed.statusCode >= 400) {
          const inner =
            typeof parsed.body === "string"
              ? parsed.body
              : JSON.stringify(parsed.body);
          console.error(
            "[scheduled-jobs] Job schedule manager returned",
            parsed.statusCode,
            inner,
          );
          return {
            ok: false,
            error: `Job schedule manager returned ${parsed.statusCode}: ${inner}`,
          };
        }
      } catch {
        // Non-JSON response — treat as opaque success since no FunctionError was set
      }
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      "[scheduled-jobs] Failed to invoke job schedule manager:",
      err,
    );
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * Enforce tenant membership for every HTTP route in this handler.
 *
 * All routes here are user-facing (admin SPA / mobile / CLI). AWS
 * Scheduler does NOT reach these endpoints — it invokes
 * `packages/lambda/job-trigger.ts` directly via the Lambda SDK. So
 * every route, including `/fire` and `/wakeup`, must verify that the
 * caller is a member of the target tenant.
 */
async function checkMembership(
  event: APIGatewayProxyEventV2,
  method: string,
): Promise<
  | { ok: true; tenantId: string; userId: string | null }
  | { ok: false; response: APIGatewayProxyStructuredResultV2 }
> {
  const tenantHeader = event.headers["x-tenant-id"];
  if (!tenantHeader) {
    return { ok: false, response: error("Missing x-tenant-id header") };
  }
  const requiredRoles: TenantMemberRole[] =
    method === "GET" ? ["owner", "admin", "member"] : ["owner", "admin"];
  const verdict = await requireTenantMembership(event, tenantHeader, {
    requiredRoles,
  });
  if (!verdict.ok)
    return { ok: false, response: error(verdict.reason, verdict.status) };
  return { ok: true, tenantId: verdict.tenantId, userId: verdict.userId };
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method === "OPTIONS")
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Allow-Headers": "*",
      },
      body: "",
    };

  const method = event.requestContext.http.method;
  const path = event.rawPath;

  try {
    // --- Scheduled Jobs (definitions) ---

    // POST /api/scheduled-jobs/:id/fire — manual fire (admin-SPA button, NOT a scheduler callback)
    const fireMatch = path.match(/^\/api\/scheduled-jobs\/([^/]+)\/fire$/);
    if (fireMatch) {
      if (method !== "POST") return error("Method not allowed", 405);
      const check = await checkMembership(event, method);
      if (!check.ok) return check.response;
      return fireScheduledJob(
        fireMatch[1],
        event,
        check.tenantId,
        check.userId,
      );
    }

    // GET/PUT/DELETE /api/scheduled-jobs/:id
    const triggerIdMatch = path.match(/^\/api\/scheduled-jobs\/([^/]+)$/);
    if (triggerIdMatch) {
      if (method !== "GET" && method !== "PUT" && method !== "DELETE") {
        return error("Method not allowed", 405);
      }
      const check = await checkMembership(event, method);
      if (!check.ok) return check.response;
      if (method === "GET")
        return getScheduledJob(triggerIdMatch[1], check.tenantId);
      if (method === "PUT")
        return updateScheduledJob(triggerIdMatch[1], event, check.tenantId);
      return deleteScheduledJob(triggerIdMatch[1], event, check.tenantId);
    }

    // GET/POST /api/scheduled-jobs
    if (path === "/api/scheduled-jobs") {
      if (method !== "GET" && method !== "POST") {
        return error("Method not allowed", 405);
      }
      const check = await checkMembership(event, method);
      if (!check.ok) return check.response;
      if (method === "GET") return listScheduledJobs(event, check.tenantId);
      return createScheduledJob(event, check.tenantId);
    }

    // --- Trigger Runs ---

    // POST /api/thread-turns/wakeup/:agentId — on-demand wakeup (admin-SPA, NOT scheduler callback)
    const wakeupMatch = path.match(/^\/api\/trigger-runs\/wakeup\/([^/]+)$/);
    if (wakeupMatch) {
      if (method !== "POST") return error("Method not allowed", 405);
      const check = await checkMembership(event, method);
      if (!check.ok) return check.response;
      return triggerWakeup(wakeupMatch[1], event, check.tenantId);
    }

    // GET /api/thread-turns/:id/events
    const eventsMatch = path.match(/^\/api\/trigger-runs\/([^/]+)\/events$/);
    if (eventsMatch) {
      if (method !== "GET") return error("Method not allowed", 405);
      const check = await checkMembership(event, method);
      if (!check.ok) return check.response;
      return listEvents(eventsMatch[1], event, check.tenantId);
    }

    // POST /api/thread-turns/:id/cancel
    const cancelMatch = path.match(/^\/api\/trigger-runs\/([^/]+)\/cancel$/);
    if (cancelMatch) {
      if (method !== "POST") return error("Method not allowed", 405);
      const check = await checkMembership(event, method);
      if (!check.ok) return check.response;
      return cancelRun(cancelMatch[1], check.tenantId);
    }

    // GET /api/thread-turns/:id
    const runIdMatch = path.match(/^\/api\/trigger-runs\/([^/]+)$/);
    if (runIdMatch) {
      if (method !== "GET") return error("Method not allowed", 405);
      const check = await checkMembership(event, method);
      if (!check.ok) return check.response;
      return getRun(runIdMatch[1], check.tenantId);
    }

    // GET /api/thread-turns
    if (path === "/api/thread-turns") {
      if (method !== "GET") return error("Method not allowed", 405);
      const check = await checkMembership(event, method);
      if (!check.ok) return check.response;
      return listRuns(event, check.tenantId);
    }

    return notFound("Route not found");
  } catch (err) {
    console.error("Scheduled jobs handler error:", err);
    return error("Internal server error", 500);
  }
}

// ---------------------------------------------------------------------------
// Scheduled Jobs (definitions)
// ---------------------------------------------------------------------------

async function listScheduledJobs(
  event: APIGatewayProxyEventV2,
  tenantId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const conditions = [eq(scheduledJobs.tenant_id, tenantId)];

  const params = event.queryStringParameters || {};
  if (params.agent_id)
    conditions.push(eq(scheduledJobs.agent_id, params.agent_id));
  if (params.computer_id)
    conditions.push(eq(scheduledJobs.computer_id, params.computer_id));
  if (params.routine_id)
    conditions.push(eq(scheduledJobs.routine_id, params.routine_id));
  if (params.trigger_type)
    conditions.push(eq(scheduledJobs.trigger_type, params.trigger_type));
  if (params.enabled !== undefined)
    conditions.push(eq(scheduledJobs.enabled, params.enabled === "true"));

  const rows = await db
    .select()
    .from(scheduledJobs)
    .where(and(...conditions))
    .orderBy(desc(scheduledJobs.created_at))
    .limit(100);

  return json(rows);
}

async function getScheduledJob(
  id: string,
  tenantId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const [row] = await db
    .select()
    .from(scheduledJobs)
    .where(
      and(eq(scheduledJobs.id, id), eq(scheduledJobs.tenant_id, tenantId)),
    );
  if (!row) return notFound("Trigger not found");
  return json(row);
}

async function createScheduledJob(
  event: APIGatewayProxyEventV2,
  tenantId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  let body: Record<string, unknown> = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return error("Invalid JSON body");
  }

  if (!body.name || !body.trigger_type) {
    return error("name and trigger_type are required");
  }

  const computerId = (body.computer_id as string) || null;
  if (computerId) {
    // Verify the named Computer belongs to the caller's tenant before
    // persisting the FK reference. The DB FK only enforces referential
    // integrity against `computers(id)`; without this check a tenant
    // admin could create a scheduled job referencing a foreign-tenant
    // Computer UUID. The tenant filter on later GETs would scope it
    // out, but the FK row would still belong to someone else.
    const [computerRow] = await db
      .select({ tenant_id: computers.tenant_id })
      .from(computers)
      .where(eq(computers.id, computerId));
    if (!computerRow) {
      return error(`Computer ${computerId} not found`, 400);
    }
    if (computerRow.tenant_id !== tenantId) {
      return error("Computer does not belong to this tenant", 403);
    }
  }

  const [row] = await db
    .insert(scheduledJobs)
    .values({
      tenant_id: tenantId,
      trigger_type: body.trigger_type as string,
      agent_id: (body.agent_id as string) || null,
      computer_id: computerId,
      routine_id: (body.routine_id as string) || null,
      team_id: (body.team_id as string) || null,
      name: body.name as string,
      description: (body.description as string) || null,
      prompt: (body.prompt as string) || null,
      config: (body.config as Record<string, unknown>) || null,
      schedule_type: (body.schedule_type as string) || null,
      schedule_expression: (body.schedule_expression as string) || null,
      timezone: (body.timezone as string) || "UTC",
      enabled: true,
      created_by_type: (body.created_by_type as string) || "user",
      created_by_id: (body.created_by_id as string) || null,
    })
    .returning();

  // Create EventBridge schedule if this is a timer-based trigger
  if (row.schedule_type && row.schedule_expression) {
    const result = await invokeJobScheduleManager("POST", {
      triggerId: row.id,
      tenantId,
      triggerType: row.trigger_type,
      agentId: row.agent_id || undefined,
      routineId: row.routine_id || undefined,
      name: row.name,
      scheduleType: row.schedule_type,
      scheduleExpression: row.schedule_expression,
      timezone: row.timezone,
      prompt: row.prompt || undefined,
      config: row.config || undefined,
      createdByType: "user",
    });
    if (!result.ok) {
      // Keep the DB row so the user's input isn't lost; surface a clear error
      // so they can retry via Edit → Save (which hits the update/repair path).
      return error(
        `Automation saved but EventBridge schedule could not be provisioned: ${result.error}. Open the automation and press Save to retry.`,
        502,
      );
    }
  }

  // Re-read to pick up eb_schedule_name written by the manager Lambda
  const [refreshed] = await db
    .select()
    .from(scheduledJobs)
    .where(
      and(eq(scheduledJobs.id, row.id), eq(scheduledJobs.tenant_id, tenantId)),
    );
  return json(refreshed || row, 201);
}

async function updateScheduledJob(
  id: string,
  event: APIGatewayProxyEventV2,
  tenantId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  let body: Record<string, unknown> = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return error("Invalid JSON body");
  }

  // Note: computer_id is intentionally read-only on update for v1 — re-parenting
  // a scheduled job to a different Computer isn't a supported flow. agent_id is
  // also unset here because the runtime-firing key is fixed at create-time.
  const updates: Record<string, unknown> = { updated_at: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.prompt !== undefined) updates.prompt = body.prompt;
  if (body.config !== undefined) updates.config = body.config;
  if (body.schedule_expression !== undefined)
    updates.schedule_expression = body.schedule_expression;
  if (body.schedule_type !== undefined)
    updates.schedule_type = body.schedule_type;
  if (body.timezone !== undefined) updates.timezone = body.timezone;
  if (body.enabled !== undefined) updates.enabled = body.enabled;

  const [updated] = await db
    .update(scheduledJobs)
    .set(updates)
    .where(and(eq(scheduledJobs.id, id), eq(scheduledJobs.tenant_id, tenantId)))
    .returning();

  if (!updated) return notFound("Trigger not found");

  // Update EventBridge schedule — await and surface errors so repair/edit flows are reliable
  if (updated.schedule_type && updated.schedule_expression) {
    const result = await invokeJobScheduleManager("PUT", {
      triggerId: updated.id,
      scheduleExpression: updated.schedule_expression,
      scheduleType: updated.schedule_type,
      timezone: updated.timezone,
      prompt: updated.prompt || undefined,
      config: updated.config || undefined,
      enabled: updated.enabled,
    });
    if (!result.ok) {
      return error(
        `Automation updated in database but EventBridge schedule sync failed: ${result.error}`,
        502,
      );
    }
  }

  // Re-read to pick up eb_schedule_name in case the update path provisioned a fresh schedule
  const [refreshed] = await db
    .select()
    .from(scheduledJobs)
    .where(
      and(
        eq(scheduledJobs.id, updated.id),
        eq(scheduledJobs.tenant_id, tenantId),
      ),
    );
  return json(refreshed || updated);
}

async function deleteScheduledJob(
  id: string,
  event: APIGatewayProxyEventV2,
  tenantId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  // Read the trigger first to get the eb_schedule_name before we clear it
  const [existing] = await db
    .select()
    .from(scheduledJobs)
    .where(
      and(eq(scheduledJobs.id, id), eq(scheduledJobs.tenant_id, tenantId)),
    );
  if (!existing) return notFound("Trigger not found");

  // Delete EventBridge schedule
  if (existing.eb_schedule_name) {
    invokeJobScheduleManager("DELETE", {
      triggerId: existing.id,
      ebScheduleName: existing.eb_schedule_name,
    });
  }

  // Null out FK references in trigger_runs before deleting
  await db
    .update(threadTurns)
    .set({ trigger_id: null })
    .where(eq(threadTurns.trigger_id, id));

  // Hard delete the scheduled job row
  await db
    .delete(scheduledJobs)
    .where(
      and(eq(scheduledJobs.id, id), eq(scheduledJobs.tenant_id, tenantId)),
    );

  return json({ ok: true, id });
}

async function fireScheduledJob(
  triggerId: string,
  event: APIGatewayProxyEventV2,
  tenantId: string,
  firingUserId: string | null,
): Promise<APIGatewayProxyStructuredResultV2> {
  const [trig] = await db
    .select()
    .from(scheduledJobs)
    .where(
      and(
        eq(scheduledJobs.id, triggerId),
        eq(scheduledJobs.tenant_id, tenantId),
      ),
    );
  if (!trig) return notFound("Trigger not found");

  const isAgentTrigger = trig.trigger_type.startsWith("agent_");
  const isEvalTrigger = trig.trigger_type === "eval_scheduled";

  if (isEvalTrigger) {
    // Manual fire of an eval schedule: insert a pending eval_run + fire
    // the eval-runner Lambda. Mirrors the EventBridge path in
    // packages/lambda/job-trigger.ts.
    const cfg = (trig.config ?? {}) as {
      agentId?: string;
      agentTemplateId?: string;
      computerId?: string;
      model?: string;
      categories?: string[];
    };
    let targetAgentId: string;
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
        targetTemplateId = await resolveEvalTemplateId(
          tenantId,
          cfg.agentTemplateId,
        );
        targetAgentId = (
          await ensureEvalAgentForTemplate({
            tenantId,
            templateId: targetTemplateId,
          })
        ).agentId;
      }
    } catch (err) {
      return error(err instanceof Error ? err.message : String(err), 409);
    }
    const [run] = await db
      .insert(evalRuns)
      .values({
        tenant_id: tenantId,
        agent_id: targetAgentId,
        computer_id: null,
        agent_template_id: targetTemplateId,
        scheduled_job_id: trig.id,
        status: "pending",
        model: DEFAULT_EVAL_MODEL_ID,
        categories: cfg.categories ?? [],
      })
      .returning();

    try {
      const { LambdaClient, InvokeCommand } =
        await import("@aws-sdk/client-lambda");
      const lambda = new LambdaClient({});
      const stage = process.env.STAGE || "dev";
      const fnName =
        process.env.EVAL_RUNNER_FN_ARN || `thinkwork-${stage}-api-eval-runner`;
      await lambda.send(
        new InvokeCommand({
          FunctionName: fnName,
          InvocationType: "Event",
          Payload: new TextEncoder().encode(JSON.stringify({ runId: run.id })),
        }),
      );
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
        `[scheduled-jobs] Failed to invoke eval-runner for run ${run.id}:`,
        invokeErr,
      );
      return error(`Failed to invoke eval-runner: ${message}`, 502);
    }

    return json({ ok: true, runId: run.id }, 201);
  }

  if (isAgentTrigger && (trig.agent_id || trig.computer_id)) {
    // Manual fires for agent-typed schedules MUST route through the linked
    // Computer's task queue — never through the legacy `agent_wakeup_requests`
    // path. The legacy path lands at wakeup-processor, which reads the
    // agent's `runtime` column and can dispatch to the Flue Lambda; Flue is
    // an experimental runtime that does not belong in any automation hot
    // path. The scheduled (cron) firing path in
    // `packages/lambda/job-trigger.ts` already routes through Computers —
    // this branch is the manual-fire mirror so behavior matches whichever
    // way the schedule was triggered.

    // Prefer the explicit `scheduled_jobs.computer_id` link. Fall back to
    // the `computers.migrated_from_agent_id` lookup used by the cron path
    // so legacy agent-only schedules that were migrated to a Computer keep
    // working without re-creating the row.
    let computer: {
      id: string;
      ownerUserId: string | null;
      migratedAgentId: string | null;
    } | null = null;

    if (trig.computer_id) {
      const [row] = await db
        .select({
          id: computers.id,
          ownerUserId: computers.owner_user_id,
          migratedAgentId: computers.migrated_from_agent_id,
        })
        .from(computers)
        .where(
          and(
            eq(computers.id, trig.computer_id),
            eq(computers.tenant_id, tenantId),
            sql`${computers.status} <> 'archived'`,
          ),
        )
        .limit(1);
      computer = row ?? null;
    }

    if (!computer && trig.agent_id) {
      const [row] = await db
        .select({
          id: computers.id,
          ownerUserId: computers.owner_user_id,
          migratedAgentId: computers.migrated_from_agent_id,
        })
        .from(computers)
        .where(
          and(
            eq(computers.tenant_id, tenantId),
            eq(computers.migrated_from_agent_id, trig.agent_id),
            sql`${computers.status} <> 'archived'`,
          ),
        )
        .limit(1);
      computer = row ?? null;
    }

    if (!computer) {
      return error(
        "This scheduled job has no Computer linked to it. Automations must run through a Computer — attach one to this schedule before firing.",
        409,
      );
    }

    // Identity for the run: the firing operator is the actor. Without it
    // the Computer task lands with no `created_by_user_id`, which means
    // downstream skills/memory cannot scope to a human — the same defect
    // that caused the Flue 400 in the legacy path.
    if (!firingUserId) {
      return error("Manual fire requires an authenticated user identity.", 401);
    }

    const { threadId } = await ensureThreadForWork({
      tenantId,
      computerId: computer.id,
      userId: firingUserId,
      title: trig.name,
      channel: "schedule",
    });

    const messageContent =
      (trig.prompt && trig.prompt.trim()) ||
      `Manual fire of ${trig.name}. Handle the scheduled work for this Computer.`;

    const [message] = await db
      .insert(messages)
      .values({
        thread_id: threadId,
        tenant_id: tenantId,
        role: "user",
        content: messageContent,
        sender_type: "user",
        sender_id: firingUserId,
        metadata: {
          source: "scheduled_job_manual_fire",
          triggerId,
          triggerType: trig.trigger_type,
        },
      })
      .returning({ id: messages.id });

    // Idempotency key mirrors `enqueueScheduledComputerThreadTurn` in
    // job-trigger.ts so a duplicated request (double-clicked button,
    // API retry) collapses cleanly.
    const idempotencyKey = [
      "manual-fire-thread-turn",
      triggerId,
      message.id,
    ].join(":");

    const [task] = await db
      .insert(computerTasks)
      .values({
        tenant_id: tenantId,
        computer_id: computer.id,
        task_type: "thread_turn",
        status: "pending",
        input: {
          threadId,
          messageId: message.id,
          source: "schedule",
          actorType: "user",
          actorId: firingUserId,
          triggerId,
          triggerType: trig.trigger_type,
        },
        idempotency_key: idempotencyKey,
        created_by_user_id: firingUserId,
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
        tenant_id: tenantId,
        computer_id: computer.id,
        task_id: task.id,
        event_type: "manual_fire_thread_turn_enqueued",
        level: "info",
        payload: {
          threadId,
          messageId: message.id,
          triggerId,
          triggerType: trig.trigger_type,
        },
      });
    }

    // Keep the migrated Agent heartbeat fresh for visibility parity with
    // the cron path. Best-effort — a heartbeat write failure must not
    // fail the fire.
    const heartbeatAgentId = trig.agent_id || computer.migratedAgentId;
    if (heartbeatAgentId) {
      try {
        await db
          .update(agents)
          .set({ last_heartbeat_at: new Date() })
          .where(eq(agents.id, heartbeatAgentId));
      } catch (err) {
        console.warn(
          "[scheduled-jobs] Failed to bump agent heartbeat on manual fire:",
          err,
        );
      }
    }

    return json(
      {
        ok: true,
        computerId: computer.id,
        threadId,
        messageId: message.id,
        taskId: task?.id ?? null,
        dedup: task ? false : true,
      },
      201,
    );
  } else if (trig.routine_id) {
    const [run] = await db
      .insert(threadTurns)
      .values({
        tenant_id: tenantId,
        trigger_id: triggerId,
        routine_id: trig.routine_id,
        invocation_source: "on_demand",
        trigger_detail: `manual_fire:trigger:${triggerId}`,
        status: "queued",
      })
      .returning();

    return json({ ok: true, runId: run.id }, 201);
  }

  return error("Trigger has no agent or routine target");
}

// ---------------------------------------------------------------------------
// Trigger Runs
// ---------------------------------------------------------------------------

async function listRuns(
  event: APIGatewayProxyEventV2,
  tenantId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const conditions = [eq(threadTurns.tenant_id, tenantId)];

  const params = event.queryStringParameters || {};
  if (params.agent_id)
    conditions.push(eq(threadTurns.agent_id, params.agent_id));
  if (params.routine_id)
    conditions.push(eq(threadTurns.routine_id, params.routine_id));
  if (params.trigger_id)
    conditions.push(eq(threadTurns.trigger_id, params.trigger_id));
  if (params.status) conditions.push(eq(threadTurns.status, params.status));

  const limit = Math.min(Number(params.limit) || 50, 200);

  const rows = await db
    .select()
    .from(threadTurns)
    .where(and(...conditions))
    .orderBy(desc(threadTurns.started_at))
    .limit(limit);

  return json(rows);
}

async function getRun(
  id: string,
  tenantId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const [run] = await db
    .select()
    .from(threadTurns)
    .where(and(eq(threadTurns.id, id), eq(threadTurns.tenant_id, tenantId)));
  // Cross-tenant hit falls through the tenant_id filter and returns 404,
  // preserving existence opacity across tenants.
  if (!run) return notFound("Trigger run not found");
  return json(run);
}

async function cancelRun(
  id: string,
  tenantId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const [updated] = await db
    .update(threadTurns)
    .set({ status: "cancelled", finished_at: new Date() })
    .where(
      and(
        eq(threadTurns.id, id),
        eq(threadTurns.tenant_id, tenantId),
        eq(threadTurns.status, "running"),
      ),
    )
    .returning();

  if (!updated) return notFound("Running trigger run not found");
  return json(updated);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

async function listEvents(
  runId: string,
  event: APIGatewayProxyEventV2,
  tenantId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  // Pre-check: only list events for runs owned by the caller's tenant.
  // Cross-tenant lookup returns 404 so existence isn't leaked across
  // tenants.
  const [parent] = await db
    .select({ id: threadTurns.id })
    .from(threadTurns)
    .where(and(eq(threadTurns.id, runId), eq(threadTurns.tenant_id, tenantId)))
    .limit(1);
  if (!parent) return notFound("Trigger run not found");

  const params = event.queryStringParameters || {};
  const limit = Math.min(Number(params.limit) || 100, 500);

  const conditions = [eq(threadTurnEvents.run_id, runId)];
  if (params.after_seq)
    conditions.push(gt(threadTurnEvents.seq, Number(params.after_seq)));

  const rows = await db
    .select()
    .from(threadTurnEvents)
    .where(and(...conditions))
    .orderBy(threadTurnEvents.seq)
    .limit(limit);

  return json(rows);
}

// ---------------------------------------------------------------------------
// On-demand Wakeup — POST /api/thread-turns/wakeup/:agentId
// ---------------------------------------------------------------------------

async function triggerWakeup(
  agentId: string,
  event: APIGatewayProxyEventV2,
  tenantId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const [agent] = await db
    .select({ id: agents.id, tenant_id: agents.tenant_id })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.tenant_id, tenantId)));
  if (!agent) return notFound("Agent not found");

  let body: Record<string, unknown> = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return error("Invalid JSON body");
  }

  const reason = String(body.reason || "manual");
  const prompt = body.prompt as string | undefined;
  const payload: Record<string, unknown> = {
    ...((body.payload as Record<string, unknown>) || {}),
  };
  if (prompt) payload.message = prompt;
  if (body.contextSnapshot) payload.contextSnapshot = body.contextSnapshot;

  const [wakeup] = await db
    .insert(agentWakeupRequests)
    .values({
      tenant_id: tenantId,
      agent_id: agentId,
      source: "on_demand",
      trigger_detail: prompt ? "manual_with_prompt" : "manual",
      reason,
      payload: Object.keys(payload).length > 0 ? payload : undefined,
      requested_by_actor_type: "user",
    })
    .returning();

  return json(wakeup, 201);
}
