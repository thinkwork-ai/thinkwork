import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  computers,
  computerEvents,
  computerTasks,
} from "@thinkwork/database-pg/schema";
import { resolveConnectionForUser, resolveOAuthToken } from "../oauth-token.js";

const db = getDb();

export class ComputerNotFoundError extends Error {
  constructor(readonly computerId: string) {
    super(`Computer not found: ${computerId}`);
    this.name = "ComputerNotFoundError";
  }
}

export class ComputerTaskNotFoundError extends Error {
  constructor(readonly taskId: string) {
    super(`Computer task not found: ${taskId}`);
    this.name = "ComputerTaskNotFoundError";
  }
}

export async function resolveComputerRuntimeConfig(input: {
  tenantId: string;
  computerId: string;
}) {
  const computer = await loadComputer(input.tenantId, input.computerId);
  return {
    tenantId: computer.tenant_id,
    computerId: computer.id,
    ownerUserId: computer.owner_user_id,
    desiredRuntimeStatus: computer.desired_runtime_status,
    runtimeStatus: computer.runtime_status,
    runtimeConfig: computer.runtime_config,
    liveWorkspaceRoot: computer.live_workspace_root,
    efsAccessPointId: computer.efs_access_point_id,
    ecsServiceName: computer.ecs_service_name,
    templateId: computer.template_id,
  };
}

export async function recordComputerHeartbeat(input: {
  tenantId: string;
  computerId: string;
  runtimeStatus: string;
  runtimeVersion?: string | null;
  workspaceRoot?: string | null;
}) {
  const [row] = await db
    .update(computers)
    .set({
      runtime_status: input.runtimeStatus,
      live_workspace_root: input.workspaceRoot ?? undefined,
      last_heartbeat_at: new Date(),
      last_active_at: new Date(),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(computers.tenant_id, input.tenantId),
        eq(computers.id, input.computerId),
      ),
    )
    .returning({
      id: computers.id,
      runtime_status: computers.runtime_status,
      live_workspace_root: computers.live_workspace_root,
      last_heartbeat_at: computers.last_heartbeat_at,
      last_active_at: computers.last_active_at,
    });
  if (!row) throw new ComputerNotFoundError(input.computerId);
  return {
    computerId: row.id,
    runtimeStatus: row.runtime_status,
    liveWorkspaceRoot: row.live_workspace_root,
    lastHeartbeatAt: row.last_heartbeat_at,
    lastActiveAt: row.last_active_at,
    runtimeVersion: input.runtimeVersion ?? null,
  };
}

export async function claimNextComputerTask(input: {
  tenantId: string;
  computerId: string;
}) {
  await loadComputer(input.tenantId, input.computerId);
  const [candidate] = await db
    .select({
      id: computerTasks.id,
      task_type: computerTasks.task_type,
      input: computerTasks.input,
      idempotency_key: computerTasks.idempotency_key,
      created_at: computerTasks.created_at,
    })
    .from(computerTasks)
    .where(
      and(
        eq(computerTasks.tenant_id, input.tenantId),
        eq(computerTasks.computer_id, input.computerId),
        eq(computerTasks.status, "pending"),
      ),
    )
    .orderBy(asc(computerTasks.created_at))
    .limit(1);
  if (!candidate) return null;

  const [claimed] = await db
    .update(computerTasks)
    .set({
      status: "running",
      claimed_at: new Date(),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(computerTasks.id, candidate.id),
        eq(computerTasks.status, "pending"),
      ),
    )
    .returning({
      id: computerTasks.id,
      tenant_id: computerTasks.tenant_id,
      computer_id: computerTasks.computer_id,
      task_type: computerTasks.task_type,
      input: computerTasks.input,
      idempotency_key: computerTasks.idempotency_key,
      claimed_at: computerTasks.claimed_at,
      created_at: computerTasks.created_at,
    });
  if (!claimed) return null;
  return {
    id: claimed.id,
    tenantId: claimed.tenant_id,
    computerId: claimed.computer_id,
    taskType: claimed.task_type,
    input: claimed.input,
    idempotencyKey: claimed.idempotency_key,
    claimedAt: claimed.claimed_at,
    createdAt: claimed.created_at,
  };
}

export async function appendComputerTaskEvent(input: {
  tenantId: string;
  computerId: string;
  taskId?: string | null;
  eventType: string;
  level?: string;
  payload?: unknown;
}) {
  await loadComputer(input.tenantId, input.computerId);
  if (input.taskId) {
    await loadTask(input.tenantId, input.computerId, input.taskId);
  }
  const [event] = await db
    .insert(computerEvents)
    .values({
      tenant_id: input.tenantId,
      computer_id: input.computerId,
      task_id: input.taskId ?? null,
      event_type: input.eventType,
      level: input.level ?? "info",
      payload: input.payload ?? null,
    })
    .returning({
      id: computerEvents.id,
      event_type: computerEvents.event_type,
      level: computerEvents.level,
      created_at: computerEvents.created_at,
    });
  return {
    id: event.id,
    eventType: event.event_type,
    level: event.level,
    createdAt: event.created_at,
  };
}

export async function checkGoogleWorkspaceConnection(input: {
  tenantId: string;
  computerId: string;
}) {
  const computer = await loadComputer(input.tenantId, input.computerId);
  const checkedAt = new Date().toISOString();
  const connection = await resolveConnectionForUser(
    computer.tenant_id,
    computer.owner_user_id,
    "google_productivity",
  );

  if (!connection) {
    return {
      providerName: "google_productivity",
      connected: false,
      tokenResolved: false,
      reason: "no_active_connection",
      checkedAt,
    };
  }

  const accessToken = await resolveOAuthToken(
    connection.connectionId,
    computer.tenant_id,
    connection.providerId,
  );

  return {
    providerName: "google_productivity",
    connected: true,
    tokenResolved: Boolean(accessToken),
    connectionId: connection.connectionId,
    reason: accessToken ? null : "token_unavailable_or_expired",
    checkedAt,
  };
}

export async function resolveGoogleWorkspaceCliToken(input: {
  tenantId: string;
  computerId: string;
}) {
  const computer = await loadComputer(input.tenantId, input.computerId);
  const checkedAt = new Date().toISOString();
  const connection = await resolveConnectionForUser(
    computer.tenant_id,
    computer.owner_user_id,
    "google_productivity",
  );

  const base = {
    providerName: "google_productivity",
    checkedAt,
  };

  if (!connection) {
    return {
      ...base,
      connected: false,
      tokenResolved: false,
      reason: "no_active_connection",
    };
  }

  const accessToken = await resolveOAuthToken(
    connection.connectionId,
    computer.tenant_id,
    connection.providerId,
  );

  if (!accessToken) {
    return {
      ...base,
      connected: true,
      tokenResolved: false,
      connectionId: connection.connectionId,
      reason: "token_unavailable_or_expired",
    };
  }

  return {
    ...base,
    connected: true,
    tokenResolved: true,
    connectionId: connection.connectionId,
    reason: null,
    accessToken,
  };
}

export async function completeComputerTask(input: {
  tenantId: string;
  computerId: string;
  taskId: string;
  output?: unknown;
}) {
  return finishTask({
    ...input,
    status: "completed",
    output: input.output ?? null,
    error: null,
  });
}

export async function failComputerTask(input: {
  tenantId: string;
  computerId: string;
  taskId: string;
  error: unknown;
}) {
  return finishTask({
    ...input,
    status: "failed",
    output: null,
    error: input.error,
  });
}

async function finishTask(input: {
  tenantId: string;
  computerId: string;
  taskId: string;
  status: "completed" | "failed";
  output: unknown;
  error: unknown;
}) {
  const [row] = await db
    .update(computerTasks)
    .set({
      status: input.status,
      output: input.output,
      error: input.error,
      completed_at: new Date(),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(computerTasks.tenant_id, input.tenantId),
        eq(computerTasks.computer_id, input.computerId),
        eq(computerTasks.id, input.taskId),
      ),
    )
    .returning({
      id: computerTasks.id,
      status: computerTasks.status,
      completed_at: computerTasks.completed_at,
    });
  if (!row) throw new ComputerTaskNotFoundError(input.taskId);
  await appendComputerTaskEvent({
    tenantId: input.tenantId,
    computerId: input.computerId,
    taskId: input.taskId,
    eventType: `task_${input.status}`,
    level: input.status === "failed" ? "error" : "info",
    payload: input.status === "failed" ? { error: input.error } : undefined,
  });
  return {
    id: row.id,
    status: row.status,
    completedAt: row.completed_at,
  };
}

async function loadComputer(tenantId: string, computerId: string) {
  const [computer] = await db
    .select()
    .from(computers)
    .where(and(eq(computers.tenant_id, tenantId), eq(computers.id, computerId)))
    .limit(1);
  if (!computer) throw new ComputerNotFoundError(computerId);
  return computer;
}

async function loadTask(tenantId: string, computerId: string, taskId: string) {
  const [task] = await db
    .select({ id: computerTasks.id })
    .from(computerTasks)
    .where(
      and(
        eq(computerTasks.tenant_id, tenantId),
        eq(computerTasks.computer_id, computerId),
        eq(computerTasks.id, taskId),
      ),
    )
    .limit(1);
  if (!task) throw new ComputerTaskNotFoundError(taskId);
  return task;
}
