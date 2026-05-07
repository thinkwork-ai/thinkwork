import { useEffect, useMemo } from "react";
import { useMutation, useQuery } from "urql";
import { Activity, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardAction,
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

  async function enqueueBrowserCheck() {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000).toISOString();
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const path = `.thinkwork/runtime-checks/${stamp}.md`;
    const result = await enqueueTask({
      input: {
        computerId: computer.id,
        taskType: ComputerTaskType.WorkspaceFileWrite,
        idempotencyKey: `browser-runtime-check-${computer.id}-${stamp}`,
        input: {
          path,
          content: [
            "# Browser Runtime Check",
            "",
            `computer: ${computer.slug}`,
            `queuedAt: ${now.toISOString()}`,
            `expiresAt: ${expiresAt}`,
          ].join("\n"),
        },
      },
    });
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Runtime check queued");
    reexecuteTasks({ requestPolicy: "network-only" });
    onChanged?.();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Live Runtime</CardTitle>
        <CardDescription>
          Browser-triggered checks and recent work claimed by the running ECS
          worker.
        </CardDescription>
        <CardAction>
          <Button
            size="sm"
            variant="outline"
            onClick={enqueueBrowserCheck}
            disabled={enqueueing}
          >
            {enqueueing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Activity className="h-4 w-4" />
            )}
            Check Runtime
          </Button>
        </CardAction>
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
                  className="grid gap-3 p-3 text-sm md:grid-cols-[minmax(0,1fr)_110px_160px]"
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
                      <div className="truncate font-medium">
                        {label(task.taskType)}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {outputSummary(task.output, task.error)}
                      </div>
                    </div>
                  </div>
                  <div>
                    <Badge variant="outline" className="text-xs">
                      {label(task.status)}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
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
