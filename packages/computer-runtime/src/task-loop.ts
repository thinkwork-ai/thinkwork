import { smokeGoogleWorkspaceCli } from "./google-cli-smoke.js";
import { listGoogleCalendarUpcomingWithGws } from "./google-workspace-cli.js";
import {
  deleteWorkspaceFile,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeHealthCheck,
  writeWorkspaceFile,
} from "./workspace.js";
import type { ComputerRuntimeApi, RuntimeTask } from "./api-client.js";
import {
  runComputerChatTurn,
  type ComputerChatRunner,
} from "./computer-chat.js";
import { executeRunbook, type RunbookTaskRunner } from "./runbooks.js";

type GoogleWorkspaceCliRunner = typeof listGoogleCalendarUpcomingWithGws;
type RunbookApiMethods = Pick<
  ComputerRuntimeApi,
  | "loadRunbookExecutionContext"
  | "startRunbookTask"
  | "executeRunbookTask"
  | "completeRunbookTask"
  | "failRunbookTask"
  | "completeRunbookRun"
  | "recordRunbookResponse"
>;

export type TaskLoopOptions = {
  api: Pick<
    ComputerRuntimeApi,
    | "claimTask"
    | "completeTask"
    | "failTask"
    | "appendTaskEvent"
    | "checkGoogleWorkspaceConnection"
    | "loadThreadTurnContext"
    | "recordThreadTurnResponse"
    | "resolveGoogleWorkspaceCliToken"
  > &
    Partial<Pick<ComputerRuntimeApi, "cancelTask"> & RunbookApiMethods>;
  workspaceRoot: string;
  idleDelayMs: number;
  computerChat?: ComputerChatRunner;
  runbookTaskRunner?: RunbookTaskRunner;
};

export async function runTaskLoopOnce(options: TaskLoopOptions): Promise<any> {
  const task = await options.api.claimTask();
  if (!task) {
    await sleep(options.idleDelayMs);
    return { handled: false as const };
  }

  try {
    const output = await handleTask(
      task,
      options.workspaceRoot,
      options.api,
      undefined,
      options.computerChat,
      options.runbookTaskRunner,
    );
    if (isCancelledOutput(output)) {
      assertCancelApi(options.api);
      await options.api.cancelTask(task.id, output);
      return { handled: true as const, taskId: task.id, output };
    }
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

export async function handleTask(
  task: RuntimeTask,
  workspaceRoot: string,
  api?: Pick<
    ComputerRuntimeApi,
    | "appendTaskEvent"
    | "checkGoogleWorkspaceConnection"
    | "loadThreadTurnContext"
    | "recordThreadTurnResponse"
    | "resolveGoogleWorkspaceCliToken"
  > &
    Partial<RunbookApiMethods>,
  googleWorkspaceCli: GoogleWorkspaceCliRunner = listGoogleCalendarUpcomingWithGws,
  computerChat: ComputerChatRunner = runComputerChatTurn,
  runbookTaskRunner?: RunbookTaskRunner,
): Promise<any> {
  if (task.taskType === "noop") {
    return { ok: true, taskType: "noop" };
  }
  if (task.taskType === "health_check") {
    const markerPath = await writeHealthCheck(workspaceRoot, task.id);
    return { ok: true, taskType: "health_check", markerPath };
  }
  if (task.taskType === "workspace_file_list") {
    const listed = await listWorkspaceFiles(workspaceRoot);
    return { ok: true, taskType: "workspace_file_list", ...listed };
  }
  if (task.taskType === "workspace_file_read") {
    const read = await readWorkspaceFile(workspaceRoot, task.input);
    return { ok: true, taskType: "workspace_file_read", ...read };
  }
  if (task.taskType === "workspace_file_write") {
    const written = await writeWorkspaceFile(workspaceRoot, task.input);
    return { ok: true, taskType: "workspace_file_write", ...written };
  }
  if (task.taskType === "workspace_file_delete") {
    const deleted = await deleteWorkspaceFile(workspaceRoot, task.input);
    return { ok: true, taskType: "workspace_file_delete", ...deleted };
  }
  if (task.taskType === "google_cli_smoke") {
    const smoke = await smokeGoogleWorkspaceCli();
    return { ok: true, taskType: "google_cli_smoke", smoke };
  }
  if (task.taskType === "thread_turn") {
    if (!api) throw new Error("Computer runtime API is required");
    const threadTurn = parseThreadTurnInput(task.input);
    const requesterUserId =
      threadTurn.requesterUserId ?? taskRequesterUserId(task);
    await api.appendTaskEvent(task.id, {
      eventType: "thread_turn_claimed",
      level: "info",
      payload: {
        threadId: threadTurn.threadId,
        messageId: threadTurn.messageId,
        source: threadTurn.source,
        requesterUserId,
        contextClass: requesterUserId ? "user" : "system",
      },
    });
    const context = await api.loadThreadTurnContext(task.id);
    const response = await computerChat(context, { workspaceRoot });
    const execution = await api.recordThreadTurnResponse(task.id, response);
    return {
      ok: true,
      taskType: "thread_turn",
      ...execution,
    };
  }
  if (task.taskType === "runbook_execute") {
    if (!api) throw new Error("Computer runtime API is required");
    assertRunbookApi(api);
    return executeRunbook(task, api, runbookTaskRunner);
  }
  if (task.taskType === "google_workspace_auth_check") {
    if (!api) throw new Error("Computer runtime API is required");
    const requesterUserId = taskRequesterUserId(task);
    const googleWorkspace = await api.checkGoogleWorkspaceConnection({
      requesterUserId,
    });
    await api.appendTaskEvent(task.id, {
      eventType: "google_workspace_auth_checked",
      level:
        googleWorkspace.connected && googleWorkspace.tokenResolved
          ? "info"
          : "warn",
      payload: {
        providerName: googleWorkspace.providerName,
        connected: googleWorkspace.connected,
        tokenResolved: googleWorkspace.tokenResolved,
        connectionId: googleWorkspace.connectionId ?? null,
        requesterUserId,
        missingScopes: googleWorkspace.missingScopes ?? [],
        reason: googleWorkspace.reason ?? null,
      },
    });
    return {
      ok: true,
      taskType: "google_workspace_auth_check",
      googleWorkspace,
    };
  }
  if (task.taskType === "google_calendar_upcoming") {
    if (!api) throw new Error("Computer runtime API is required");
    const taskInput = parseCalendarUpcomingInput(task.input);
    const requesterUserId = taskRequesterUserId(task);
    const cliToken = await api.resolveGoogleWorkspaceCliToken({
      requesterUserId,
    });
    let googleCalendar;
    if (
      cliToken.connected &&
      cliToken.tokenResolved &&
      cliToken.accessToken &&
      Array.isArray(cliToken.missingScopes) &&
      cliToken.missingScopes.length > 0
    ) {
      googleCalendar = {
        providerName: cliToken.providerName,
        connected: true,
        tokenResolved: true,
        calendarAvailable: false,
        connectionId: cliToken.connectionId ?? null,
        reason: "missing_google_calendar_scope",
        missingScopes: cliToken.missingScopes,
        timeMin: taskInput.timeMin,
        timeMax: taskInput.timeMax,
        maxResults: taskInput.maxResults,
        events: [],
        eventCount: 0,
      };
    } else if (
      cliToken.connected &&
      cliToken.tokenResolved &&
      cliToken.accessToken
    ) {
      googleCalendar = await googleWorkspaceCli(taskInput, {
        accessToken: cliToken.accessToken,
      });
    } else {
      googleCalendar = {
        providerName: cliToken.providerName,
        connected: cliToken.connected,
        tokenResolved: cliToken.tokenResolved,
        calendarAvailable: false,
        connectionId: cliToken.connectionId ?? null,
        reason: cliToken.reason ?? null,
        timeMin: taskInput.timeMin,
        timeMax: taskInput.timeMax,
        maxResults: taskInput.maxResults,
        events: [],
        eventCount: 0,
        missingScopes: cliToken.missingScopes ?? [],
      };
    }
    await api.appendTaskEvent(task.id, {
      eventType: "google_calendar_upcoming_checked",
      level:
        googleCalendar.connected &&
        googleCalendar.tokenResolved &&
        googleCalendar.calendarAvailable
          ? "info"
          : "warn",
      payload: {
        providerName: googleCalendar.providerName,
        connected: googleCalendar.connected,
        tokenResolved: googleCalendar.tokenResolved,
        calendarAvailable: googleCalendar.calendarAvailable,
        eventCount: googleCalendar.eventCount,
        requesterUserId,
        reason: googleCalendar.reason ?? null,
        missingScopes: googleCalendar.missingScopes ?? [],
      },
    });
    return {
      ok: true,
      taskType: "google_calendar_upcoming",
      googleCalendar,
    };
  }
  throw new Error(`Unsupported Computer task type: ${task.taskType}`);
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCalendarUpcomingInput(input: unknown) {
  const payload =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const timeMin = requiredString(payload.timeMin, "timeMin");
  const timeMax = requiredString(payload.timeMax, "timeMax");
  const maxResults =
    typeof payload.maxResults === "number" &&
    Number.isInteger(payload.maxResults)
      ? payload.maxResults
      : 10;
  return { timeMin, timeMax, maxResults };
}

function taskRequesterUserId(task: RuntimeTask): string | null {
  if (typeof task.createdByUserId === "string" && task.createdByUserId.trim()) {
    return task.createdByUserId.trim();
  }
  const payload =
    task.input && typeof task.input === "object" && !Array.isArray(task.input)
      ? (task.input as Record<string, unknown>)
      : {};
  return typeof payload.requesterUserId === "string" &&
    payload.requesterUserId.trim()
    ? payload.requesterUserId.trim()
    : null;
}

function parseThreadTurnInput(input: unknown) {
  const payload =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  return {
    threadId: requiredString(payload.threadId, "threadId"),
    messageId: requiredString(payload.messageId, "messageId"),
    source:
      typeof payload.source === "string" && payload.source.trim()
        ? payload.source.trim()
        : "chat_message",
    requesterUserId:
      typeof payload.requesterUserId === "string" &&
      payload.requesterUserId.trim()
        ? payload.requesterUserId.trim()
        : null,
  };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function isCancelledOutput(value: unknown): value is { cancelled: true } {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).cancelled === true,
  );
}

function assertRunbookApi(
  api: Partial<RunbookApiMethods>,
): asserts api is RunbookApiMethods {
  const required: Array<keyof RunbookApiMethods> = [
    "loadRunbookExecutionContext",
    "startRunbookTask",
    "executeRunbookTask",
    "completeRunbookTask",
    "failRunbookTask",
    "completeRunbookRun",
    "recordRunbookResponse",
  ];
  for (const key of required) {
    if (typeof api[key] !== "function") {
      throw new Error(
        "Computer runtime API is missing runbook execution methods",
      );
    }
  }
}

function assertCancelApi(
  api: Partial<Pick<ComputerRuntimeApi, "cancelTask">>,
): asserts api is Pick<ComputerRuntimeApi, "cancelTask"> {
  if (typeof api.cancelTask !== "function") {
    throw new Error("Computer runtime API is missing task cancellation");
  }
}
