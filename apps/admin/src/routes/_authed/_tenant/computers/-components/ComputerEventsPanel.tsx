import { useEffect } from "react";
import { useQuery } from "urql";
import { AlertTriangle, Bug, Info, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ComputerEventsQuery } from "@/lib/graphql-queries";
import { ComputerEventLevel, type Computer } from "@/gql/graphql";
import { relativeTime } from "@/lib/utils";

type ComputerEventsPanelProps = {
  computer: Pick<Computer, "id">;
  refreshKey?: number;
};

function label(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function eventIcon(level: ComputerEventLevel) {
  if (level === ComputerEventLevel.Error) return XCircle;
  if (level === ComputerEventLevel.Warn) return AlertTriangle;
  if (level === ComputerEventLevel.Debug) return Bug;
  return Info;
}

function eventTone(level: ComputerEventLevel): string {
  if (level === ComputerEventLevel.Error) return "text-destructive";
  if (level === ComputerEventLevel.Warn) return "text-amber-500";
  if (level === ComputerEventLevel.Debug) return "text-muted-foreground";
  return "text-cyan-500";
}

function payloadSummary(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "—";
  const data = payload as Record<string, unknown>;
  const message = data.message;
  if (typeof message === "string") return message;
  const taskType = data.taskType;
  if (typeof taskType === "string") return label(taskType);
  const status = data.status;
  if (typeof status === "string") return label(status);
  return "Payload recorded";
}

export function ComputerEventsPanel({
  computer,
  refreshKey = 0,
}: ComputerEventsPanelProps) {
  const [result, reexecute] = useQuery({
    query: ComputerEventsQuery,
    variables: { computerId: computer.id, limit: 10 },
    requestPolicy: "cache-and-network",
  });
  const events = result.data?.computerEvents ?? [];

  useEffect(() => {
    if (refreshKey === 0) return;
    reexecute({ requestPolicy: "network-only" });
  }, [refreshKey, reexecute]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Runtime Events</CardTitle>
        <CardDescription>
          Recent audit events emitted by the Computer control plane and runtime.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {result.error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {result.error.message}
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            No runtime events yet.
          </div>
        ) : (
          <div className="divide-y rounded-md border">
            {events.map((event) => {
              const Icon = eventIcon(event.level);
              return (
                <div
                  key={event.id}
                  className="grid gap-3 p-3 text-sm md:grid-cols-[minmax(0,1fr)_120px]"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <Icon
                      className={`mt-0.5 h-4 w-4 shrink-0 ${eventTone(
                        event.level,
                      )}`}
                    />
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="truncate font-medium">
                          {label(event.eventType)}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {label(event.level)}
                        </Badge>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {payloadSummary(event.payload)}
                      </div>
                      {event.taskId ? (
                        <div className="mt-1 truncate text-[11px] text-muted-foreground">
                          Task {event.taskId}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {relativeTime(event.createdAt)}
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
