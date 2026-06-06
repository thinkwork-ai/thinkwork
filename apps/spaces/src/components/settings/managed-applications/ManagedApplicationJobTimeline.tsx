import { Badge } from "@thinkwork/ui";
import type { ManagedApplicationJob } from "./types";

export function ManagedApplicationJobTimeline({
  job,
}: {
  job?: ManagedApplicationJob | null;
}) {
  if (!job) {
    return (
      <div className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
        No deployment events yet.
      </div>
    );
  }

  if (job.events.length === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
        Waiting for the deployment runner to record events.
      </div>
    );
  }

  return (
    <ol className="space-y-2">
      {job.events.map((event) => (
        <li
          key={event.id}
          className="rounded-md border border-border bg-muted/20 px-3 py-2"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {event.message}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {event.eventType}
              </p>
            </div>
            <Badge variant="outline" className="shrink-0">
              {formatTimestamp(event.createdAt)}
            </Badge>
          </div>
        </li>
      ))}
    </ol>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
