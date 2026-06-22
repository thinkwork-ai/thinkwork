import { Badge } from "@thinkwork/ui";
import type { AgentLoopEvidenceItem } from "./agent-loop-types";
import { formatDateTime, jsonRecord, titleize } from "./agent-loop-utils";
import { InfoCard, JsonPreview } from "@/components/workflows/workflow-ui";

export function AgentLoopEvidencePanel({
  evidence,
}: {
  evidence: AgentLoopEvidenceItem[];
}) {
  return (
    <InfoCard title="Evidence">
      {evidence.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Evidence is pending or was not emitted by this loop iteration.
        </p>
      ) : (
        <div className="space-y-3">
          {evidence.map((item) => (
            <div
              key={item.id}
              className="space-y-2 rounded-md border border-border/70 p-3"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {titleize(item.evidenceType)}
                </Badge>
                <span className="text-sm font-medium">
                  {titleize(item.sourceSystem)}
                </span>
                <Badge variant="outline" className="text-xs">
                  {titleize(item.redactionState)}
                </Badge>
              </div>
              {item.sourceId ? (
                <p className="truncate text-xs text-muted-foreground">
                  Source ID: {item.sourceId}
                </p>
              ) : null}
              {item.uri ? (
                item.uri.startsWith("http") ? (
                  <a
                    href={item.uri}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-xs text-primary hover:underline"
                  >
                    {item.uri}
                  </a>
                ) : (
                  <p className="truncate text-xs text-muted-foreground">
                    {item.uri}
                  </p>
                )
              ) : null}
              <JsonPreview value={jsonRecord(item.summary)} />
              {item.retentionExpiresAt ? (
                <p className="text-xs text-muted-foreground">
                  Retention expires {formatDateTime(item.retentionExpiresAt)}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </InfoCard>
  );
}
