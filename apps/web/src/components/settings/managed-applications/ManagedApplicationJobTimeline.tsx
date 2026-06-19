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
    <ol className="min-w-0 space-y-2">
      {job.events.map((event) => (
        <li
          key={event.id}
          className="min-w-0 rounded-md border border-border bg-muted/20 px-3 py-2"
        >
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium leading-5 text-foreground [overflow-wrap:anywhere]">
                {event.message}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {event.eventType}
              </p>
            </div>
            <Badge variant="outline" className="w-fit shrink-0 whitespace-nowrap">
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
