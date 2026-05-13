/**
 * computer-terminal-start — REST endpoint the admin Terminal tab calls
 * to open an interactive shell session into a running Computer ECS task.
 *
 * Route:  POST /api/computers/:computerId/terminal/start
 * Auth:   Cognito JWT + tenant-admin role on the Computer's tenant.
 * Body:   {}  (computerId comes from the path)
 * Reply:  { ok: true, sessionId, streamUrl, tokenValue, container, taskArn,
 *           idleTimeoutSec: 1200 }
 *
 * The reply is the raw `Session` payload from `ecs:ExecuteCommand`. The
 * admin SPA hands it to `ssm-session` + a browser WebSocket pointed at
 * `wss://ssmmessages.<region>.amazonaws.com/v1/data-channel/<sessionId>?role=publish_subscribe`.
 * AWS Console works the same way — CORS does not apply to WebSocket
 * upgrades, so no API GW WebSocket proxy is required.
 *
 * The `tokenValue` is a short-lived bearer credential to a live shell.
 * NEVER log it. The full payload is returned over HTTPS only.
 *
 * Plan: docs/plans/2026-05-13-004-feat-computer-terminal-ecs-exec-plan.md.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  DescribeTasksCommand,
  ECSClient,
  ExecuteCommandCommand,
  ListTasksCommand,
} from "@aws-sdk/client-ecs";
import { and, computers, db, eq, tenantMembers } from "../graphql/utils.js";
import { authenticate } from "../lib/cognito-auth.js";
import { resolveCallerFromAuth } from "../graphql/resolvers/core/resolve-auth-user.js";
import { handleCors, json } from "../lib/response.js";

const ecs = new ECSClient({});

const CONTAINER_NAME = "computer-runtime";
const DEFAULT_COMMAND = "/bin/sh";
// AWS ECS Exec idle timeout is fixed at 20 minutes (not configurable via
// session preferences, unlike plain SSM). Surfaced so the admin client
// can render a countdown / reconnect affordance.
const ECS_EXEC_IDLE_TIMEOUT_SEC = 1200;

interface RequestBody {
  command?: string;
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;

  const cluster = process.env.COMPUTER_RUNTIME_CLUSTER_NAME;
  if (!cluster) {
    return json(
      { ok: false, error: "COMPUTER_RUNTIME_CLUSTER_NAME is not configured" },
      500,
    );
  }

  const auth = await authenticate(normalizeHeaders(event.headers));
  if (!auth) return json({ ok: false, error: "Unauthorized" }, 401);

  const { userId, tenantId } = await resolveCallerFromAuth(auth);
  if (!tenantId) {
    return json({ ok: false, error: "Could not resolve caller tenant" }, 401);
  }

  const computerId = event.pathParameters?.computerId;
  if (!computerId || typeof computerId !== "string") {
    return json(
      { ok: false, error: "computerId path parameter is required" },
      400,
    );
  }

  let body: RequestBody = {};
  if (event.body) {
    try {
      body = JSON.parse(event.body) as RequestBody;
    } catch {
      return json({ ok: false, error: "Invalid JSON body" }, 400);
    }
  }
  const command =
    typeof body.command === "string" && body.command.length > 0
      ? body.command
      : DEFAULT_COMMAND;

  const [computer] = await db
    .select({
      id: computers.id,
      tenant_id: computers.tenant_id,
      ecs_service_name: computers.ecs_service_name,
    })
    .from(computers)
    .where(and(eq(computers.id, computerId), eq(computers.tenant_id, tenantId)))
    .limit(1);
  if (!computer || !computer.ecs_service_name) {
    return json({ ok: false, error: "Computer not found" }, 404);
  }

  // Tenant-admin gate. Interactive shell into a production-ish ECS task
  // is a privileged operation; matches the workspace-files write gate.
  // Cognito-only — apikey/service callers do not get a terminal.
  if (auth.authType !== "cognito") {
    return json({ ok: false, error: "Tenant admin role required" }, 403);
  }
  if (!(await callerIsTenantAdmin(tenantId, userId ?? null))) {
    return json({ ok: false, error: "Tenant admin role required" }, 403);
  }

  // Resolve the running task ARN. ECS Exec only works against a task,
  // not a service — DescribeServices doesn't return task ARNs directly.
  const taskArns = await ecs.send(
    new ListTasksCommand({
      cluster,
      serviceName: computer.ecs_service_name,
      desiredStatus: "RUNNING",
    }),
  );
  const taskArn = taskArns.taskArns?.[0];
  if (!taskArn) {
    return json(
      { ok: false, error: "Computer task is not currently running" },
      409,
    );
  }

  // Confirm the container is up — Fargate exposes managed-agent status on
  // each container. If the SSM agent isn't RUNNING yet (task just started)
  // ExecuteCommand will fail with TargetNotConnectedException; surface a
  // clearer error.
  const tasks = await ecs.send(
    new DescribeTasksCommand({ cluster, tasks: [taskArn] }),
  );
  const task = tasks.tasks?.[0];
  const container = task?.containers?.find((c) => c.name === CONTAINER_NAME);
  const execAgent = container?.managedAgents?.find(
    (a) => a.name === "ExecuteCommandAgent",
  );
  if (execAgent && execAgent.lastStatus !== "RUNNING") {
    return json(
      {
        ok: false,
        error: `ECS Exec agent is ${execAgent.lastStatus ?? "not running"} — wait a few seconds and retry`,
      },
      409,
    );
  }

  let session;
  try {
    const res = await ecs.send(
      new ExecuteCommandCommand({
        cluster,
        task: taskArn,
        container: CONTAINER_NAME,
        interactive: true,
        command,
      }),
    );
    session = res.session;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json(
      { ok: false, error: `ExecuteCommand failed: ${message}` },
      502,
    );
  }
  if (!session?.sessionId || !session.streamUrl || !session.tokenValue) {
    return json(
      { ok: false, error: "ExecuteCommand returned an incomplete session" },
      502,
    );
  }

  // Audit trail: CloudTrail captures the ECS ExecuteCommand API call
  // (caller identity + cluster + task + container), and the cluster's
  // execute_command_configuration.log_configuration streams the in-
  // session command transcript to /thinkwork/<stage>/computer-ecs-exec.
  // Both are wired in terraform/modules/app/computer-runtime/main.tf.
  // No application-domain audit-event emit here — the compliance event
  // taxonomy is for app-domain events, not infrastructure operations.
  console.log(
    `[computer-terminal-start] session=${session.sessionId} user=${userId} tenant=${tenantId} computer=${computerId} task=${taskArn}`,
  );

  return json({
    ok: true,
    sessionId: session.sessionId,
    streamUrl: session.streamUrl,
    tokenValue: session.tokenValue,
    container: CONTAINER_NAME,
    taskArn,
    idleTimeoutSec: ECS_EXEC_IDLE_TIMEOUT_SEC,
  });
}

function normalizeHeaders(
  raw: Record<string, string | undefined> | undefined,
): Record<string, string | undefined> {
  if (!raw) return {};
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) out[k.toLowerCase()] = v;
  return out;
}

async function callerIsTenantAdmin(
  tenantId: string,
  principalId: string | null,
): Promise<boolean> {
  if (!principalId) return false;
  const rows = await db
    .select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenant_id, tenantId),
        eq(tenantMembers.principal_id, principalId),
      ),
    )
    .limit(1);
  const role = rows[0]?.role;
  return role === "owner" || role === "admin";
}
