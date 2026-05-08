import { useEffect, useMemo } from "react";
import { useMutation, useQuery } from "urql";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  KeyRound,
  Loader2,
  Terminal,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ComputerTasksQuery,
  ComputerThreadsQuery,
  EnqueueComputerTaskMutation,
} from "@/lib/graphql-queries";
import {
  ComputerTaskStatus,
  ComputerTaskType,
  type Computer,
} from "@/gql/graphql";
import { relativeTime } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useTenant } from "@/context/TenantContext";

type ComputerLiveTasksPanelProps = {
  computer: Pick<Computer, "id" | "tenantId" | "slug" | "runtimeStatus">;
  onChanged?: () => void;
};

const API_URL = import.meta.env.VITE_API_URL || "";
const GOOGLE_WORKSPACE_SCOPES = ["gmail", "calendar", "identity"];

type ComputerThreadSummary = {
  id: string;
  identifier?: string | null;
  title: string;
  lastResponsePreview?: string | null;
};

type ThreadTurnContext = {
  threadId: string;
  threadLabel: string;
  lastResponsePreview?: string | null;
  dispatchedAgentId?: string | null;
  dispatchStatus?: string | null;
  source?: string | null;
};

function label(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function taskIcon(status: ComputerTaskStatus) {
  if (status === ComputerTaskStatus.Completed) return CheckCircle2;
  if (status === ComputerTaskStatus.Failed) return XCircle;
  if (status === ComputerTaskStatus.Running) return Loader2;
  return Clock;
}

function taskTone(status: ComputerTaskStatus): string {
  if (status === ComputerTaskStatus.Completed) return "text-emerald-500";
  if (status === ComputerTaskStatus.Failed) return "text-destructive";
  if (status === ComputerTaskStatus.Running) return "text-cyan-500";
  return "text-muted-foreground";
}

function taskTimestamp(task: {
  completedAt?: string | null;
  claimedAt?: string | null;
  createdAt: string;
}): string {
  if (task.completedAt) return `Completed ${relativeTime(task.completedAt)}`;
  if (task.claimedAt) return `Claimed ${relativeTime(task.claimedAt)}`;
  return `Queued ${relativeTime(task.createdAt)}`;
}

function objectPayload(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(
  payload: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function shortId(value?: string | null): string {
  return value ? value.slice(0, 8) : "—";
}

function threadTurnContext(
  task: {
    taskType: ComputerTaskType;
    input?: unknown;
    output?: unknown;
  },
  threadsById: Map<string, ComputerThreadSummary>,
): ThreadTurnContext | null {
  if (task.taskType !== ComputerTaskType.ThreadTurn) return null;

  const input = objectPayload(task.input);
  const output = objectPayload(task.output);
  const threadId =
    stringField(output, "threadId") ?? stringField(input, "threadId");
  if (!threadId) return null;

  const thread = threadsById.get(threadId);
  return {
    threadId,
    threadLabel: thread?.identifier
      ? `${thread.identifier}: ${thread.title}`
      : (thread?.title ?? `Thread ${shortId(threadId)}`),
    lastResponsePreview: thread?.lastResponsePreview ?? null,
    dispatchedAgentId: stringField(output, "agentId"),
    dispatchStatus: stringField(output, "status"),
    source: stringField(output, "source") ?? stringField(input, "source"),
  };
}

function outputSummary(
  output: unknown,
  error: unknown,
  threadContext?: ThreadTurnContext | null,
): string {
  if (threadContext) return threadContext.threadLabel;
  const payload =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : output && typeof output === "object"
        ? (output as Record<string, unknown>)
        : null;
  if (!payload) return "—";
  const markerPath = payload.markerPath ?? payload.path;
  if (typeof markerPath === "string") return markerPath;
  const smoke = payload.smoke;
  if (smoke && typeof smoke === "object") {
    const smokePayload = smoke as Record<string, unknown>;
    if (smokePayload.available === true) {
      const version = smokePayload.version;
      return typeof version === "string"
        ? `Google CLI available: ${version}`
        : "Google CLI available";
    }
    if (smokePayload.available === false) return "Google CLI unavailable";
  }
  const googleWorkspace = payload.googleWorkspace;
  if (googleWorkspace && typeof googleWorkspace === "object") {
    const googlePayload = googleWorkspace as Record<string, unknown>;
    const missingScopes = googlePayload.missingScopes;
    if (Array.isArray(missingScopes) && missingScopes.length > 0) {
      return "Google Workspace connected, Calendar scope missing";
    }
    if (
      googlePayload.connected === true &&
      googlePayload.tokenResolved === true
    ) {
      return "Google Workspace connected";
    }
    if (googlePayload.connected === true) {
      return "Google Workspace token unavailable";
    }
    return "Google Workspace not connected";
  }
  const googleCalendar = payload.googleCalendar;
  if (googleCalendar && typeof googleCalendar === "object") {
    const calendarPayload = googleCalendar as Record<string, unknown>;
    if (calendarPayload.connected !== true)
      return "Google Calendar not connected";
    if (calendarPayload.tokenResolved !== true) {
      return "Google Calendar token unavailable";
    }
    if (calendarPayload.calendarAvailable !== true) {
      const reason = calendarPayload.reason;
      if (reason === "missing_google_calendar_scope") {
        return "Google Calendar scope missing. Reconnect Google Workspace.";
      }
      if (reason === "google_calendar_api_disabled") {
        const projectId = calendarPayload.projectId;
        return typeof projectId === "string"
          ? `Google Calendar API disabled for project ${projectId}`
          : "Google Calendar API disabled for the OAuth project";
      }
      return typeof reason === "string"
        ? `Google Calendar unavailable: ${reason}`
        : "Google Calendar unavailable";
    }
    const count =
      typeof calendarPayload.eventCount === "number"
        ? calendarPayload.eventCount
        : Array.isArray(calendarPayload.events)
          ? calendarPayload.events.length
          : 0;
    return `${count} ${count === 1 ? "event" : "events"} upcoming`;
  }
  const message = payload.message;
  if (typeof message === "string") return message;
  return "Output recorded";
}

function taskHasMissingGoogleCalendarScope(task: {
  output?: unknown;
  error?: unknown;
}): boolean {
  const payload = taskPayload(task);
  if (!payload) return false;

  const googleCalendar = payload.googleCalendar;
  if (googleCalendar && typeof googleCalendar === "object") {
    const calendarPayload = googleCalendar as Record<string, unknown>;
    return calendarPayload.reason === "missing_google_calendar_scope";
  }

  const googleWorkspace = payload.googleWorkspace;
  if (googleWorkspace && typeof googleWorkspace === "object") {
    const workspacePayload = googleWorkspace as Record<string, unknown>;
    const missingScopes = workspacePayload.missingScopes;
    return (
      Array.isArray(missingScopes) &&
      missingScopes.includes("https://www.googleapis.com/auth/calendar")
    );
  }

  return false;
}

function taskHasGoogleWorkspaceSignal(task: {
  output?: unknown;
  error?: unknown;
}): boolean {
  const payload = taskPayload(task);
  return Boolean(
    payload &&
    ((payload.googleCalendar && typeof payload.googleCalendar === "object") ||
      (payload.googleWorkspace && typeof payload.googleWorkspace === "object")),
  );
}

function taskPayload(task: {
  output?: unknown;
  error?: unknown;
}): Record<string, unknown> | null {
  return task.error && typeof task.error === "object"
    ? (task.error as Record<string, unknown>)
    : task.output && typeof task.output === "object"
      ? (task.output as Record<string, unknown>)
      : null;
}

function TaskResultRow({
  task,
  threadContext = null,
  highlighted = false,
}: {
  task: {
    id: string;
    taskType: ComputerTaskType;
    status: ComputerTaskStatus;
    input?: unknown;
    output?: unknown;
    error?: unknown;
    completedAt?: string | null;
    claimedAt?: string | null;
    createdAt: string;
  };
  threadContext?: ThreadTurnContext | null;
  highlighted?: boolean;
}) {
  const Icon = taskIcon(task.status);

  return (
    <div
      className={`grid gap-3 text-sm lg:grid-cols-[minmax(0,1fr)_120px_180px] ${
        highlighted ? "rounded-md border bg-muted/20 p-3" : "p-3"
      }`}
    >
      <div className="flex min-w-0 items-start gap-2">
        <Icon
          className={`mt-0.5 h-4 w-4 shrink-0 ${taskTone(task.status)} ${
            task.status === ComputerTaskStatus.Running ? "animate-spin" : ""
          }`}
        />
        <div className="min-w-0">
          <div className="break-words font-medium">{label(task.taskType)}</div>
          <div className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">
            {outputSummary(task.output, task.error, threadContext)}
          </div>
          {threadContext ? (
            <div className="mt-2 space-y-1 rounded-md border bg-background/40 p-2 text-xs leading-relaxed">
              <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                <span>
                  Response worker {shortId(threadContext.dispatchedAgentId)}
                </span>
                {threadContext.dispatchStatus ? (
                  <Badge variant="outline" className="h-5 text-[11px]">
                    {label(threadContext.dispatchStatus)}
                  </Badge>
                ) : null}
                {threadContext.source ? (
                  <span>{label(threadContext.source)}</span>
                ) : null}
              </div>
              <div className="break-words text-foreground/90">
                {threadContext.lastResponsePreview
                  ? `Assistant: ${threadContext.lastResponsePreview}`
                  : "Assistant response pending"}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="lg:text-center">
        <Badge variant="outline" className="text-xs">
          {label(task.status)}
        </Badge>
      </div>
      <div className="text-xs text-muted-foreground lg:text-right">
        {taskTimestamp(task)}
      </div>
    </div>
  );
}

export function ComputerLiveTasksPanel({
  computer,
  onChanged,
}: ComputerLiveTasksPanelProps) {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const [tasksResult, reexecuteTasks] = useQuery({
    query: ComputerTasksQuery,
    variables: { computerId: computer.id, limit: 8 },
    requestPolicy: "cache-and-network",
  });
  const [threadsResult, reexecuteThreads] = useQuery({
    query: ComputerThreadsQuery,
    variables: {
      tenantId: computer.tenantId,
      computerId: computer.id,
      limit: 12,
    },
    requestPolicy: "cache-and-network",
  });
  const [{ fetching: enqueueing }, enqueueTask] = useMutation(
    EnqueueComputerTaskMutation,
  );

  const tasks = tasksResult.data?.computerTasks ?? [];
  const threadsById = useMemo(() => {
    return new Map(
      (threadsResult.data?.threads ?? []).map((thread) => [thread.id, thread]),
    );
  }, [threadsResult.data?.threads]);
  const latestTask = tasks[0] ?? null;
  const historicalTasks = tasks.slice(1);
  const needsGoogleReconnect = useMemo(() => {
    const latestGoogleTask = tasks.find(taskHasGoogleWorkspaceSignal);
    return latestGoogleTask
      ? taskHasMissingGoogleCalendarScope(latestGoogleTask)
      : false;
  }, [tasks]);
  const hasOpenTask = useMemo(
    () =>
      tasks.some(
        (task) =>
          task.status === ComputerTaskStatus.Pending ||
          task.status === ComputerTaskStatus.Running,
      ),
    [tasks],
  );
  const hasRecentThreadTurn = useMemo(
    () =>
      tasks.some((task) => {
        if (task.taskType !== ComputerTaskType.ThreadTurn) return false;
        const stamp = task.completedAt ?? task.createdAt;
        return Date.now() - new Date(stamp).getTime() < 2 * 60_000;
      }),
    [tasks],
  );

  useEffect(() => {
    if (!hasOpenTask && !hasRecentThreadTurn) return;
    const timer = window.setInterval(() => {
      reexecuteTasks({ requestPolicy: "network-only" });
      reexecuteThreads({ requestPolicy: "network-only" });
      onChanged?.();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [
    hasOpenTask,
    hasRecentThreadTurn,
    onChanged,
    reexecuteTasks,
    reexecuteThreads,
  ]);

  async function enqueueRuntimeTask(
    taskType: ComputerTaskType,
    taskInput?: Record<string, unknown>,
  ) {
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const result = await enqueueTask({
      input: {
        computerId: computer.id,
        taskType,
        idempotencyKey: `browser-${taskType.toLowerCase()}-${computer.id}-${stamp}`,
        input: taskInput ?? null,
      },
    });
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success(`${label(taskType)} queued`);
    reexecuteTasks({ requestPolicy: "network-only" });
    reexecuteThreads({ requestPolicy: "network-only" });
    onChanged?.();
  }

  function reconnectGoogleWorkspace() {
    if (!API_URL || !tenant?.id || !user?.sub) {
      toast.error("Google reconnect is not ready for this session");
      return;
    }

    const authUrl = new URL("/api/oauth/authorize", API_URL);
    authUrl.searchParams.set("provider", "google_productivity");
    authUrl.searchParams.set("scopes", GOOGLE_WORKSPACE_SCOPES.join(","));
    authUrl.searchParams.set("userId", user.sub);
    authUrl.searchParams.set("tenantId", tenant.id);
    authUrl.searchParams.set("returnUrl", window.location.href);
    window.location.assign(authUrl.toString());
  }

  function enqueueWorkspaceMarker() {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000).toISOString();
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    enqueueRuntimeTask(ComputerTaskType.WorkspaceFileWrite, {
      path: `.thinkwork/runtime-checks/${stamp}.md`,
      content: [
        "# Browser Runtime Check",
        "",
        `computer: ${computer.slug}`,
        `queuedAt: ${now.toISOString()}`,
        `expiresAt: ${expiresAt}`,
      ].join("\n"),
    });
  }

  function enqueueCalendarUpcoming() {
    const now = new Date();
    const timeMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    enqueueRuntimeTask(ComputerTaskType.GoogleCalendarUpcoming, {
      timeMin: now.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 10,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Live Runtime</CardTitle>
        <CardDescription>
          Queue checks against the running Computer and review the latest
          result.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <section className="space-y-2" aria-labelledby="runtime-actions-title">
          <div className="flex items-center justify-between gap-3">
            <h3
              id="runtime-actions-title"
              className="text-sm font-medium text-foreground"
            >
              Actions
            </h3>
            {enqueueing ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Queueing
              </span>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => enqueueRuntimeTask(ComputerTaskType.HealthCheck)}
              disabled={enqueueing}
              title="Queue a runtime health check"
            >
              {enqueueing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Activity className="h-4 w-4" />
              )}
              Health
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={enqueueWorkspaceMarker}
              disabled={enqueueing}
              title="Write a TTL-marked file into the Computer workspace"
            >
              <FileText className="h-4 w-4" />
              Workspace
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                enqueueRuntimeTask(ComputerTaskType.GoogleCliSmoke)
              }
              disabled={enqueueing}
              title="Check whether the Google Workspace CLI is available in the runtime"
            >
              <Terminal className="h-4 w-4" />
              Google CLI
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                enqueueRuntimeTask(ComputerTaskType.GoogleWorkspaceAuthCheck)
              }
              disabled={enqueueing}
              title="Check the Computer owner's Google Workspace connection without exposing tokens"
            >
              <KeyRound className="h-4 w-4" />
              Google Auth
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={enqueueCalendarUpcoming}
              disabled={enqueueing}
              title="List upcoming Google Calendar events without exposing tokens"
            >
              <CalendarDays className="h-4 w-4" />
              Calendar
            </Button>
          </div>
        </section>
        {needsGoogleReconnect ? (
          <div className="flex flex-col gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div className="min-w-0">
                <div className="font-medium text-foreground">
                  Google Calendar scope missing
                </div>
                <div className="text-xs leading-relaxed text-muted-foreground">
                  Reconnect Google Workspace to let this Computer read upcoming
                  calendar events.
                </div>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={reconnectGoogleWorkspace}
              className="shrink-0"
            >
              <ExternalLink className="h-4 w-4" />
              Reconnect Google
            </Button>
          </div>
        ) : null}
        {tasksResult.error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {tasksResult.error.message}
          </div>
        ) : threadsResult.error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {threadsResult.error.message}
          </div>
        ) : tasks.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            No runtime tasks yet.
          </div>
        ) : (
          <>
            {latestTask ? (
              <section
                className="space-y-2"
                aria-labelledby="latest-runtime-result-title"
              >
                <h3
                  id="latest-runtime-result-title"
                  className="text-sm font-medium text-foreground"
                >
                  Latest Result
                </h3>
                <TaskResultRow
                  task={latestTask}
                  threadContext={threadTurnContext(latestTask, threadsById)}
                  highlighted
                />
              </section>
            ) : null}
            <section className="space-y-2" aria-labelledby="task-history-title">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3
                  id="task-history-title"
                  className="text-sm font-medium text-foreground"
                >
                  Task History
                </h3>
                <span className="text-xs text-muted-foreground">
                  {historicalTasks.length} previous
                </span>
              </div>
              {historicalTasks.length === 0 ? (
                <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  No previous runtime tasks.
                </div>
              ) : (
                <div className="divide-y rounded-md border">
                  {historicalTasks.map((task) => (
                    <TaskResultRow
                      key={task.id}
                      task={task}
                      threadContext={threadTurnContext(task, threadsById)}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
