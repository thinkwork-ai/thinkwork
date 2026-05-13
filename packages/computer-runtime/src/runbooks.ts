import type {
  ComputerRuntimeApi,
  RunbookAgentStepOutput,
  RuntimeTask,
} from "./api-client.js";
import { invokeRunbookAgentCoreStep } from "./agentcore-runbook-step.js";

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
  error?: unknown;
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
  | "executeRunbookTask"
  | "completeRunbookTask"
  | "failRunbookTask"
  | "completeRunbookRun"
  | "recordRunbookResponse"
>;

const DEFAULT_STEP_POLL_INTERVAL_MS = 5000;
const DEFAULT_STEP_POLL_TIMEOUT_MS = 8 * 60 * 1000;

export type RunbookTaskRunner = (
  task: RunbookExecutionTask,
  context: RunbookExecutionContext,
) => Promise<unknown>;

export async function executeRunbook(
  task: RuntimeTask,
  api: RunbookRuntimeApi,
  runner?: RunbookTaskRunner,
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

  let runbookResponseRecorded = false;
  for (const scheduledTask of context.tasks.sort(bySortOrder)) {
    context = await api.loadRunbookExecutionContext(task.id);
    const runbookTask =
      context.tasks.find((candidate) => candidate.id === scheduledTask.id) ??
      scheduledTask;
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
      const output = await (runner ?? defaultRunbookTaskRunner(api, task.id))(
        runbookTask,
        {
          ...context,
          previousOutputs: { ...previousOutputs },
        },
      );
      const taskAfterRun = await loadCurrentRunbookTask(
        api,
        task.id,
        runbookTask.id,
      );
      const completedElsewhere = taskAfterRun?.status === "completed";
      const finalOutput = completedElsewhere
        ? (taskAfterRun.output ?? output ?? null)
        : (output ?? null);
      previousOutputs[runbookTask.taskKey] = finalOutput;
      if (!completedElsewhere) {
        await api.completeRunbookTask(task.id, runbookTask.id, finalOutput);
      }
      await completeArtifactPersistenceTaskIfSatisfied({
        api,
        computerTaskId: task.id,
        tasks: context.tasks,
        completedTask: runbookTask,
        output: finalOutput,
        previousOutputs,
      });
      runbookResponseRecorded =
        (await recordArtifactRunbookResponseIfReady(task.id, api, finalOutput)) ||
        runbookResponseRecorded;
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
  if (!runbookResponseRecorded) {
    await recordFinalRunbookResponse(task.id, api, previousOutputs);
  }
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

export function defaultRunbookTaskRunner(
  api: Pick<
    ComputerRuntimeApi,
    "executeRunbookTask" | "loadRunbookExecutionContext"
  >,
  computerTaskId: string,
): RunbookTaskRunner {
  return async (task) => {
    const result = await api.executeRunbookTask(computerTaskId, task.id);
    if (isRunbookAgentStepOutput(result)) return result;
    if (result.invocation) return invokeRunbookAgentCoreStep(result.invocation);
    return waitForRunbookTaskCompletion(api, computerTaskId, task.id);
  };
}

async function completeArtifactPersistenceTaskIfSatisfied(input: {
  api: Pick<ComputerRuntimeApi, "completeRunbookTask">;
  computerTaskId: string;
  tasks: RunbookExecutionTask[];
  completedTask: RunbookExecutionTask;
  output: unknown;
  previousOutputs: Record<string, unknown>;
}) {
  if (!hasSuccessfulSaveAppEvidence(input.output)) return;
  if (!isArtifactBuildTask(input.completedTask)) return;

  const persistenceTask = input.tasks.find(
    (task) =>
      task.id !== input.completedTask.id &&
      task.phaseId === input.completedTask.phaseId &&
      isArtifactBuildTask(task) &&
      isPendingLike(task.status) &&
      isSaveAppPersistenceTask(task),
  );
  if (!persistenceTask) return;

  const output = {
    satisfiedByTaskKey: input.completedTask.taskKey,
    ...saveAppEvidenceSummary(input.output),
  };
  await input.api.completeRunbookTask(
    input.computerTaskId,
    persistenceTask.id,
    output,
  );
  input.previousOutputs[persistenceTask.taskKey] = output;
}

async function recordArtifactRunbookResponseIfReady(
  computerTaskId: string,
  api: Pick<ComputerRuntimeApi, "recordRunbookResponse">,
  output: unknown,
) {
  if (!hasSuccessfulSaveAppEvidence(output)) return false;
  if (!isRecord(output) || typeof output.responseText !== "string") return false;
  const content = output.responseText.trim();
  if (!content) return false;
  await api.recordRunbookResponse(computerTaskId, {
    content,
    model: typeof output.model === "string" ? output.model : undefined,
    usage: output.usage,
  });
  return true;
}

async function recordFinalRunbookResponse(
  computerTaskId: string,
  api: Pick<ComputerRuntimeApi, "recordRunbookResponse">,
  outputs: Record<string, unknown>,
) {
  const finalOutput = [...Object.values(outputs)]
    .reverse()
    .find(
      (output) => isRecord(output) && typeof output.responseText === "string",
    ) as
    | { responseText?: string; model?: string | null; usage?: unknown }
    | undefined;
  const content = finalOutput?.responseText?.trim();
  if (!content || !finalOutput) return;
  await api.recordRunbookResponse(computerTaskId, {
    content,
    model: finalOutput.model,
    usage: finalOutput.usage,
  });
}

function collectPreviousOutputs(tasks: RunbookExecutionTask[]) {
  const outputs: Record<string, unknown> = {};
  for (const task of tasks) {
    if (task.status === "completed")
      outputs[task.taskKey] = task.output ?? null;
  }
  return outputs;
}

async function waitForRunbookTaskCompletion(
  api: Pick<ComputerRuntimeApi, "loadRunbookExecutionContext">,
  computerTaskId: string,
  runbookTaskId: string,
) {
  const startedAt = Date.now();
  const timeoutMs = positiveNumberFromEnv(
    "RUNBOOK_STEP_POLL_TIMEOUT_MS",
    DEFAULT_STEP_POLL_TIMEOUT_MS,
  );
  const intervalMs = positiveNumberFromEnv(
    "RUNBOOK_STEP_POLL_INTERVAL_MS",
    DEFAULT_STEP_POLL_INTERVAL_MS,
  );

  while (Date.now() - startedAt <= timeoutMs) {
    const task = await loadCurrentRunbookTask(
      api,
      computerTaskId,
      runbookTaskId,
    );
    if (!task) throw new Error(`Runbook task ${runbookTaskId} disappeared`);
    if (task.status === "completed") return task.output ?? null;
    if (task.status === "failed") {
      throw new Error(
        `Runbook task ${task.taskKey} failed${taskErrorSuffix(task.error)}`,
      );
    }
    if (task.status === "cancelled" || task.status === "skipped") {
      throw new Error(`Runbook task ${task.taskKey} is ${task.status}`);
    }
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for runbook task ${runbookTaskId}`);
}

async function loadCurrentRunbookTask(
  api: Pick<ComputerRuntimeApi, "loadRunbookExecutionContext">,
  computerTaskId: string,
  runbookTaskId: string,
) {
  const context = await api.loadRunbookExecutionContext(computerTaskId);
  return context.tasks.find((task) => task.id === runbookTaskId) ?? null;
}

function isRunbookAgentStepOutput(
  value: unknown,
): value is RunbookAgentStepOutput {
  return isRecord(value) && typeof value.responseText === "string";
}

function hasSuccessfulSaveAppEvidence(output: unknown) {
  return saveAppEvidenceSummary(output) !== null;
}

function saveAppEvidenceSummary(output: unknown) {
  if (!isRecord(output)) return null;
  const usage = isRecord(output.usage) ? output.usage : {};
  const invocations = Array.isArray(usage.tool_invocations)
    ? usage.tool_invocations
    : [];
  for (const invocation of invocations) {
    if (!isRecord(invocation)) continue;
    if (invocation.tool_name !== "save_app") continue;
    const toolOutput = isRecord(invocation.output_json)
      ? invocation.output_json
      : parseJsonRecord(invocation.output_preview);
    if (!toolOutput) continue;
    if (toolOutput.ok !== true || toolOutput.persisted !== true) continue;
    const appId =
      typeof toolOutput.appId === "string" && toolOutput.appId.trim()
        ? toolOutput.appId.trim()
        : null;
    return {
      ok: true,
      persisted: true,
      appId,
      validated: toolOutput.validated === true,
    };
  }
  return null;
}

function parseJsonRecord(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isArtifactBuildTask(task: RunbookExecutionTask) {
  return (
    task.capabilityRoles.includes("artifact_build") ||
    task.capabilityRoles.includes("map_build")
  );
}

function isPendingLike(status: RunbookTaskStatus) {
  return status === "pending" || status === "running";
}

function isSaveAppPersistenceTask(task: RunbookExecutionTask) {
  const text = `${task.title} ${task.summary ?? ""}`.toLowerCase();
  return text.includes("save_app") && text.includes("persist");
}

function positiveNumberFromEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function taskErrorSuffix(output: unknown) {
  if (!isRecord(output)) return "";
  const message = output.message;
  return typeof message === "string" && message ? `: ${message}` : "";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
