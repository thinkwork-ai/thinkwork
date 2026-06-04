import { Badge } from "@thinkwork/ui";
import type { SettingsKnowledgeGraphIngestRunsQuery } from "@/gql/graphql";

type Run =
  SettingsKnowledgeGraphIngestRunsQuery["knowledgeGraphIngestRuns"][number];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> =
  {
    QUEUED: "secondary",
    RUNNING: "default",
    SUCCEEDED: "default",
    FAILED: "destructive",
    CANCELED: "secondary",
    STALE_NOOP: "secondary",
  };

export function KnowledgeGraphRunBanner({
  runs,
  fetching,
  error,
}: {
  runs: Run[];
  fetching: boolean;
  error?: string | null;
}) {
  const latest = runs[0] ?? null;

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (fetching && !latest) {
    return (
      <div className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
        Loading ingest runs...
      </div>
    );
  }

  if (!latest) {
    return (
      <div className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
        No ingest runs for this thread yet.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_VARIANT[latest.status] ?? "secondary"}>
          {formatStatus(latest.status)}
        </Badge>
        <span className="text-sm text-foreground">
          {latest.entityCount} entities · {latest.relationshipCount} links ·{" "}
          {latest.evidenceCount} evidence
        </span>
        <span className="text-xs text-muted-foreground">
          {latest.durationMs
            ? `${latest.durationMs} ms`
            : formatDate(latest.createdAt)}
        </span>
      </div>
      {latest.error ? (
        <p className="mt-1 line-clamp-2 text-xs text-destructive">
          {latest.error}
        </p>
      ) : null}
      {runs.length > 1 ? (
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          {runs.slice(1, 5).map((run) => (
            <span
              key={run.id}
              className="rounded border border-border px-2 py-1"
            >
              {formatStatus(run.status)} · {run.entityCount}/
              {run.relationshipCount}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatStatus(status: string) {
  return status.toLowerCase().replace(/_/g, " ");
}

function formatDate(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
