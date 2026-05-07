import { useEffect, useMemo } from "react";
import { useMutation, useQuery } from "urql";
import {
  Activity,
  CalendarDays,
  CheckCircle2,
  Clock,
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
  EnqueueComputerTaskMutation,
} from "@/lib/graphql-queries";
import {
  ComputerTaskStatus,
  ComputerTaskType,
  type Computer,
} from "@/gql/graphql";
import { relativeTime } from "@/lib/utils";

type ComputerLiveTasksPanelProps = {
  computer: Pick<Computer, "id" | "slug" | "runtimeStatus">;
  onChanged?: () => void;
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

function outputSummary(output: unknown, error: unknown): string {
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

export function ComputerLiveTasksPanel({
  computer,
  onChanged,
}: ComputerLiveTasksPanelProps) {
  const [tasksResult, reexecuteTasks] = useQuery({
    query: ComputerTasksQuery,
    variables: { computerId: computer.id, limit: 8 },
    requestPolicy: "cache-and-network",
  });
  const [{ fetching: enqueueing }, enqueueTask] = useMutation(
    EnqueueComputerTaskMutation,
  );

  const tasks = tasksResult.data?.computerTasks ?? [];
  const hasOpenTask = useMemo(
    () =>
      tasks.some(
        (task) =>
          task.status === ComputerTaskStatus.Pending ||
          task.status === ComputerTaskStatus.Running,
      ),
    [tasks],
  );

  useEffect(() => {
    if (!hasOpenTask) return;
    const timer = window.setInterval(() => {
      reexecuteTasks({ requestPolicy: "network-only" });
      onChanged?.();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [hasOpenTask, onChanged, reexecuteTasks]);

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
    onChanged?.();
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
    const timeMax = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    enqueueRuntimeTask(ComputerTaskType.GoogleCalendarUpcoming, {
      timeMin: now.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 10,
    });
  }

  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 max-w-2xl">
            <CardTitle>Live Runtime</CardTitle>
            <CardDescription>
              Browser-triggered actions and recent work claimed by the running
              ECS worker.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2 xl:justify-end">
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
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {tasksResult.error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {tasksResult.error.message}
          </div>
        ) : tasks.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            No runtime tasks yet.
          </div>
        ) : (
          <div className="divide-y rounded-md border">
            {tasks.map((task) => {
              const Icon = taskIcon(task.status);
              return (
                <div
                  key={task.id}
                  className="grid gap-3 p-3 text-sm lg:grid-cols-[minmax(0,1fr)_120px_180px]"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <Icon
                      className={`mt-0.5 h-4 w-4 shrink-0 ${taskTone(task.status)} ${
                        task.status === ComputerTaskStatus.Running
                          ? "animate-spin"
                          : ""
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="break-words font-medium">
                        {label(task.taskType)}
                      </div>
                      <div className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">
                        {outputSummary(task.output, task.error)}
                      </div>
                    </div>
                  </div>
                  <div className="lg:text-center">
                    <Badge variant="outline" className="text-xs">
                      {label(task.status)}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground lg:text-right">
                    {task.completedAt
                      ? `Completed ${relativeTime(task.completedAt)}`
                      : task.claimedAt
                        ? `Claimed ${relativeTime(task.claimedAt)}`
                        : `Queued ${relativeTime(task.createdAt)}`}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
