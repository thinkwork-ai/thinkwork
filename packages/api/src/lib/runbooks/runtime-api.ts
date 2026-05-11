import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { getDb } from "@thinkwork/database-pg";
import {
  artifacts,
  computerRunbookRuns,
  computerRunbookTasks,
  computers,
  computerTasks,
  messages,
  threads,
  type RunbookTaskStatus,
} from "@thinkwork/database-pg/schema";
import { getChatAgentInvokeFnArn } from "../../graphql/utils.js";
import { notifyNewMessage, notifyThreadUpdate } from "../../graphql/notify.js";
import {
  taskQueuePart,
  taskQueueThreadMetadata,
  upsertTaskQueuePart,
  type TaskQueueData,
} from "../task-queues/message-parts.js";

const db = getDb();
const lambdaClient = new LambdaClient({});

export class RunbookRuntimeError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "RunbookRuntimeError";
  }
}

export async function loadRunbookExecutionContext(input: {
  tenantId: string;
  computerId: string;
  taskId: string;
}) {
  const { payload } = await loadRunbookExecuteTask(input);
  const { run, tasks } = await loadRunbookRunState({
    tenantId: input.tenantId,
    computerId: input.computerId,
    runbookRunId: payload.runbookRunId,
  });
  const [computer] = await db
    .select({
      id: computers.id,
      name: computers.name,
      slug: computers.slug,
      workspace_root: computers.live_workspace_root,
    })
    .from(computers)
    .where(
      and(
        eq(computers.tenant_id, input.tenantId),
        eq(computers.id, input.computerId),
      ),
    )
    .limit(1);
  const [thread] = run.thread_id
    ? await db
        .select({ id: threads.id, title: threads.title })
        .from(threads)
        .where(
          and(
            eq(threads.tenant_id, input.tenantId),
            eq(threads.id, run.thread_id),
          ),
        )
        .limit(1)
    : [];
  const [sourceMessage] = run.selected_by_message_id
    ? await db
        .select({ id: messages.id, content: messages.content })
        .from(messages)
        .where(
          and(
            eq(messages.tenant_id, input.tenantId),
            eq(messages.id, run.selected_by_message_id),
          ),
        )
        .limit(1)
    : [];

  return {
    taskId: input.taskId,
    run: toRuntimeRun(run),
    tasks: tasks.map(toRuntimeTask),
    computer: computer
      ? {
          id: computer.id,
          name: computer.name,
          slug: computer.slug,
          workspaceRoot: computer.workspace_root ?? "/workspace",
        }
      : null,
    thread: thread ? { id: thread.id, title: thread.title } : null,
    sourceMessage: sourceMessage
      ? { id: sourceMessage.id, content: sourceMessage.content ?? "" }
      : null,
    definitionSnapshot: run.definition_snapshot,
    inputs: run.inputs,
    previousOutputs: Object.fromEntries(
      tasks
        .filter((task) => task.status === "completed")
        .map((task) => [task.task_key, task.output ?? null]),
    ),
  };
}

export async function startRunbookExecutionTask(input: {
  tenantId: string;
  computerId: string;
  taskId: string;
  runbookTaskId: string;
}) {
  const { payload } = await loadRunbookExecuteTask(input);
  const updatedTask = await db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(computerRunbookRuns)
      .where(
        and(
          eq(computerRunbookRuns.tenant_id, input.tenantId),
          eq(computerRunbookRuns.computer_id, input.computerId),
          eq(computerRunbookRuns.id, payload.runbookRunId),
        ),
      )
      .limit(1);
    if (!run) throw new RunbookRuntimeError("Runbook run not found", 404);
    if (run.status === "cancelled") {
      throw new RunbookRuntimeError("Runbook run is cancelled", 409);
    }
    if (run.status !== "queued" && run.status !== "running") {
      throw new RunbookRuntimeError(
        `Cannot execute runbook run in ${run.status} status`,
        409,
      );
    }

    const [task] = await tx
      .select()
      .from(computerRunbookTasks)
      .where(
        and(
          eq(computerRunbookTasks.tenant_id, input.tenantId),
          eq(computerRunbookTasks.run_id, run.id),
          eq(computerRunbookTasks.id, input.runbookTaskId),
        ),
      )
      .limit(1);
    if (!task) {
      throw new RunbookRuntimeError("Runbook task not found", 404);
    }
    if (task.status === "completed" || task.status === "running") {
      return toRuntimeTask(task);
    }
    if (task.status !== "pending") {
      throw new RunbookRuntimeError(
        `Cannot start runbook task in ${task.status} status`,
        409,
      );
    }

    const dependencies = Array.isArray(task.depends_on)
      ? task.depends_on.map(String)
      : [];
    if (dependencies.length > 0) {
      const completed = await tx
        .select({ task_key: computerRunbookTasks.task_key })
        .from(computerRunbookTasks)
        .where(
          and(
            eq(computerRunbookTasks.tenant_id, input.tenantId),
            eq(computerRunbookTasks.run_id, run.id),
            inArray(computerRunbookTasks.task_key, dependencies),
            eq(computerRunbookTasks.status, "completed"),
          ),
        );
      const completedKeys = new Set(completed.map((row) => row.task_key));
      const missing = dependencies.filter((key) => !completedKeys.has(key));
      if (missing.length > 0) {
        throw new RunbookRuntimeError(
          `Runbook task dependencies are not completed: ${missing.join(", ")}`,
          409,
        );
      }
    }

    await tx
      .update(computerRunbookRuns)
      .set({
        status: "running",
        started_at: sql`COALESCE(${computerRunbookRuns.started_at}, now())`,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(computerRunbookRuns.tenant_id, input.tenantId),
          eq(computerRunbookRuns.id, run.id),
        ),
      );
    const [updated] = await tx
      .update(computerRunbookTasks)
      .set({
        status: "running",
        started_at: new Date(),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(computerRunbookTasks.tenant_id, input.tenantId),
          eq(computerRunbookTasks.id, task.id),
          eq(computerRunbookTasks.status, "pending"),
        ),
      )
      .returning();
    return toRuntimeTask(updated ?? task);
  });
  await syncRunbookTaskQueueMessage({
    tenantId: input.tenantId,
    computerId: input.computerId,
    runbookRunId: payload.runbookRunId,
  });
  return updatedTask;
}

export async function completeRunbookExecutionTask(input: {
  tenantId: string;
  computerId: string;
  taskId: string;
  runbookTaskId: string;
  output?: unknown;
}) {
  const { payload } = await loadRunbookExecuteTask(input);
  await loadRunbookRunState({
    tenantId: input.tenantId,
    computerId: input.computerId,
    runbookRunId: payload.runbookRunId,
  });
  const [updated] = await db
    .update(computerRunbookTasks)
    .set({
      status: "completed",
      output: input.output ?? null,
      completed_at: new Date(),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(computerRunbookTasks.tenant_id, input.tenantId),
        eq(computerRunbookTasks.id, input.runbookTaskId),
        sql`${computerRunbookTasks.run_id} = ${payload.runbookRunId}`,
        inArray(computerRunbookTasks.status, ["pending", "running"]),
      ),
    )
    .returning();
  if (!updated) {
    throw new RunbookRuntimeError("Runbook task not found or not active", 404);
  }
  await syncRunbookTaskQueueMessage({
    tenantId: input.tenantId,
    computerId: input.computerId,
    runbookRunId: payload.runbookRunId,
  });
  return toRuntimeTask(updated);
}

export async function executeRunbookExecutionTask(input: {
  tenantId: string;
  computerId: string;
  taskId: string;
  runbookTaskId: string;
}) {
  const context = await loadRunbookExecutionContext(input);
  const currentTask = context.tasks.find(
    (task) => task.id === input.runbookTaskId,
  );
  if (!currentTask)
    throw new RunbookRuntimeError("Runbook task not found", 404);
  if (currentTask.status !== "running" && currentTask.status !== "pending") {
    throw new RunbookRuntimeError(
      `Cannot execute runbook task in ${currentTask.status} status`,
      409,
    );
  }
  if (!context.thread || !context.sourceMessage) {
    throw new RunbookRuntimeError(
      "Runbook execution requires a source thread and message",
      409,
    );
  }

  const [computer] = await db
    .select({
      id: computers.id,
      name: computers.name,
      migrated_from_agent_id: computers.migrated_from_agent_id,
    })
    .from(computers)
    .where(
      and(
        eq(computers.tenant_id, input.tenantId),
        eq(computers.id, input.computerId),
      ),
    )
    .limit(1);
  if (!computer) throw new RunbookRuntimeError("Computer not found", 404);
  if (!computer.migrated_from_agent_id) {
    throw new RunbookRuntimeError(
      "Computer has no Strands agent configured for runbook execution",
      409,
    );
  }

  const runbookContext = {
    run: context.run,
    definitionSnapshot: context.definitionSnapshot,
    inputs: context.inputs,
    previousOutputs: context.previousOutputs,
    currentTask,
    tasks: context.tasks.map((task) =>
      task.id === currentTask.id ? { ...task, status: "running" } : task,
    ),
  };

  const prompt = buildRunbookStepPrompt({
    originalPrompt: context.sourceMessage.content,
    computerName: computer.name,
    task: currentTask,
    previousOutputs: context.previousOutputs,
  });
  const result = await invokeRunbookStepAgent({
    tenantId: input.tenantId,
    threadId: context.thread.id,
    agentId: computer.migrated_from_agent_id,
    userMessage: prompt,
    messageId: context.sourceMessage.id,
    computerId: input.computerId,
    runbookContext,
  });

  await syncRunbookTaskQueueMessage({
    tenantId: input.tenantId,
    computerId: input.computerId,
    runbookRunId: context.run.id,
  });
  return result;
}

export async function recordRunbookExecutionResponse(input: {
  tenantId: string;
  computerId: string;
  taskId: string;
  content: string;
  model?: string | null;
  usage?: unknown;
}) {
  const { task, payload } = await loadRunbookExecuteTask(input);
  const { run } = await loadRunbookRunState({
    tenantId: input.tenantId,
    computerId: input.computerId,
    runbookRunId: payload.runbookRunId,
  });
  if (!run.thread_id) {
    throw new RunbookRuntimeError("Runbook run has no thread", 409);
  }

  const [thread] = await db
    .select({ id: threads.id, title: threads.title, status: threads.status })
    .from(threads)
    .where(
      and(eq(threads.tenant_id, input.tenantId), eq(threads.id, run.thread_id)),
    )
    .limit(1);
  if (!thread) throw new RunbookRuntimeError("Runbook thread not found", 404);

  const [existing] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.tenant_id, input.tenantId),
        eq(messages.thread_id, thread.id),
        sql`${messages.metadata}->>'runbookMessageKey' = ${`runbook-response:${run.id}`}`,
      ),
    )
    .limit(1);
  if (existing) return { responded: false, responseMessageId: existing.id };

  const [assistantMessage] = await db
    .insert(messages)
    .values({
      tenant_id: input.tenantId,
      thread_id: thread.id,
      role: "assistant",
      content: input.content,
      sender_type: "computer",
      sender_id: input.computerId,
      metadata: {
        runbookMessageKey: `runbook-response:${run.id}`,
        runbookRunId: run.id,
        computerTaskId: input.taskId,
        sourceMessageId: payload.messageId,
        model: input.model ?? null,
        usage: input.usage ?? null,
      },
    })
    .returning({ id: messages.id });
  if (!assistantMessage) {
    throw new RunbookRuntimeError("Runbook response insert failed", 500);
  }

  const turnStartedAt =
    task.claimed_at instanceof Date
      ? task.claimed_at
      : task.created_at instanceof Date
        ? task.created_at
        : new Date(0);
  await db
    .update(artifacts)
    .set({
      thread_id: thread.id,
      source_message_id: assistantMessage.id,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(artifacts.tenant_id, input.tenantId),
        eq(artifacts.type, "applet"),
        isNull(artifacts.source_message_id),
        sql`(${artifacts.thread_id} IS NULL OR ${artifacts.thread_id} = ${thread.id})`,
        gte(artifacts.created_at, turnStartedAt),
      ),
    );

  const preview =
    input.content.length > 240
      ? `${input.content.slice(0, 237)}...`
      : input.content;
  await db
    .update(threads)
    .set({
      last_turn_completed_at: new Date(),
      last_response_preview: preview,
      updated_at: new Date(),
    })
    .where(
      and(eq(threads.tenant_id, input.tenantId), eq(threads.id, thread.id)),
    );

  await notifyNewMessage({
    messageId: assistantMessage.id,
    threadId: thread.id,
    tenantId: input.tenantId,
    role: "assistant",
    content: input.content,
    senderType: "computer",
    senderId: input.computerId,
  });
  await notifyThreadUpdate({
    threadId: thread.id,
    tenantId: input.tenantId,
    status: thread.status,
    title: thread.title,
  });

  return {
    responded: true,
    responseMessageId: assistantMessage.id,
    threadId: thread.id,
    runbookRunId: run.id,
  };
}

export async function failRunbookExecutionTask(input: {
  tenantId: string;
  computerId: string;
  taskId: string;
  runbookTaskId: string;
  error: unknown;
}) {
  const { payload } = await loadRunbookExecuteTask(input);
  await loadRunbookRunState({
    tenantId: input.tenantId,
    computerId: input.computerId,
    runbookRunId: payload.runbookRunId,
  });
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(computerRunbookTasks)
      .set({
        status: "failed",
        error: input.error ?? { message: "Runbook task failed" },
        completed_at: new Date(),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(computerRunbookTasks.tenant_id, input.tenantId),
          eq(computerRunbookTasks.id, input.runbookTaskId),
          sql`${computerRunbookTasks.run_id} = ${payload.runbookRunId}`,
        ),
      )
      .returning();
    if (!updated) {
      throw new RunbookRuntimeError("Runbook task not found", 404);
    }
    await tx
      .update(computerRunbookTasks)
      .set({ status: "skipped", updated_at: new Date() })
      .where(
        and(
          eq(computerRunbookTasks.tenant_id, input.tenantId),
          sql`${computerRunbookTasks.run_id} = ${payload.runbookRunId}`,
          inArray(computerRunbookTasks.status, ["pending", "running"]),
        ),
      );
    await tx
      .update(computerRunbookRuns)
      .set({
        status: "failed",
        error: input.error ?? { message: "Runbook task failed" },
        completed_at: new Date(),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(computerRunbookRuns.tenant_id, input.tenantId),
          eq(computerRunbookRuns.id, payload.runbookRunId),
        ),
      );
  });
  await syncRunbookTaskQueueMessage({
    tenantId: input.tenantId,
    computerId: input.computerId,
    runbookRunId: payload.runbookRunId,
  });
  return { failed: true, runbookRunId: payload.runbookRunId };
}

export async function completeRunbookExecutionRun(input: {
  tenantId: string;
  computerId: string;
  taskId: string;
  output?: unknown;
}) {
  const { payload } = await loadRunbookExecuteTask(input);
  const { tasks } = await loadRunbookRunState({
    tenantId: input.tenantId,
    computerId: input.computerId,
    runbookRunId: payload.runbookRunId,
  });
  const incomplete = tasks.filter((task) => task.status !== "completed");
  if (incomplete.length > 0) {
    throw new RunbookRuntimeError(
      `Cannot complete runbook run with incomplete tasks: ${incomplete
        .map((task) => task.task_key)
        .join(", ")}`,
      409,
    );
  }
  const [updated] = await db
    .update(computerRunbookRuns)
    .set({
      status: "completed",
      output: input.output ?? null,
      completed_at: new Date(),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(computerRunbookRuns.tenant_id, input.tenantId),
        eq(computerRunbookRuns.computer_id, input.computerId),
        eq(computerRunbookRuns.id, payload.runbookRunId),
        inArray(computerRunbookRuns.status, ["queued", "running"]),
      ),
    )
    .returning();
  if (!updated) {
    throw new RunbookRuntimeError("Runbook run not found or not active", 404);
  }
  await syncRunbookTaskQueueMessage({
    tenantId: input.tenantId,
    computerId: input.computerId,
    runbookRunId: payload.runbookRunId,
  });
  return toRuntimeRun(updated);
}

function buildRunbookStepPrompt(input: {
  originalPrompt: string;
  computerName: string;
  task: ReturnType<typeof toRuntimeTask>;
  previousOutputs: Record<string, unknown>;
}) {
  const priorOutputKeys = Object.keys(input.previousOutputs);
  return [
    `You are ${input.computerName}, executing one persisted runbook task.`,
    "",
    "Execute only the current task from the Runbook Execution Context.",
    "Do not print the full task list. Do not claim later tasks are complete.",
    "Use the available Strands tools when the task requires research, browser automation, or applet creation.",
    "Return a concise task output that the next runbook task can use.",
    "",
    "Original user request:",
    input.originalPrompt,
    "",
    "Current task:",
    `- ${input.task.title}`,
    input.task.summary ? `- ${input.task.summary}` : "",
    "",
    priorOutputKeys.length > 0
      ? `Prior output keys available: ${priorOutputKeys.join(", ")}`
      : "No prior task outputs are available yet.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function invokeRunbookStepAgent(input: {
  tenantId: string;
  threadId: string;
  agentId: string;
  userMessage: string;
  messageId: string;
  computerId: string;
  runbookContext: unknown;
}) {
  const fnArn = await getChatAgentInvokeFnArn();
  if (!fnArn) {
    throw new RunbookRuntimeError(
      "chat-agent-invoke Lambda is not configured",
      502,
    );
  }

  const response = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: fnArn,
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(
        JSON.stringify({
          threadId: input.threadId,
          tenantId: input.tenantId,
          agentId: input.agentId,
          userMessage: input.userMessage,
          messageId: input.messageId,
          computerId: input.computerId,
          runbookContext: input.runbookContext,
          responseMode: "runbook_step",
        }),
      ),
    }),
  );
  const rawPayload = response.Payload
    ? new TextDecoder().decode(response.Payload)
    : "{}";
  if (response.FunctionError) {
    throw new RunbookRuntimeError(
      `Runbook step agent failed: ${rawPayload.slice(0, 500)}`,
      502,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPayload);
  } catch {
    throw new RunbookRuntimeError(
      "Runbook step agent returned invalid JSON",
      502,
    );
  }
  if (!isRecord(parsed) || parsed.ok !== true) {
    throw new RunbookRuntimeError(
      `Runbook step agent returned an invalid response: ${rawPayload.slice(0, 500)}`,
      502,
    );
  }
  if (typeof parsed.responseText !== "string" || !parsed.responseText.trim()) {
    throw new RunbookRuntimeError(
      "Runbook step agent returned an empty response",
      502,
    );
  }
  return {
    ok: true as const,
    responseText: parsed.responseText,
    model: typeof parsed.model === "string" ? parsed.model : null,
    usage: parsed.usage,
    toolInvocations: Array.isArray(parsed.toolInvocations)
      ? parsed.toolInvocations.filter(isRecord)
      : [],
    durationMs:
      typeof parsed.durationMs === "number" ? parsed.durationMs : undefined,
  };
}

async function loadRunbookExecuteTask(input: {
  tenantId: string;
  computerId: string;
  taskId: string;
}) {
  const [task] = await db
    .select({
      id: computerTasks.id,
      task_type: computerTasks.task_type,
      input: computerTasks.input,
      claimed_at: computerTasks.claimed_at,
      created_at: computerTasks.created_at,
    })
    .from(computerTasks)
    .where(
      and(
        eq(computerTasks.tenant_id, input.tenantId),
        eq(computerTasks.computer_id, input.computerId),
        eq(computerTasks.id, input.taskId),
      ),
    )
    .limit(1);
  if (!task) throw new RunbookRuntimeError("Computer task not found", 404);
  if (task.task_type !== "runbook_execute") {
    throw new RunbookRuntimeError(
      "Only runbook_execute tasks can use runbook runtime endpoints",
      400,
    );
  }
  return { task, payload: runbookExecutePayload(task.input) };
}

async function loadRunbookRunState(input: {
  tenantId: string;
  computerId: string;
  runbookRunId: string;
}) {
  const [run] = await db
    .select()
    .from(computerRunbookRuns)
    .where(
      and(
        eq(computerRunbookRuns.tenant_id, input.tenantId),
        eq(computerRunbookRuns.computer_id, input.computerId),
        eq(computerRunbookRuns.id, input.runbookRunId),
      ),
    )
    .limit(1);
  if (!run) throw new RunbookRuntimeError("Runbook run not found", 404);
  const tasks = await db
    .select()
    .from(computerRunbookTasks)
    .where(
      and(
        eq(computerRunbookTasks.tenant_id, input.tenantId),
        eq(computerRunbookTasks.run_id, input.runbookRunId),
      ),
    )
    .orderBy(asc(computerRunbookTasks.sort_order));
  return { run, tasks };
}

function runbookExecutePayload(input: unknown) {
  const payload =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  return {
    runbookRunId: requiredString(payload.runbookRunId, "runbookRunId"),
    threadId: requiredString(payload.threadId, "threadId"),
    messageId: requiredString(payload.messageId, "messageId"),
  };
}

function toRuntimeRun(row: typeof computerRunbookRuns.$inferSelect) {
  return {
    id: row.id,
    status: row.status,
    runbookSlug: row.runbook_slug,
    runbookVersion: row.runbook_version,
  };
}

function toRuntimeTask(row: typeof computerRunbookTasks.$inferSelect) {
  return {
    id: row.id,
    phaseId: row.phase_id,
    phaseTitle: row.phase_title,
    taskKey: row.task_key,
    title: row.title,
    summary: row.summary ?? null,
    status: row.status as RunbookTaskStatus,
    dependsOn: Array.isArray(row.depends_on) ? row.depends_on.map(String) : [],
    capabilityRoles: Array.isArray(row.capability_roles)
      ? row.capability_roles.map(String)
      : [],
    sortOrder: row.sort_order,
    output: row.output ?? null,
  };
}

async function syncRunbookTaskQueueMessage(input: {
  tenantId: string;
  computerId: string;
  runbookRunId: string;
}) {
  const { run, tasks } = await loadRunbookRunState(input);
  if (!run.thread_id) return;

  const [queueMessage] = await db
    .select({ id: messages.id, parts: messages.parts })
    .from(messages)
    .where(
      and(
        eq(messages.tenant_id, input.tenantId),
        eq(messages.thread_id, run.thread_id),
        sql`${messages.metadata}->>'runbookMessageKey' = ${`runbook-queue:${run.id}`}`,
      ),
    )
    .limit(1);
  if (!queueMessage) return;

  const queueData = runbookTaskQueueData(run, tasks);
  await db
    .update(messages)
    .set({
      parts: upsertTaskQueuePart(
        queueMessage.parts,
        taskQueuePart({ queueId: run.id, data: queueData }),
      ),
    })
    .where(
      and(
        eq(messages.tenant_id, input.tenantId),
        eq(messages.id, queueMessage.id),
      ),
    );

  const [thread] = await db
    .select({
      id: threads.id,
      title: threads.title,
      status: threads.status,
      metadata: threads.metadata,
    })
    .from(threads)
    .where(
      and(eq(threads.tenant_id, input.tenantId), eq(threads.id, run.thread_id)),
    )
    .limit(1);
  if (!thread) return;

  await db
    .update(threads)
    .set({
      metadata: taskQueueThreadMetadata(thread.metadata, run.id),
      updated_at: new Date(),
    })
    .where(
      and(eq(threads.tenant_id, input.tenantId), eq(threads.id, thread.id)),
    );

  await notifyThreadUpdate({
    threadId: thread.id,
    tenantId: input.tenantId,
    status: thread.status ?? "in_progress",
    title: thread.title ?? "Untitled thread",
  }).catch(() => {});
}

function runbookTaskQueueData(
  run: typeof computerRunbookRuns.$inferSelect,
  tasks: (typeof computerRunbookTasks.$inferSelect)[],
): TaskQueueData {
  const definition = recordValue(run.definition_snapshot);
  const displayName =
    recordValue(definition.catalog).displayName?.toString().trim() ||
    run.runbook_slug;
  const phases = phasesForQueue(definition, tasks);
  return {
    queueId: run.id,
    title: displayName,
    status: run.status,
    source: {
      type: "runbook",
      id: run.id,
      slug: run.runbook_slug,
    },
    summary: "Working through the approved runbook queue.",
    groups: phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      items: tasks
        .filter((task) => task.phase_id === phase.id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((task) => ({
          id: task.id,
          title: task.title,
          summary: task.summary,
          status: task.status,
          output: task.output ?? undefined,
          error: task.error ?? undefined,
          startedAt: task.started_at?.toISOString() ?? null,
          completedAt: task.completed_at?.toISOString() ?? null,
          metadata: {
            taskKey: task.task_key,
            dependsOn: Array.isArray(task.depends_on) ? task.depends_on : [],
            capabilityRoles: Array.isArray(task.capability_roles)
              ? task.capability_roles
              : [],
            sortOrder: task.sort_order,
            runbookSlug: run.runbook_slug,
            runbookVersion: run.runbook_version,
          },
        })),
    })),
  };
}

function phasesForQueue(
  definition: Record<string, unknown>,
  tasks: (typeof computerRunbookTasks.$inferSelect)[],
) {
  const phases = Array.isArray(definition.phases) ? definition.phases : [];
  const declared = phases
    .map(recordValue)
    .map((phase) => ({
      id: stringValue(phase.id),
      title: stringValue(phase.title) ?? stringValue(phase.id),
    }))
    .filter((phase): phase is { id: string; title: string } =>
      Boolean(phase.id && phase.title),
    );
  if (declared.length > 0) return declared;

  const seen = new Map<string, string>();
  for (const task of tasks.sort((a, b) => a.sort_order - b.sort_order)) {
    seen.set(task.phase_id, task.phase_title);
  }
  return [...seen].map(([id, title]) => ({ id, title }));
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new RunbookRuntimeError(`Computer task input missing ${name}`, 400);
  }
  return value.trim();
}
