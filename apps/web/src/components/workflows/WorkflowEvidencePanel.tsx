import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Badge,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@thinkwork/ui";
import {
  formatDateTime,
  InfoCard,
  jsonRecord,
  JsonPreview,
  titleize,
} from "./workflow-ui";

export type WorkflowEvidenceItem = {
  id: string;
  evidenceType: string;
  sourceSystem: string;
  sourceId?: string | null;
  uri?: string | null;
  summary?: unknown;
  redactionState: string;
  sensitivity?: string | null;
  retentionExpiresAt?: string | null;
};

/**
 * step_output evidence carries {stepId, stepKind, iteration, output} in its
 * summary (workflow interpreter, THINK-214/219). Give it a step-scoped
 * heading instead of the generic evidence-type badge.
 */
function stepOutputHeading(item: WorkflowEvidenceItem): string | null {
  if (item.evidenceType !== "step_output") return null;
  const summary = jsonRecord(item.summary);
  const stepId = typeof summary.stepId === "string" ? summary.stepId : null;
  if (!stepId) return null;
  const stepKind =
    typeof summary.stepKind === "string" ? summary.stepKind : null;
  const iteration =
    typeof summary.iteration === "number" ? summary.iteration : null;
  return [
    stepId,
    stepKind ? `(${titleize(stepKind)})` : null,
    iteration != null ? `— iteration ${iteration + 1}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * THINK-193 U3: memory_stage step outputs carry per-stage counts
 * ({stage, counts: {changed, seen, ...}}). Render them inline so a memory
 * run's evidence reads as stage-by-stage numbers without expanding JSON.
 */
function memoryStageCounts(item: WorkflowEvidenceItem): string | null {
  if (item.evidenceType !== "step_output") return null;
  const summary = jsonRecord(item.summary);
  if (summary.stepKind !== "memory_stage") return null;
  const output = jsonRecord(summary.output);
  const counts = jsonRecord(output.counts);
  const entries = Object.entries(counts).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number",
  );
  if (entries.length === 0) return null;
  const stage = typeof output.stage === "string" ? output.stage : null;
  const rendered = entries.map(([key, value]) => `${key} ${value}`).join(" · ");
  return stage ? `${stage}: ${rendered}` : rendered;
}

export function WorkflowEvidencePanel({
  evidence,
}: {
  evidence: WorkflowEvidenceItem[];
}) {
  return (
    <InfoCard title="Evidence">
      {evidence.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Evidence is pending or was not emitted by the workflow backend.
        </p>
      ) : (
        <div className="space-y-3">
          {evidence.map((item) => (
            <EvidenceRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </InfoCard>
  );
}

function EvidenceRow({ item }: { item: WorkflowEvidenceItem }) {
  const [open, setOpen] = useState(false);
  const stepHeading = stepOutputHeading(item);
  const stageCounts = memoryStageCounts(item);

  return (
    <div className="space-y-2 rounded-md border border-border/70 p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant="secondary" className="text-xs">
          {titleize(item.evidenceType)}
        </Badge>
        <span className="min-w-0 truncate text-sm font-medium">
          {stepHeading ?? titleize(item.sourceSystem)}
        </span>
        <Badge variant="outline" className="text-xs">
          {titleize(item.redactionState)}
        </Badge>
      </div>
      {stageCounts ? (
        <p className="text-xs text-muted-foreground">{stageCounts}</p>
      ) : null}
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
          <p className="truncate text-xs text-muted-foreground">{item.uri}</p>
        )
      ) : null}
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
          {open ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          {open ? "Hide details" : "Show details"}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <JsonPreview value={item.summary ?? null} />
        </CollapsibleContent>
      </Collapsible>
      {item.retentionExpiresAt ? (
        <p className="text-xs text-muted-foreground">
          Retention expires {formatDateTime(item.retentionExpiresAt)}
        </p>
      ) : null}
    </div>
  );
}
