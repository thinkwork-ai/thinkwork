import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agents,
  computerDelegations,
  computers,
  computerEvents,
  computerTasks,
  messages,
  threads,
} from "@thinkwork/database-pg/schema";
import {
  resolveConnectionForUser,
  resolveOAuthTokenDetails,
} from "../oauth-token.js";
import { invokeChatAgent } from "../../graphql/utils.js";

const db = getDb();
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

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

export class ComputerTaskDelegationError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "ComputerTaskDelegationError";
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

  const tokenDetails = await resolveOAuthTokenDetails(
    connection.connectionId,
    computer.tenant_id,
    connection.providerId,
  );
  const grantedScopes = tokenDetails?.grantedScopes ?? [];
  const missingScopes = missingGoogleCalendarScopes(grantedScopes);

  return {
    providerName: "google_productivity",
    connected: true,
    tokenResolved: Boolean(tokenDetails?.accessToken),
    connectionId: connection.connectionId,
    grantedScopes,
    missingScopes,
    calendarScopeGranted: missingScopes.length === 0,
    reason: tokenDetails?.accessToken ? null : "token_unavailable_or_expired",
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

  const tokenDetails = await resolveOAuthTokenDetails(
    connection.connectionId,
    computer.tenant_id,
    connection.providerId,
  );

  if (!tokenDetails?.accessToken) {
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
    grantedScopes: tokenDetails.grantedScopes,
    missingScopes: missingGoogleCalendarScopes(tokenDetails.grantedScopes),
    reason: null,
    accessToken: tokenDetails.accessToken,
  };
}

export async function delegateConnectorWorkTask(input: {
  tenantId: string;
  computerId: string;
  taskId: string;
}) {
  const task = await loadTask(input.tenantId, input.computerId, input.taskId);
  if (task.task_type !== "connector_work") {
    throw new ComputerTaskDelegationError(
      "Only connector_work tasks can be delegated",
    );
  }

  const computer = await loadComputer(input.tenantId, input.computerId);
  if (!computer.migrated_from_agent_id) {
    throw new ComputerTaskDelegationError(
      "Computer has no delegated Managed Agent configured",
      409,
    );
  }

  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.id, computer.migrated_from_agent_id),
        eq(agents.tenant_id, input.tenantId),
      ),
    )
    .limit(1);
  if (!agent) {
    throw new ComputerTaskDelegationError(
      "Delegated Managed Agent not found",
      404,
    );
  }

  const payload = connectorWorkPayload(task.input);
  const existing = await loadDelegation(input.tenantId, input.taskId);
  if (existing && ["running", "completed"].includes(existing.status)) {
    return {
      delegated: false,
      idempotent: true,
      mode: "managed_agent",
      delegationId: existing.id,
      agentId: existing.agent_id,
      threadId: String((existing.input_artifacts as any)?.threadId ?? ""),
      status: existing.status,
    };
  }

  const handoff = await resolveConnectorHandoffThread({
    tenantId: input.tenantId,
    taskId: input.taskId,
  });

  const delegation =
    existing ??
    (
      await db
        .insert(computerDelegations)
        .values({
          tenant_id: input.tenantId,
          computer_id: input.computerId,
          agent_id: agent.id,
          task_id: input.taskId,
          status: "pending",
          input_artifacts: {
            connectorId: payload.connectorId,
            connectorExecutionId: payload.connectorExecutionId,
            externalRef: payload.externalRef,
            title: payload.title,
            threadId: handoff.threadId,
            messageId: handoff.messageId,
            metadata: payload.metadata,
          },
        })
        .returning({
          id: computerDelegations.id,
          agent_id: computerDelegations.agent_id,
        })
    )[0];
  if (!delegation) {
    throw new ComputerTaskDelegationError("Failed to create delegation", 500);
  }

  await appendComputerTaskEvent({
    tenantId: input.tenantId,
    computerId: input.computerId,
    taskId: input.taskId,
    eventType: "connector_work_delegation_started",
    level: "info",
    payload: {
      delegationId: delegation.id,
      agentId: agent.id,
      threadId: handoff.threadId,
      connectorExecutionId: payload.connectorExecutionId,
      externalRef: payload.externalRef,
    },
  });

  const invoked = await invokeChatAgent({
    tenantId: input.tenantId,
    threadId: handoff.threadId,
    agentId: agent.id,
    userMessage: payload.body,
    messageId: handoff.messageId,
  });

  if (!invoked) {
    await db
      .update(computerDelegations)
      .set({
        status: "failed",
        error: { message: "Managed Agent delegation dispatch failed" },
        completed_at: new Date(),
      })
      .where(eq(computerDelegations.id, delegation.id));
    throw new ComputerTaskDelegationError(
      "Managed Agent delegation dispatch failed",
      502,
    );
  }

  await db
    .update(computerDelegations)
    .set({ status: "running" })
    .where(eq(computerDelegations.id, delegation.id));

  return {
    delegated: true,
    idempotent: false,
    mode: "managed_agent",
    delegationId: delegation.id,
    agentId: agent.id,
    threadId: handoff.threadId,
    messageId: handoff.messageId,
    status: "running",
  };
}

export async function executeThreadTurnTask(input: {
  tenantId: string;
  computerId: string;
  taskId: string;
}) {
  const task = await loadTask(input.tenantId, input.computerId, input.taskId);
  if (task.task_type !== "thread_turn") {
    throw new ComputerTaskDelegationError(
      "Only thread_turn tasks can be executed as Thread turns",
    );
  }

  const payload = threadTurnPayload(task.input);
  const computer = await loadComputer(input.tenantId, input.computerId);
  if (!computer.migrated_from_agent_id) {
    throw new ComputerTaskDelegationError(
      "Computer has no delegated Managed Agent configured",
      409,
    );
  }

  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.id, computer.migrated_from_agent_id),
        eq(agents.tenant_id, input.tenantId),
      ),
    )
    .limit(1);
  if (!agent) {
    throw new ComputerTaskDelegationError(
      "Delegated Managed Agent not found",
      404,
    );
  }

  const [thread] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.tenant_id, input.tenantId),
        eq(threads.id, payload.threadId),
        eq(threads.computer_id, input.computerId),
      ),
    )
    .limit(1);
  if (!thread) {
    throw new ComputerTaskDelegationError(
      "Computer-owned Thread not found for task",
      409,
    );
  }

  const [message] = await db
    .select({
      id: messages.id,
      content: messages.content,
      role: messages.role,
    })
    .from(messages)
    .where(
      and(
        eq(messages.tenant_id, input.tenantId),
        eq(messages.thread_id, payload.threadId),
        eq(messages.id, payload.messageId),
      ),
    )
    .limit(1);
  if (!message) {
    throw new ComputerTaskDelegationError(
      "Thread turn message not found for task",
      409,
    );
  }
  if (message.role !== "user") {
    throw new ComputerTaskDelegationError(
      "Only user messages can trigger Computer thread turns",
      400,
    );
  }

  await appendComputerTaskEvent({
    tenantId: input.tenantId,
    computerId: input.computerId,
    taskId: input.taskId,
    eventType: "thread_turn_dispatch_started",
    level: "info",
    payload: {
      agentId: agent.id,
      threadId: payload.threadId,
      messageId: payload.messageId,
      source: payload.source,
    },
  });

  const invoked = await invokeChatAgent({
    tenantId: input.tenantId,
    threadId: payload.threadId,
    agentId: agent.id,
    userMessage: message.content ?? "",
    messageId: payload.messageId,
  });
  if (!invoked) {
    throw new ComputerTaskDelegationError(
      "Computer thread turn dispatch failed",
      502,
    );
  }

  return {
    dispatched: true,
    mode: "managed_agent",
    agentId: agent.id,
    threadId: payload.threadId,
    messageId: payload.messageId,
    source: payload.source,
    status: "running",
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

function missingGoogleCalendarScopes(grantedScopes: string[]) {
  return grantedScopes.includes(GOOGLE_CALENDAR_SCOPE)
    ? []
    : [GOOGLE_CALENDAR_SCOPE];
}

async function loadTask(tenantId: string, computerId: string, taskId: string) {
  const [task] = await db
    .select({
      id: computerTasks.id,
      task_type: computerTasks.task_type,
      input: computerTasks.input,
    })
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

async function loadDelegation(tenantId: string, taskId: string) {
  const [delegation] = await db
    .select({
      id: computerDelegations.id,
      agent_id: computerDelegations.agent_id,
      status: computerDelegations.status,
      input_artifacts: computerDelegations.input_artifacts,
    })
    .from(computerDelegations)
    .where(
      and(
        eq(computerDelegations.tenant_id, tenantId),
        eq(computerDelegations.task_id, taskId),
      ),
    )
    .orderBy(asc(computerDelegations.created_at))
    .limit(1);
  return delegation ?? null;
}

async function resolveConnectorHandoffThread(input: {
  tenantId: string;
  taskId: string;
}) {
  const [thread] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.tenant_id, input.tenantId),
        sql`${threads.metadata}->>'computerTaskId' = ${input.taskId}`,
      ),
    )
    .limit(1);
  if (!thread) {
    throw new ComputerTaskDelegationError(
      "Connector work thread not found for task",
      409,
    );
  }

  const [message] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.tenant_id, input.tenantId),
        eq(messages.thread_id, thread.id),
        eq(messages.sender_type, "connector"),
      ),
    )
    .orderBy(asc(messages.created_at))
    .limit(1);
  if (!message) {
    throw new ComputerTaskDelegationError(
      "Connector work message not found for task",
      409,
    );
  }

  return { threadId: thread.id, messageId: message.id };
}

function connectorWorkPayload(input: unknown) {
  const payload =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  return {
    connectorId: requiredPayloadString(payload.connectorId, "connectorId"),
    connectorExecutionId: requiredPayloadString(
      payload.connectorExecutionId,
      "connectorExecutionId",
    ),
    externalRef: requiredPayloadString(payload.externalRef, "externalRef"),
    title: requiredPayloadString(payload.title, "title"),
    body: requiredPayloadString(payload.body, "body"),
    metadata:
      payload.metadata && typeof payload.metadata === "object"
        ? payload.metadata
        : null,
  };
}

function threadTurnPayload(input: unknown) {
  const payload =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  return {
    threadId: requiredPayloadString(payload.threadId, "threadId"),
    messageId: requiredPayloadString(payload.messageId, "messageId"),
    source:
      typeof payload.source === "string" && payload.source.trim()
        ? payload.source.trim()
        : "chat_message",
  };
}

function requiredPayloadString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ComputerTaskDelegationError(
      `connector_work input missing ${name}`,
    );
  }
  return value.trim();
}
