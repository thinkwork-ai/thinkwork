import { smokeGoogleWorkspaceCli } from "./google-cli-smoke.js";
import { listGoogleCalendarUpcomingWithGws } from "./google-workspace-cli.js";
import { writeHealthCheck, writeWorkspaceFile } from "./workspace.js";
import type { ComputerRuntimeApi, RuntimeTask } from "./api-client.js";

type GoogleWorkspaceCliRunner = typeof listGoogleCalendarUpcomingWithGws;

export type TaskLoopOptions = {
  api: Pick<
    ComputerRuntimeApi,
    | "claimTask"
    | "completeTask"
    | "failTask"
    | "appendTaskEvent"
    | "checkGoogleWorkspaceConnection"
    | "delegateConnectorWork"
    | "resolveGoogleWorkspaceCliToken"
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
    const output = await handleTask(task, options.workspaceRoot, options.api);
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
    | "delegateConnectorWork"
    | "resolveGoogleWorkspaceCliToken"
  >,
  googleWorkspaceCli: GoogleWorkspaceCliRunner = listGoogleCalendarUpcomingWithGws,
) {
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
  if (task.taskType === "connector_work") {
    if (!api) throw new Error("Computer runtime API is required");
    const delegation = await api.delegateConnectorWork(task.id);
    return {
      ok: true,
      taskType: "connector_work",
      accepted: true,
      ...delegation,
    };
  }
  if (task.taskType === "thread_turn") {
    const threadTurn = parseThreadTurnInput(task.input);
    await api?.appendTaskEvent(task.id, {
      eventType: "thread_turn_claimed",
      level: "info",
      payload: {
        threadId: threadTurn.threadId,
        messageId: threadTurn.messageId,
        source: threadTurn.source,
      },
    });
    return {
      ok: true,
      taskType: "thread_turn",
      threadId: threadTurn.threadId,
      messageId: threadTurn.messageId,
      source: threadTurn.source,
      claimed: true,
    };
  }
  if (task.taskType === "google_workspace_auth_check") {
    if (!api) throw new Error("Computer runtime API is required");
    const googleWorkspace = await api.checkGoogleWorkspaceConnection();
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
    const cliToken = await api.resolveGoogleWorkspaceCliToken();
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
  };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value;
}
