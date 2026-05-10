import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  computerRunbookRuns,
  computerRunbookTasks,
  computers,
  computerTasks,
  messages,
  threads,
  type RunbookTaskStatus,
} from "@thinkwork/database-pg/schema";

const db = getDb();

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
  return db.transaction(async (tx) => {
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
  return toRuntimeTask(updated);
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
  return toRuntimeRun(updated);
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

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new RunbookRuntimeError(`Computer task input missing ${name}`, 400);
  }
  return value.trim();
}
