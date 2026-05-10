import type { ComputerRuntimeApi, RuntimeTask } from "./api-client.js";

export type RunbookTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export type RunbookExecutionTask = {
  id: string;
  phaseId: string;
  phaseTitle: string;
  taskKey: string;
  title: string;
  summary?: string | null;
  status: RunbookTaskStatus;
  dependsOn: string[];
  capabilityRoles: string[];
  sortOrder: number;
  output?: unknown;
};

export type RunbookExecutionContext = {
  taskId: string;
  run: {
    id: string;
    status: string;
    runbookSlug: string;
    runbookVersion: string;
  };
  tasks: RunbookExecutionTask[];
  definitionSnapshot?: unknown;
  inputs?: unknown;
  previousOutputs: Record<string, unknown>;
};

export type RunbookRuntimeApi = Pick<
  ComputerRuntimeApi,
  | "appendTaskEvent"
  | "loadRunbookExecutionContext"
  | "startRunbookTask"
  | "completeRunbookTask"
  | "failRunbookTask"
  | "completeRunbookRun"
>;

export type RunbookTaskRunner = (
  task: RunbookExecutionTask,
  context: RunbookExecutionContext,
) => Promise<unknown>;

export async function executeRunbook(
  task: RuntimeTask,
  api: RunbookRuntimeApi,
  runner: RunbookTaskRunner = defaultRunbookTaskRunner,
) {
  const input = parseRunbookExecuteInput(task.input);
  let context = await api.loadRunbookExecutionContext(task.id);
  validateRunbookDependencies(context.tasks);
  const previousOutputs = collectPreviousOutputs(context.tasks);
  if (isCancelled(context.run.status)) {
    await api.appendTaskEvent(task.id, {
      eventType: "runbook_cancelled",
      level: "warn",
      payload: { runbookRunId: input.runbookRunId },
    });
    return {
      ok: true,
      taskType: "runbook_execute",
      runbookRunId: input.runbookRunId,
      status: "cancelled",
      cancelled: true,
      taskOutputs: previousOutputs,
    };
  }

  for (const runbookTask of context.tasks.sort(bySortOrder)) {
    context = await api.loadRunbookExecutionContext(task.id);
    if (isCancelled(context.run.status)) {
      await api.appendTaskEvent(task.id, {
        eventType: "runbook_cancelled",
        level: "warn",
        payload: {
          runbookRunId: input.runbookRunId,
          skippedAtTaskKey: runbookTask.taskKey,
        },
      });
      return {
        ok: true,
        taskType: "runbook_execute",
        runbookRunId: input.runbookRunId,
        status: "cancelled",
        cancelled: true,
        taskOutputs: previousOutputs,
      };
    }

    if (runbookTask.status === "completed") {
      previousOutputs[runbookTask.taskKey] = runbookTask.output ?? null;
      continue;
    }
    if (
      runbookTask.status === "cancelled" ||
      runbookTask.status === "skipped"
    ) {
      continue;
    }
    if (runbookTask.status === "failed") {
      throw new Error(`Runbook task ${runbookTask.taskKey} is already failed`);
    }

    assertDependenciesCompleted(runbookTask, previousOutputs);
    await api.startRunbookTask(task.id, runbookTask.id);
    await api.appendTaskEvent(task.id, {
      eventType: "runbook_task_started",
      level: "info",
      payload: eventPayload(input.runbookRunId, runbookTask),
    });

    try {
      const output = await runner(runbookTask, {
        ...context,
        previousOutputs: { ...previousOutputs },
      });
      previousOutputs[runbookTask.taskKey] = output ?? null;
      await api.completeRunbookTask(task.id, runbookTask.id, output ?? null);
      await api.appendTaskEvent(task.id, {
        eventType: "runbook_task_completed",
        level: "info",
        payload: {
          ...eventPayload(input.runbookRunId, runbookTask),
          outputKey: runbookTask.taskKey,
        },
      });
    } catch (error) {
      const payload = {
        ...eventPayload(input.runbookRunId, runbookTask),
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
      await api.failRunbookTask(task.id, runbookTask.id, payload.error);
      await api.appendTaskEvent(task.id, {
        eventType: "runbook_task_failed",
        level: "error",
        payload,
      });
      throw error;
    }
  }

  const output = {
    runbookRunId: input.runbookRunId,
    taskOutputs: previousOutputs,
    completedTaskCount: Object.keys(previousOutputs).length,
  };
  await api.completeRunbookRun(task.id, output);
  await api.appendTaskEvent(task.id, {
    eventType: "runbook_completed",
    level: "info",
    payload: {
      runbookRunId: input.runbookRunId,
      completedTaskCount: output.completedTaskCount,
    },
  });
  return {
    ok: true,
    taskType: "runbook_execute",
    status: "completed",
    ...output,
  };
}

export async function defaultRunbookTaskRunner(
  task: RunbookExecutionTask,
  context: RunbookExecutionContext,
) {
  return {
    taskKey: task.taskKey,
    phaseId: task.phaseId,
    capabilityRoles: task.capabilityRoles,
    title: task.title,
    priorOutputKeys: Object.keys(context.previousOutputs),
  };
}

function collectPreviousOutputs(tasks: RunbookExecutionTask[]) {
  const outputs: Record<string, unknown> = {};
  for (const task of tasks) {
    if (task.status === "completed")
      outputs[task.taskKey] = task.output ?? null;
  }
  return outputs;
}

function validateRunbookDependencies(tasks: RunbookExecutionTask[]) {
  const knownKeys = new Set(tasks.map((task) => task.taskKey));
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!knownKeys.has(dependency)) {
        throw new Error(
          `Runbook task ${task.taskKey} depends on unknown task ${dependency}`,
        );
      }
    }
  }
}

function assertDependenciesCompleted(
  task: RunbookExecutionTask,
  previousOutputs: Record<string, unknown>,
) {
  for (const dependency of task.dependsOn) {
    if (!Object.prototype.hasOwnProperty.call(previousOutputs, dependency)) {
      throw new Error(
        `Runbook task ${task.taskKey} cannot start before dependency ${dependency}`,
      );
    }
  }
}

function parseRunbookExecuteInput(input: unknown) {
  const payload =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  return {
    runbookRunId: requiredString(payload.runbookRunId, "runbookRunId"),
  };
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function eventPayload(runbookRunId: string, task: RunbookExecutionTask) {
  return {
    runbookRunId,
    runbookTaskId: task.id,
    taskKey: task.taskKey,
    phaseId: task.phaseId,
    phaseTitle: task.phaseTitle,
    capabilityRoles: task.capabilityRoles,
  };
}

function bySortOrder(a: RunbookExecutionTask, b: RunbookExecutionTask) {
  return a.sortOrder - b.sortOrder;
}

function isCancelled(status: string) {
  return status.toLowerCase() === "cancelled";
}
