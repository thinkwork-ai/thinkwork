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

import { getApiAuthSecret } from "@thinkwork/runtime-config";
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
  evalRuns,
  messages,
  spaces,
} from "@thinkwork/database-pg/schema";
import { db } from "../lib/db.js";
import {
  requireTenantMembership,
  type TenantMemberRole,
} from "../lib/tenant-membership.js";
import { json, error, notFound } from "../lib/response.js";
import { ensureThreadForWork } from "../lib/thread-helpers.js";
import { resolveTenantPlatformAgent } from "../lib/agents/tenant-platform-agent.js";
import { CURRENT_EVAL_SCORING_VERSION } from "@thinkwork/evals-core";

const DEFAULT_EVAL_MODEL_ID = "moonshotai.kimi-k2.5";
const THREAD_IDLE_MEMORY_LEARNING_TRIGGER_TYPE = "thread_idle_memory_learning";

function isInternalScheduledJob(row: {
  trigger_type?: string | null;
  config?: unknown;
}): boolean {
  if (row.trigger_type === THREAD_IDLE_MEMORY_LEARNING_TRIGGER_TYPE)
    return true;
  const config = row.config;
  return (
    !!config &&
    typeof config === "object" &&
    !Array.isArray(config) &&
    (config as Record<string, unknown>).internal === true
  );
}

function isInternalScheduledJobBody(body: Record<string, unknown>): boolean {
  return isInternalScheduledJob({
    trigger_type:
      typeof body.trigger_type === "string" ? body.trigger_type : undefined,
    config: body.config,
  });
}

async function validateSpaceForTenant(
  spaceId: string | null,
  tenantId: string,
): Promise<APIGatewayProxyStructuredResultV2 | null> {
  if (!spaceId) return null;
  const [spaceRow] = await db
    .select({ tenant_id: spaces.tenant_id })
    .from(spaces)
    .where(eq(spaces.id, spaceId));
  if (!spaceRow) return error(`Space ${spaceId} not found`, 400);
  if (spaceRow.tenant_id !== tenantId) {
    return error("Space does not belong to this tenant", 403);
  }
  return null;
}

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
              authorization: `Bearer ${getApiAuthSecret()}`,
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
  | {
      ok: true;
      tenantId: string;
      userId: string | null;
      role: TenantMemberRole | null;
    }
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
  return {
    ok: true,
    tenantId: verdict.tenantId,
    userId: verdict.userId,
    role: verdict.role,
  };
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
      if (method === "GET")
        return listScheduledJobs(event, check.tenantId, check.role);
      return createScheduledJob(event, check.tenantId, check.userId);
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
  role: TenantMemberRole | null,
): Promise<APIGatewayProxyStructuredResultV2> {
  const conditions = [eq(scheduledJobs.tenant_id, tenantId)];

  const params = event.queryStringParameters || {};
  const includeInternal =
    params.include_internal === "true" &&
    (role === "owner" || role === "admin" || role === null);
  if (!includeInternal) {
    conditions.push(
      sql`COALESCE(${scheduledJobs.config}->>'internal', 'false') <> 'true' AND ${scheduledJobs.trigger_type} <> ${THREAD_IDLE_MEMORY_LEARNING_TRIGGER_TYPE}`,
    );
  }
  const spaceId = params.spaceId || params.space_id;
  if (spaceId) conditions.push(eq(scheduledJobs.space_id, spaceId));
  if (params.agent_id)
    conditions.push(eq(scheduledJobs.agent_id, params.agent_id));
  if (params.routine_id)
    conditions.push(eq(scheduledJobs.routine_id, params.routine_id));
  if (params.trigger_type)
    conditions.push(eq(scheduledJobs.trigger_type, params.trigger_type));
  if (params.connection_id)
    conditions.push(
      sql`${scheduledJobs.config}->'connectorTrigger'->>'connectionId' = ${params.connection_id}`,
    );
  if (params.enabled !== undefined)
    conditions.push(eq(scheduledJobs.enabled, params.enabled === "true"));

  const rows = await db
    .select({
      id: scheduledJobs.id,
      tenant_id: scheduledJobs.tenant_id,
      trigger_type: scheduledJobs.trigger_type,
      agent_id: scheduledJobs.agent_id,
      space_id: scheduledJobs.space_id,
      computer_id: scheduledJobs.computer_id,
      routine_id: scheduledJobs.routine_id,
      name: scheduledJobs.name,
      description: scheduledJobs.description,
      prompt: scheduledJobs.prompt,
      schedule_type: scheduledJobs.schedule_type,
      schedule_expression: scheduledJobs.schedule_expression,
      timezone: scheduledJobs.timezone,
      enabled: scheduledJobs.enabled,
      budget_paused: scheduledJobs.budget_paused,
      budget_paused_at: scheduledJobs.budget_paused_at,
      budget_paused_reason: scheduledJobs.budget_paused_reason,
      eb_schedule_name: scheduledJobs.eb_schedule_name,
      last_run_at: scheduledJobs.last_run_at,
      next_run_at: scheduledJobs.next_run_at,
      created_by_type: scheduledJobs.created_by_type,
      created_by_id: scheduledJobs.created_by_id,
      created_at: scheduledJobs.created_at,
      updated_at: scheduledJobs.updated_at,
    })
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
  creatorUserId: string | null,
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
  if (isInternalScheduledJobBody(body)) {
    return error(
      "Internal scheduled jobs cannot be created through this API",
      403,
    );
  }

  const spaceId =
    ((body.space_id ?? body.spaceId) as string | null | undefined) || null;
  const spaceError = await validateSpaceForTenant(spaceId, tenantId);
  if (spaceError) return spaceError;

  const createdByType = (
    (body.created_by_type as string) || "user"
  ).toLowerCase();
  const createdById =
    createdByType === "user"
      ? creatorUserId
      : (body.created_by_id as string) || null;
  const config =
    body.config &&
    typeof body.config === "object" &&
    !Array.isArray(body.config)
      ? (body.config as Record<string, unknown>)
      : null;
  const triggerType = String(body.trigger_type);
  const scheduleType = (body.schedule_type as string) || null;

  const [row] = await db
    .insert(scheduledJobs)
    .values({
      tenant_id: tenantId,
      trigger_type: triggerType,
      agent_id: (body.agent_id as string) || null,
      space_id: spaceId,
      routine_id: (body.routine_id as string) || null,
      name: body.name as string,
      description: (body.description as string) || null,
      prompt: (body.prompt as string) || null,
      config,
      schedule_type: scheduleType,
      schedule_expression: (body.schedule_expression as string) || null,
      timezone: (body.timezone as string) || "UTC",
      enabled: true,
      created_by_type: createdByType,
      created_by_id: createdById,
    })
    .returning();

  // Create EventBridge schedule if this is a timer-based trigger
  if (row.schedule_type && row.schedule_expression) {
    const result = await invokeJobScheduleManager("POST", {
      triggerId: row.id,
      tenantId,
      triggerType: row.trigger_type,
      agentId: row.agent_id || undefined,
      spaceId: row.space_id || undefined,
      routineId: row.routine_id || undefined,
      name: row.name,
      scheduleType: row.schedule_type,
      scheduleExpression: row.schedule_expression,
      timezone: row.timezone,
      prompt: row.prompt || undefined,
      config: row.config || undefined,
      createdByType,
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

  const [existing] = await db
    .select()
    .from(scheduledJobs)
    .where(
      and(eq(scheduledJobs.id, id), eq(scheduledJobs.tenant_id, tenantId)),
    );
  if (!existing) return notFound("Trigger not found");
  if (isInternalScheduledJob(existing)) {
    return error(
      "Internal scheduled jobs cannot be updated through this API",
      403,
    );
  }
  if (isInternalScheduledJobBody(body)) {
    return error("Scheduled jobs cannot be converted to internal jobs", 403);
  }

  // Note: computer_id is intentionally read-only on update for v1 — re-parenting
  // a scheduled job to a different Computer isn't a supported flow. agent_id is
  // also unset here because the runtime-firing key is fixed at create-time.
  const updates: Record<string, unknown> = { updated_at: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.prompt !== undefined) updates.prompt = body.prompt;
  if (body.space_id !== undefined || body.spaceId !== undefined) {
    const nextSpaceId =
      ((body.space_id ?? body.spaceId) as string | null | undefined) || null;
    const spaceError = await validateSpaceForTenant(nextSpaceId, tenantId);
    if (spaceError) return spaceError;
    updates.space_id = nextSpaceId;
  }
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
      spaceId: updated.space_id || undefined,
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
  if (isInternalScheduledJob(existing)) {
    return error(
      "Internal scheduled jobs cannot be deleted through this API",
      403,
    );
  }

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
  if (isInternalScheduledJob(trig)) {
    return error(
      "Internal scheduled jobs cannot be fired through this API",
      403,
    );
  }

  const isAgentTrigger = trig.trigger_type.startsWith("agent_");
  const isEvalTrigger = trig.trigger_type === "eval_scheduled";

  if (isEvalTrigger) {
    // Manual fire of an eval schedule: insert a pending eval_run + fire
    // the eval-runner Lambda. Mirrors the EventBridge path in
    // packages/lambda/job-trigger.ts.
    const cfg = (trig.config ?? {}) as {
      agentId?: string;
      model?: string;
      categories?: string[];
    };
    let targetAgentId: string;
    try {
      if (cfg.model && cfg.model !== DEFAULT_EVAL_MODEL_ID) {
        throw new Error(
          `Scheduled eval model overrides are no longer supported; use ${DEFAULT_EVAL_MODEL_ID}`,
        );
      }
      if (cfg.agentId) {
        console.warn(
          "[scheduled-jobs] eval cfg.agentId is deprecated and ignored; using tenant platform agent",
          { tenantId, schedJobId: trig.id, ignoredAgentId: cfg.agentId },
        );
      }
      const platformAgent = await resolveTenantPlatformAgent(tenantId);
      targetAgentId = platformAgent.id;
    } catch (err) {
      return error(err instanceof Error ? err.message : String(err), 409);
    }
    const [run] = await db
      .insert(evalRuns)
      .values({
        tenant_id: tenantId,
        agent_id: targetAgentId,
        scheduled_job_id: trig.id,
        status: "pending",
        model: DEFAULT_EVAL_MODEL_ID,
        categories: cfg.categories ?? [],
        // Scoring semantics are stamped at run creation (Trust Core U2);
        // unstamped rows are treated as legacy and excluded from
        // current-version aggregates.
        scoring_version: CURRENT_EVAL_SCORING_VERSION,
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

  if (isAgentTrigger && trig.agent_id) {
    return error(
      "Manual fires for agent schedules have been disabled with the Computer feature removal. Use the routine substrate or wait for the scheduled cron to fire.",
      410,
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
  if (params.thread_id)
    conditions.push(eq(threadTurns.thread_id, params.thread_id));
  if (params.status) conditions.push(eq(threadTurns.status, params.status));

  const limit = Math.min(Number(params.limit) || 50, 200);

  const rows = await db
    .select({
      id: threadTurns.id,
      tenant_id: threadTurns.tenant_id,
      job_id: sql<null>`NULL`,
      trigger_id: threadTurns.trigger_id,
      agent_id: threadTurns.agent_id,
      routine_id: threadTurns.routine_id,
      invocation_source: threadTurns.invocation_source,
      status: threadTurns.status,
      started_at: threadTurns.started_at,
      finished_at: threadTurns.finished_at,
      error: threadTurns.error,
      result_json: sql<null>`NULL`,
      usage_json: sql<null>`NULL`,
      created_at: threadTurns.created_at,
    })
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
