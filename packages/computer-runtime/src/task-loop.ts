import { smokeGoogleWorkspaceCli } from "./google-cli-smoke.js";
import { writeHealthCheck, writeWorkspaceFile } from "./workspace.js";
import type { ComputerRuntimeApi, RuntimeTask } from "./api-client.js";

export type TaskLoopOptions = {
  api: Pick<
    ComputerRuntimeApi,
    "claimTask" | "completeTask" | "failTask" | "appendTaskEvent"
  >;
  workspaceRoot: string;
  idleDelayMs: number;
};

export async function runTaskLoopOnce(options: TaskLoopOptions) {
  const task = await options.api.claimTask();
  if (!task) {
    await sleep(options.idleDelayMs);
    return { handled: false as const };
  }

  try {
    const output = await handleTask(task, options.workspaceRoot);
    await options.api.completeTask(task.id, output);
    return { handled: true as const, taskId: task.id, output };
  } catch (err) {
    const payload = {
      message: err instanceof Error ? err.message : String(err),
    };
    await options.api.appendTaskEvent(task.id, {
      eventType: "task_error",
      level: "error",
      payload,
    });
    await options.api.failTask(task.id, payload);
    return { handled: true as const, taskId: task.id, error: payload };
  }
}

export async function handleTask(task: RuntimeTask, workspaceRoot: string) {
  if (task.taskType === "noop") {
    return { ok: true, taskType: "noop" };
  }
  if (task.taskType === "health_check") {
    const markerPath = await writeHealthCheck(workspaceRoot, task.id);
    return { ok: true, taskType: "health_check", markerPath };
  }
  if (task.taskType === "workspace_file_write") {
    const written = await writeWorkspaceFile(workspaceRoot, task.input);
    return { ok: true, taskType: "workspace_file_write", ...written };
  }
  if (task.taskType === "google_cli_smoke") {
    const smoke = await smokeGoogleWorkspaceCli();
    return { ok: true, taskType: "google_cli_smoke", smoke };
  }
  throw new Error(`Unsupported Computer task type: ${task.taskType}`);
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
